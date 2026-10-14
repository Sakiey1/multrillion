// WebSocket message protocol shared by the worker and the client.

export type Phase = "lobby" | "question" | "results" | "final";

export type ClientMessage =
  | { t: "join"; name: string; playerId?: string; token?: string }
  | { t: "start" }
  | { t: "answer"; text: string }
  | { t: "ready" }
  | { t: "playAgain" }
  | { t: "ping"; clientTime: number };

export interface PublicPlayer {
  id: string;
  name: string;
  connected: boolean;
  score: number;
  ready: boolean;
  /** During the question phase: has locked in a valid answer. */
  answered: boolean;
}

export interface ResultRow {
  playerId: string;
  name: string;
  /** What the player typed (null if they never locked an answer). */
  input: string | null;
  /** The answer it matched. */
  answer: string | null;
  points: number;
  speedBonus: number;
  gained: number;
  timeMs: number | null;
  prevScore: number;
  newScore: number;
}

export interface BestAnswer {
  prompt: string;
  answer: string;
  points: number;
}

export interface PublicState {
  code: string;
  phase: Phase;
  hostId: string | null;
  round: number;
  totalRounds: number;
  maxPlayers: number;
  players: PublicPlayer[];
  question: { prompt: string; startedAt: number; endsAt: number; durationMs: number } | null;
  results: { round: number; prompt: string; rows: ResultRow[] } | null;
  /** Final phase: each player's best answer of the game. */
  best: Record<string, BestAnswer | null> | null;
  me: {
    id: string;
    locked: { input: string; answer: string } | null;
  } | null;
}

export type AttemptStatus =
  | { status: "checking"; input: string }
  | { status: "accepted"; input: string; answer: string }
  | { status: "invalid"; input: string; reason: string }
  | { status: "ambiguous"; input: string; options: string[] };

export type ServerMessage =
  | { t: "welcome"; playerId: string; token: string }
  | { t: "state"; state: PublicState; serverTime: number }
  | ({ t: "attempt" } & AttemptStatus)
  | { t: "pong"; clientTime: number; serverTime: number }
  | { t: "error"; code: string; message: string };
