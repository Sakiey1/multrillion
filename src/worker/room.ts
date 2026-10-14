// One GameRoom Durable Object per room code. It is the single source of truth for
// the game: players, timers, answer checking and scoring.

import { DurableObject } from "cloudflare:workers";
import { matchAnswer, MAX_INPUT_LENGTH } from "../shared/matcher";
import { normalize } from "../shared/normalize";
import type {
  AttemptStatus,
  BestAnswer,
  ClientMessage,
  Phase,
  PublicState,
  ResultRow,
  ServerMessage,
} from "../shared/protocol";
import { MAX_PLAYERS, ROUND_MS, speedBonus, TOTAL_ROUNDS } from "../shared/scoring";
import { aiMatch } from "./ai";
import { getIndex, pickQuestion } from "./bank";

/** Pause between "Round N" appearing and the question opening. */
const LEAD_IN_MS = 3000;
/** How long round end may wait for in-flight AI checks. */
const AI_GRACE_MS = 6000;
const MIN_ATTEMPT_GAP_MS = 300;
const MAX_AI_CALLS_PER_ROUND = 8;
/** Delete an abandoned room after this long with nobody connected. */
const IDLE_CLEANUP_MS = 2 * 60 * 60 * 1000;
const NAME_MAX = 16;

interface PlayerRec {
  id: string;
  token: string;
  name: string;
  score: number;
  ready: boolean;
  joinedAt: number;
  best: BestAnswer | null;
}

interface Submission {
  input: string;
  answer: string;
  points: number;
  speedBonus: number;
  timeMs: number;
}

interface RoundRec {
  number: number;
  questionId: string;
  prompt: string;
  startedAt: number;
  endsAt: number;
  submissions: Record<string, Submission>;
}

interface RoomState {
  code: string;
  createdAt: number;
  lastActivity: number;
  phase: Phase;
  hostId: string | null;
  players: PlayerRec[];
  round: number;
  current: RoundRec | null;
  results: { round: number; prompt: string; rows: ResultRow[] } | null;
  usedQuestionIds: string[];
}

interface SocketTag {
  playerId: string | null;
}

interface AttemptTracker {
  round: number;
  aiCalls: number;
  lastAt: number;
  pending: boolean;
}

