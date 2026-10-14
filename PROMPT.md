# Multrillion — Build Prompt

> This is the build prompt / spec for Multrillion, a real-time multiplayer
> game inspired by Krillion. Hand it to a coding agent as-is. Sections marked
> **[DEFAULT]** are assumptions that still need the owner's sign-off (see
> "Open questions" at the bottom). Change the default text once a question is
> answered.

---

## 1. What you are building

A browser-based multiplayer party game. Players join a room and race to answer
open-ended prompts like **"Name a prehistoric animal"**. Every valid answer
scores points. **The rarer the answer, the more it is worth.** Answering
quickly adds a small bonus, but rarity matters far more than speed.

A game is **7 rounds**. Each round goes:

1. **Question.** Everyone sees the same prompt and a countdown, and types one answer.
2. **Reveal.** A table of every player's answer: what they typed, what it was
   matched to, how popular that answer is, and the points it earned.
3. **Standings.** The cumulative leaderboard with this round's gain shown next
   to each player ("+412").
4. Next round. After round 7, a final podium screen with a "Play again" option.

## 2. Tech stack and hosting

- **Cloudflare Workers** via the **Wrangler CLI** (`wrangler dev`, `wrangler deploy`).
- **Durable Objects** for game rooms: one Durable Object instance per room
  code. It holds the authoritative game state, runs the timers (`alarm()`), and
  owns every player's WebSocket. Use the **WebSocket Hibernation API**
  (`ctx.acceptWebSocket`, `webSocketMessage`, `webSocketClose`) and a
  **SQLite-backed** Durable Object class (`new_sqlite_classes` in the
  migration). SQLite-backed DOs work on the Workers Free plan.
- **Workers Static Assets** to serve the frontend from the same Worker.
- **Frontend:** Vite + React + TypeScript, built into `dist/` and served as
  static assets. **[DEFAULT]**
- **Question data:** a JSON file bundled into the Worker at build time
  (`data/questions.json`). If the database grows past a few MB, move it to
  **D1** or **KV** behind the same `QuestionStore` interface. **[DEFAULT]**
- TypeScript everywhere. Share types and the matching and scoring code between
  client and server in `src/shared/`.
- Config in `wrangler.jsonc`. Ship `npm run dev`, `npm run build`,
  `npm run deploy`, and `npm test` (Vitest).

Suggested layout:

```
src/
  worker/index.ts          # fetch handler: routes /api/*, /ws/:room, assets
  worker/room.ts           # GameRoom Durable Object
  shared/types.ts          # message protocol and data types
  shared/normalize.ts      # text normalization
  shared/matcher.ts        # answer matching / autocorrect
  shared/scoring.ts        # rarity and speed scoring
  client/...               # React app
data/questions.json        # question bank (see section 4)
scripts/validate-data.ts   # lints the question bank
test/                      # Vitest: matcher, scoring, room state machine
```

## 3. Game flow and rules

### Lobby
- The landing page has **Create game** and **Join game**. Joining takes a
  4-letter room code (no ambiguous letters such as O/0 or I/1) and a nickname.
- Shareable link: `/r/ABCD` drops the player straight into the nickname step.
- The creator is the **host**. The host sees the player list and the room
  settings, and presses **Start**. If the host leaves, host passes to the
  longest-connected player.
- Player cap: **2–12 players** per room. **[DEFAULT]**
- Nicknames must be unique within the room, 1–16 characters, and pass a basic
  profanity filter. **[DEFAULT]**

### Question selection
- When the game starts, the room draws 7 distinct questions at random from the
  bank. Avoid questions the same room has seen in earlier games. **[DEFAULT]**

### Question phase
- Countdown of **30 seconds**. **[DEFAULT]** The phase ends early once every
  connected player has a locked-in answer.
- Each player submits **one answer per round**. After they submit, the input
  locks and shows "Waiting for N players…". **[DEFAULT]**
- If the matcher does not recognise an answer, the player gets **no feedback
  during the round**, so they cannot fish for valid answers. They find out at
  the reveal. **[DEFAULT]**
- The server timestamps each submission when it arrives. Never trust a client
  clock. Answer time = server receive time − server question start time.
- Show other players' progress (who has answered) but never their answers.

### Reveal phase (about 10 s, or until the host clicks Next)
For each player, sorted by points this round:
- what they typed (raw), and the canonical answer it matched, e.g.
  `"indricotherium" → Paraceratherium`