export class GameRoom extends DurableObject<Env> {
  private state: RoomState | null = null;
  // In-memory only: fine to lose on eviction.
  private attempts = new Map<string, AttemptTracker>();
  private aiCache = new Map<string, Awaited<ReturnType<typeof aiMatch>>>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get<RoomState>("state")) ?? null;
    });
  }

  // ---------------------------------------------------------------- HTTP

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/init" && request.method === "POST") {
      if (this.state) return new Response("exists", { status: 409 });
      const { code } = await request.json<{ code: string }>();
      const now = Date.now();
      this.state = {
        code,
        createdAt: now,
        lastActivity: now,
        phase: "lobby",
        hostId: null,
        players: [],
        round: 0,
        current: null,
        results: null,
        usedQuestionIds: [],
      };
      await this.commit();
      return Response.json({ code });
    }
    if (url.pathname === "/info") {
      if (!this.state) return new Response("not found", { status: 404 });
      return Response.json({
        code: this.state.code,
        phase: this.state.phase,
        players: this.state.players.length,
        maxPlayers: MAX_PLAYERS,
      });
    }
    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
      if (!this.state) return new Response("room not found", { status: 404 });
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment({ playerId: null } satisfies SocketTag);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    return new Response("not found", { status: 404 });
  }

  // ---------------------------------------------------------------- sockets

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (!this.state) {
      ws.close(4004, "room closed");
      return;
    }
    let msg: ClientMessage;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return this.send(ws, { t: "error", code: "bad_message", message: "Invalid message" });
    }
    if (msg.t === "ping") {
      return this.send(ws, { t: "pong", clientTime: Number(msg.clientTime) || 0, serverTime: Date.now() });
    }
    if (msg.t === "join") return this.onJoin(ws, msg);

    const player = this.playerFor(ws);
    if (!player) return this.send(ws, { t: "error", code: "not_joined", message: "Join the room first" });
    this.state.lastActivity = Date.now();

    switch (msg.t) {
      case "start":
        return this.onStart(player);
      case "answer":
        return this.onAnswer(ws, player, String(msg.text ?? ""));
      case "ready":
        return this.onReady(player);
      case "playAgain":
        return this.onPlayAgain(player);
    }
  }

  async webSocketClose(ws: WebSocket) {
    await this.onDisconnect(ws);
  }

  async webSocketError(ws: WebSocket) {
    await this.onDisconnect(ws);
  }

  private async onDisconnect(ws: WebSocket) {
    const s = this.state;
    if (!s) return;
    const tag = ws.deserializeAttachment() as SocketTag | null;
    ws.serializeAttachment({ playerId: null } satisfies SocketTag);
    if (!tag?.playerId) return;
    const connected = this.connectedIds();
    if (s.hostId === tag.playerId && !connected.has(tag.playerId)) {
      const next = s.players.filter((p) => connected.has(p.id)).sort((a, b) => a.joinedAt - b.joinedAt)[0];
      if (next) s.hostId = next.id;
    }
    // A leaver shouldn't hold up the round or the ready check.
    if (s.phase === "question") {
      if (this.everyoneAnswered()) return this.endRound();
    } else if (s.phase === "results") {
      if (this.everyoneReady()) return this.advance();
    }
    await this.commit();
  }

  // ---------------------------------------------------------------- handlers

  private async onJoin(ws: WebSocket, msg: Extract<ClientMessage, { t: "join" }>) {
    const s = this.state!;
    const name = String(msg.name ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, NAME_MAX);

    let player = s.players.find((p) => p.id === msg.playerId && p.token === msg.token);
    if (!player) {
      if (!name) return this.send(ws, { t: "error", code: "bad_name", message: "Enter a name" });
      const connected = this.connectedIds();
      const sameName = s.players.find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (sameName && connected.has(sameName.id)) {
        return this.send(ws, { t: "error", code: "name_taken", message: "Someone in this room already has that name" });
      }
      if (sameName) {
        // Rejoining from a new device: take back the disconnected seat.
        player = sameName;
        player.token = crypto.randomUUID();
      } else {
        if (s.players.length >= MAX_PLAYERS) {
          return this.send(ws, { t: "error", code: "room_full", message: `This room is full (${MAX_PLAYERS} players max)` });
        }
        player = {
          id: crypto.randomUUID(),
          token: crypto.randomUUID(),
          name,
          score: 0,
          ready: false,
          joinedAt: Date.now(),
          best: null,
        };
        s.players.push(player);
      }
    }

    // One live socket per player.
    for (const other of this.ctx.getWebSockets()) {
      if (other !== ws && (other.deserializeAttachment() as SocketTag | null)?.playerId === player.id) {
        other.serializeAttachment({ playerId: null } satisfies SocketTag);
        other.close(4001, "Connected from another tab");
      }
    }
    ws.serializeAttachment({ playerId: player.id } satisfies SocketTag);
    if (!s.hostId || !this.connectedIds().has(s.hostId)) s.hostId = player.id;
    s.lastActivity = Date.now();

    this.send(ws, { t: "welcome", playerId: player.id, token: player.token });
    await this.commit();
  }

  private async onStart(player: PlayerRec) {
    const s = this.state!;
    if (s.hostId !== player.id || s.phase !== "lobby") return;
    for (const p of s.players) {
      p.score = 0;
      p.best = null;
      p.ready = false;
    }
    // Drop seats of people who left while in the lobby.
    const connected = this.connectedIds();
    s.players = s.players.filter((p) => connected.has(p.id));
    s.round = 0;
    s.results = null;
    s.usedQuestionIds = [];
    await this.startRound();
  }

  private async startRound() {
    const s = this.state!;
    const q = pickQuestion(s.usedQuestionIds);
    s.usedQuestionIds.push(q.id);
    s.round += 1;
    const startedAt = Date.now() + LEAD_IN_MS;
    s.current = {
      number: s.round,
      questionId: q.id,
      prompt: q.prompt,
      startedAt,
      endsAt: startedAt + ROUND_MS,
      submissions: {},
    };
    s.phase = "question";
    for (const p of s.players) p.ready = false;
    this.attempts.clear();
    await this.commit();
  }

  private async onAnswer(ws: WebSocket, player: PlayerRec, rawText: string) {
    const s = this.state!;
    const round = s.current;
    const now = Date.now();
    if (s.phase !== "question" || !round || now < round.startedAt || now > round.endsAt) return;
    if (round.submissions[player.id]) return;

    const text = rawText.replace(/\s+/g, " ").trim().slice(0, MAX_INPUT_LENGTH);
    const reply = (a: AttemptStatus) => this.send(ws, { t: "attempt", ...a });
    if (!text) return reply({ status: "invalid", input: text, reason: "Type an answer" });

    let tracker = this.attempts.get(player.id);
    if (!tracker || tracker.round !== round.number) {
      tracker = { round: round.number, aiCalls: 0, lastAt: 0, pending: false };
      this.attempts.set(player.id, tracker);
    }
    if (tracker.pending) return;
    if (now - tracker.lastAt < MIN_ATTEMPT_GAP_MS) return reply({ status: "invalid", input: text, reason: "Slow down!" });
    tracker.lastAt = now;

    const index = getIndex(round.questionId);
    if (!index) return reply({ status: "invalid", input: text, reason: "Question not found" });
    const timeMs = now - round.startedAt;

    const rule = matchAnswer(index, text);
    if (rule.kind === "match") return this.lock(ws, player, text, rule.answer.name, rule.answer.points, timeMs);

    if (tracker.aiCalls >= MAX_AI_CALLS_PER_ROUND) {
      return reply({ status: "invalid", input: text, reason: "Not on the list" });
    }
    const cacheKey = `${round.questionId}|${normalize(text)}`;
    let verdict = this.aiCache.get(cacheKey);
    if (!verdict) {
      tracker.aiCalls += 1;
      tracker.pending = true;
      reply({ status: "checking", input: text });
      try {
        verdict = await aiMatch(this.env, index.question, text);
      } finally {
        tracker.pending = false;
      }
      if (verdict.kind !== "error") this.aiCache.set(cacheKey, verdict);
      console.log(
        JSON.stringify({ event: "ai_match", question: round.questionId, input: text, verdict: summarize(verdict) }),
      );
    }

    // The round may have moved on while we waited (it waits up to AI_GRACE_MS for us).
    if (s.current !== round || s.phase !== "question" || round.submissions[player.id]) return;

    switch (verdict.kind) {
      case "match":
        return this.lock(ws, player, text, verdict.answer.name, verdict.answer.points, timeMs);
      case "ambiguous":
        return reply({ status: "ambiguous", input: text, options: verdict.options.map((a) => a.name) });
      case "none":
      case "error":
        console.log(JSON.stringify({ event: "unrecognized", question: round.questionId, input: text }));
        return reply({ status: "invalid", input: text, reason: "Not on the list" });
    }
  }

  private async lock(ws: WebSocket, player: PlayerRec, input: string, answer: string, points: number, timeMs: number) {
    const s = this.state!;
    const round = s.current!;
    round.submissions[player.id] = { input, answer, points, speedBonus: speedBonus(points, timeMs), timeMs };
    this.send(ws, { t: "attempt", status: "accepted", input, answer });
    if (this.everyoneAnswered()) return this.endRound();
    await this.commit();
  }

  private async endRound() {
    const s = this.state!;
    const round = s.current;
    if (s.phase !== "question" || !round) return;

    const now = Date.now();
    const pending = [...this.attempts.values()].some((t) => t.pending && t.round === round.number);
    if (pending && now < round.endsAt + AI_GRACE_MS) {
      await this.ctx.storage.setAlarm(now + 250);
      return;
    }

    const rows: ResultRow[] = s.players.map((p) => {
      const sub = round.submissions[p.id];
      const gained = sub ? sub.points + sub.speedBonus : 0;
      const prevScore = p.score;
      p.score += gained;
      if (sub && (!p.best || sub.points > p.best.points)) {
        p.best = { prompt: round.prompt, answer: sub.answer, points: sub.points };
      }
      return {
        playerId: p.id,
        name: p.name,
        input: sub?.input ?? null,
        answer: sub?.answer ?? null,
        points: sub?.points ?? 0,
        speedBonus: sub?.speedBonus ?? 0,
        gained,
        timeMs: sub?.timeMs ?? null,
        prevScore,
        newScore: p.score,
      };
    });
    s.results = { round: round.number, prompt: round.prompt, rows };
    s.current = null;
    s.phase = "results";
    for (const p of s.players) p.ready = false;
    await this.commit();
  }

  private async onReady(player: PlayerRec) {
    const s = this.state!;
    if (s.phase !== "results" || player.ready) return;
    player.ready = true;
    if (this.everyoneReady()) return this.advance();
    await this.commit();
  }

  private async advance() {
    const s = this.state!;
    if (s.round >= TOTAL_ROUNDS) {
      s.phase = "final";
      await this.commit();
    } else {
      await this.startRound();
    }
  }

  private async onPlayAgain(player: PlayerRec) {
    const s = this.state!;
    if (s.hostId !== player.id || s.phase !== "final") return;
    s.phase = "lobby";
    s.round = 0;
    s.results = null;
    s.current = null;
    for (const p of s.players) {
      p.score = 0;
      p.best = null;
      p.ready = false;
    }
    await this.commit();
  }

  // ---------------------------------------------------------------- alarm

  async alarm() {
    const s = this.state;
    if (!s) return;
    const now = Date.now();
    if (s.phase === "question" && s.current) {
      if (now >= s.current.endsAt) return this.endRound();
      return this.scheduleAlarm();
    }
    if (this.connectedIds().size === 0 && now - s.lastActivity >= IDLE_CLEANUP_MS - 1000) {
      this.state = null;
      await this.ctx.storage.deleteAll();
      return;
    }
    await this.scheduleAlarm();
  }

  private async scheduleAlarm() {
    const s = this.state;
    if (!s) return;
    if (s.phase === "question" && s.current) {
      await this.ctx.storage.setAlarm(s.current.endsAt);
    } else if (this.connectedIds().size === 0) {
      await this.ctx.storage.setAlarm(s.lastActivity + IDLE_CLEANUP_MS);
    } else {
      await this.ctx.storage.deleteAlarm();
    }
  }

  // ---------------------------------------------------------------- helpers

  private playerFor(ws: WebSocket): PlayerRec | undefined {
    const tag = ws.deserializeAttachment() as SocketTag | null;
    return tag?.playerId ? this.state?.players.find((p) => p.id === tag.playerId) : undefined;
  }

  private connectedIds(): Set<string> {
    const ids = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const tag = ws.deserializeAttachment() as SocketTag | null;
      if (tag?.playerId) ids.add(tag.playerId);
    }
    return ids;
  }

  private everyoneAnswered(): boolean {
    const s = this.state!;
    const round = s.current;
    if (!round) return false;
    const connected = this.connectedIds();
    const active = s.players.filter((p) => connected.has(p.id));
    return active.length > 0 && active.every((p) => round.submissions[p.id]);
  }

  private everyoneReady(): boolean {
    const s = this.state!;
    const connected = this.connectedIds();
    const active = s.players.filter((p) => connected.has(p.id));
    return active.length > 0 && active.every((p) => p.ready);
  }

  private publicState(forPlayerId: string | null): PublicState {
    const s = this.state!;
    const connected = this.connectedIds();
    const round = s.current;
    const sub = forPlayerId && round ? round.submissions[forPlayerId] : undefined;
    return {
      code: s.code,
      phase: s.phase,
      hostId: s.hostId,
      round: s.round,
      totalRounds: TOTAL_ROUNDS,
      maxPlayers: MAX_PLAYERS,
      players: s.players.map((p) => ({
        id: p.id,
        name: p.name,
        connected: connected.has(p.id),
        score: p.score,
        ready: p.ready,
        answered: !!round?.submissions[p.id],
      })),
      question: round
        ? { prompt: round.prompt, startedAt: round.startedAt, endsAt: round.endsAt, durationMs: ROUND_MS }
        : null,
      results: s.phase === "results" || s.phase === "final" ? s.results : null,
      best: s.phase === "final" ? Object.fromEntries(s.players.map((p) => [p.id, p.best])) : null,
      me: forPlayerId
        ? { id: forPlayerId, locked: sub ? { input: sub.input, answer: sub.answer } : null }
        : null,
    };
  }

  /** Persist, push the new state to every player, and keep the alarm in sync. */
  private async commit() {
    if (!this.state) return;
    await this.ctx.storage.put("state", this.state);
    const serverTime = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      const tag = ws.deserializeAttachment() as SocketTag | null;
      if (tag?.playerId) this.send(ws, { t: "state", state: this.publicState(tag.playerId), serverTime });
    }
    await this.scheduleAlarm();
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Socket already closed; the close handler will tidy up.
    }
  }
}

function summarize(v: Awaited<ReturnType<typeof aiMatch>>) {
  switch (v.kind) {
    case "match":
      return { match: v.answer.name };
    case "ambiguous":
      return { options: v.options.map((a) => a.name) };
    case "error":
      return { error: v.message };
    default:
      return null;
  }
}