- the answer's popularity (e.g. "0.4% of people said this"), plus a rarity
  label such as Common / Uncommon / Rare / Ultra-rare
- rarity points + speed bonus = round total
- a clear marker for answers that were not recognised (0 points) and for no
  answer (0 points)

Optionally also show "Top 5 most common answers" for that question, so players
learn the board.

### Standings phase (about 6 s)
- The cumulative leaderboard, with an animated "+points" gain per player and
  arrows for rank changes.

### End of game
- Final podium (top 3) and the full table. Highlight each player's rarest
  answer of the game.
- The host can press **Play again** to reuse the room with the same players.

### Disconnects
- A player who drops can reconnect within the game, keeping their seat and
  score. Identify them by a `playerId` + secret token in `localStorage`.
- A disconnected player who has not answered when the timer ends scores 0 for
  that round.
- Late joiners can enter mid-game as spectators, then play from the next
  round, starting at 0. **[DEFAULT]**

## 4. Question data format

The owner is still building the real database. Until it is ready, use
`data/questions.sample.json`. The real file will use the same schema:

```jsonc
{
  "version": 1,
  "questions": [
    {
      "id": "prehistoric-animal",
      "prompt": "Name a prehistoric animal",
      "answers": [
        {
          "canonical": "Paraceratherium",                 // shown at the reveal
          "aliases": ["Indricotherium", "Baluchitherium"], // also accepted, exact after normalizing
          "pct": 0.4                                      // % of reference respondents who gave this answer
        }
      ],
      "ambiguous": {                                     // optional
        "bush": ["George H. W. Bush", "George W. Bush"]  // input that could mean several answers
      },
      "reject": ["dragon"]                               // optional: plausible inputs that are explicitly wrong
    }
  ]
}
```

- `pct` is the answer **weight**: the percentage of a reference population
  that gave this answer. Lower `pct` means rarer and more points.
  **[DEFAULT, confirm the format of the real weights]**
- `canonical` and every alias must be unique within a question after
  normalization. `scripts/validate-data.ts` enforces this, along with: no empty
  strings, `pct > 0`, and every `ambiguous` target exists as a canonical.
  Run it in CI and in `npm test`.

## 5. Answer matching / autocorrect (the hard part)

Goal: if any reasonable person would say "yeah, that's what they meant," give
the credit. Never credit a different valid answer by mistake.

Put this in `src/shared/matcher.ts` as a pure function:

```ts
match(question, rawInput) -> {
  status: "exact" | "alias" | "fuzzy" | "ambiguous" | "rejected" | "unrecognized" | "empty",
  canonical?: string,
  pct?: number,
  input: string
}
```

Run each stage in order and stop at the first hit:

1. **Normalize** both the input and every canonical/alias, building the
   question's index once at load:
   - Unicode NFKD, then strip diacritics (`Côte d'Ivoire` → `cote d'ivoire`)
   - lowercase, trim, collapse whitespace
   - `&` → `and`; strip punctuation (`'`, `.`, `-`, `,`, `!`, etc.)
   - drop leading articles: `the`, `a`, `an`
   - Also build a **compact key** with all spaces removed
     (`t rex` / `t-rex` / `trex` → `trex`)
2. **Exact / alias lookup** on the normalized key and on the compact key.
3. **Plural / singular**: retry with simple inflection (trailing `s`, `es`,
   `ies`→`y`, and the reverse). `mammoths` → `mammoth`.
4. **Explicit reject list**: if the input matches `reject`, mark it rejected.
5. **Ambiguity table**: if the input matches a key in `ambiguous`, resolve it
   to the **most common** candidate (the safest choice, since it gives fewest
   points). Show it at the reveal as `"Bush" → George W. Bush (ambiguous)`.
   **[DEFAULT]**
6. **Fuzzy match (typos)** with Damerau-Levenshtein distance on the normalized
   key, against every canonical and alias:
   - normalized length ≤ 4: no fuzzy, exact only
   - 5–8 chars: distance ≤ 1
   - 9+ chars: distance ≤ 2 (and ≤ 20% of length)
   - Accept only if the **best candidate is unique** and beats the runner-up
     (which must be a *different* canonical) by at least 1 edit. Otherwise
     return `unrecognized`. This stops `Nigr` from being credited when
     `Niger` and `Nigeria` are both close.
   - Exact matches always win over fuzzy ones. `Niger` must never become
     `Nigeria`.
7. **Phonetic fallback (optional, behind a flag)**: Double Metaphone codes to
   catch `pterodactil`-style spellings, under the same uniqueness rule.
8. Otherwise return `unrecognized` (0 points). **[DEFAULT, see open question
   on real-but-unlisted answers]**

Also:
- Cap input at 60 characters. Reject empty or whitespace-only input.
- Two players with the same canonical answer each score it normally (no
  splitting). **[DEFAULT]**
- Log every `unrecognized` and `fuzzy` result (question id, raw input, best
  candidate, distance) to a Worker log / Analytics Engine. The owner uses
  these logs to grow the alias lists.
- Write table-driven Vitest tests for every alias in the sample data, common
  typos, plurals, diacritics, and the negative cases (`Niger`≠`Nigeria`,
  `Jupiter`≠`Zeus`, `Iran` for an Africa question).

## 6. Scoring

All in `src/shared/scoring.ts`, with constants in one config object.

**Rarity points** (the main score), from the answer's `pct`:

```
rarity = round( clamp( 1000 * log10(100 / pct) / log10(100 / MIN_PCT), 50, 1000 ) )
```

with `MIN_PCT = 0.1`. So:

| pct (popularity) | rarity points |
|---|---|
| 30%  | ~174 |
| 10%  | ~333 |
| 3%   | ~508 |
| 1%   | ~667 |
| 0.3% | ~841 |
| ≤ 0.1% | 1000 |

Any recognised answer is worth at least 50. **[DEFAULT, tune with the owner]**

**Speed bonus** (small), a multiplier on rarity, so a fast common answer still
loses to a slow rare one:

```
speedBonus = round( rarity * 0.15 * max(0, 1 - answerMs / roundMs) )
```

The speed bonus is worth at most **+15%**. Unrecognised or empty answers get
0 rarity, so they get 0 speed bonus too.

**Round total** = rarity + speedBonus. Tie-breaker on the final leaderboard:
total rarity points, then lower total answer time. **[DEFAULT]**

## 7. Realtime protocol (WebSocket, JSON)

Client → server: `join {name, playerId?, token?}`, `start`, `answer {text}`,
`next` (host skips the reveal), `playAgain`, `kick {playerId}` (host).

Server → client: `state` (a full snapshot on connect or reconnect), `lobby`,
`question {round, prompt, endsAt}`, `progress {answeredIds}`,
`reveal {rows[], topAnswers[]}`, `standings {rows[]}`, `gameOver {...}`,
`error {code, message}`.

- The server is the only authority. Clients never see the answer list or
  `pct` values before the reveal: **do not send the question's answer data to
  the client**.
- Send `endsAt` as a server epoch ms, and have the client correct for clock
  skew with an offset measured on connect.
- Validate every message with a schema (e.g. zod). Rate-limit `answer` to one
  accepted submission per round.

## 8. UI / UX

- Mobile-first. It must work well on phones in portrait, since people will
  play from the couch.
- Big readable prompt, a large input with autofocus, Enter to submit, and a
  countdown bar.
- The reveal and standings should feel like a game show: staggered row
  reveals, count-up numbers, and a highlight on the rarest answer of the round.
- Room code and a "copy invite link" button are always visible in the lobby.
- No accounts, no sign-up.

## 9. Deliverables / definition of done

- `npm run dev` runs everything locally through `wrangler dev`, and two
  browser tabs can play a full 7-round game.
- `npm test` passes (matcher, scoring, data validation, and room state
  transitions using `@cloudflare/vitest-pool-workers`).
- `npm run deploy` deploys to `*.workers.dev` with Wrangler.
- A README with setup, deploy steps, and how to add or edit questions and aliases.

---

## Open questions (to resolve with the owner)

1. Format of the real answer weights (percentages? raw counts? point values?)
2. Real-but-unlisted answers: 0 points, a flat "rare" score, or manual review?
3. One locked answer per round vs. multiple attempts / resubmits?
4. Penalty or bonus when several players give the same answer?
5. Round timer length; reveal/standings auto-advance or host-controlled?
6. Player cap, public matchmaking vs. private room codes only?
7. How strict should autocorrect be; is an AI fallback (Workers AI) for
   uncertain matches acceptable?
8. Ambiguous inputs ("Bush", "Congo"): credit the most common candidate,
   the rarest, or ask the player to clarify?
9. Question selection: random, categories, host picks, difficulty curve?
10. Custom domain or `*.workers.dev`; free or paid Workers plan?
