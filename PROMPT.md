# Multrillion: Build Prompt

> The spec for Multrillion, a real-time multiplayer game inspired by Krillion.
> This revision includes the owner's answers to the first round of questions,
> and the code in this repo implements it. Items still open are listed at the
> bottom.

---

## 1. The game

A browser-based multiplayer party game for **up to 5 players**. Everyone gets
the same open-ended prompt, such as **"Name a prehistoric animal"**, and has 30
seconds to enter an answer. **Only answers in the database are accepted.**
**The rarer the answer, the more points it scores.** Speed adds a small bonus,
but never enough to beat a rarer answer.

A game is **7 rounds**. Each round:

1. **Lead-in** (3 s): "Round N of 7" countdown.
2. **Question** (30 s): players type answers. An answer that isn't on the list
   is rejected ("isn't on the list, try another"), and the player can keep
   trying. The first **valid** answer locks in. The round ends early once every
   connected player has locked in.
3. **Short animation**: "Time's up!" or "All answers in!".
4. **Leaderboard**: every player's answer is revealed one by one, weakest
   first, best last. Each row shows the answer, its rarity tier, the speed
   bonus and "+points". Totals then count up and the rows animate into their
   new rank order.
5. **Ready**: every connected player must click **Ready** before the next
   round starts. Disconnected players don't hold the game up.
6. After round 7: a final **podium**, the full standings, and each player's
   best answer of the game. The host can **Play again**, which returns everyone
   to the lobby with scores reset.

## 2. Points

The question bank sets points per answer:

| Tier | Points |
|---|---|
| Not on the list / no answer | 0 |
| Common | 10 |
| Uncommon | 30 |
| Rare | 60 |
| Extraordinary | 85 |
| One in a million | 100 |

**Speed bonus** = `round(points × 0.15 × timeRemaining / 30s)`. The most it can
add is 15% of the answer's points. 15% was chosen so tiers never overlap: the
fastest possible 85 (97.75) still loses to the slowest 100. Time is measured
on the server, from when the question opens to when the player's **valid**
submission arrives. Time spent on rejected attempts counts against the player.

Two players who give the same answer both score it normally.

## 3. Question bank format

`data/questions.txt` uses the owner's format:

```
Name a style of beer
* Grisette+100
* Kölsch+60
* Stout +10

Name a prehistoric animal
* Paraceratherium | Indricotherium | Baluchitherium +85
```

- A line that does not start with `*` or `#` starts a new question.
- `* Name +points`, with or without a space before `+`.
- Optional **aliases** go after `|`. Every alias scores the same as the first
  name, and the first name is what the leaderboard shows.
- Lines starting with `#` are comments.
- `npm run check-data` lints the file. It reports unreadable lines, empty
  questions, unusual point values, and any two answers that normalize to the
  same text. `npm run deploy` runs it automatically.

**Question selection:** each round draws one question at random from the whole
bank, independently of the others, skipping questions already used in the
current game. With a large bank, two games rarely share more than a question.

## 4. Answer matching (autocorrect)

Every answer is checked on the server. The client never receives the answer
list.

1. **Normalize**: lowercase, strip accents (`Côte d'Ivoire` → `cote divoire`),
   strip punctuation, collapse spaces, and drop a leading "the/a/an". Umlauts
   are also tried spelled out (`Kölsch` matches both `kolsch` and `koelsch`).
   Spaces are ignored as well (`t-rex` = `t rex` = `trex`).
2. **Exact or alias match.**
3. **Plural/singular** (`mammoths` → Woolly mammoth, `IPAs` → IPA).
4. **Typos**: Damerau-Levenshtein distance, scaled by length. Up to 4 letters
   must match exactly; 5–7 letters allow 1 typo; 8–14 allow 2; 15+ allow 3. A
   typo only counts if one answer is **clearly** the closest. Exact matches
   always win, so "Niger" never becomes "Nigeria".
5. **AI fallback (lenient)**: if the rules find nothing, Workers AI
   (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) gets the prompt, the full
   numbered answer list and the player's input. It accepts synonyms, alternate
   or historical names, translations, nicknames, abbreviations, phonetic
   spellings, and "a specific example of exactly one entry". It returns an
   entry number, so it can only ever choose something that's on the list.
   - If the input could mean 2–4 entries (e.g. "Bush" when both Bushes are
     listed), the player gets a **"Which one did you mean?"** picker.
   - AI verdicts are cached per room. Players are limited to 8 AI checks per
     round and one attempt every 300 ms.
   - If an AI check is still running when the timer ends, the round waits up
     to 6 s for it.
   - Every AI decision and every unrecognised answer is logged
     (`wrangler tail` or Workers Logs), so the owner can see what people type
     and add aliases.

## 5. Rooms and players

- **Create game** returns a 4-letter room code (no I or O) and an invite link
  `/r/CODE`. No accounts.
- Up to **5 players**. Names are unique per room, 1–16 characters.
- The creator is the host and starts the game. If the host disconnects, the
  longest-connected player becomes host.
- **Reconnect**: a `playerId` and secret token are kept in `localStorage`.
  Reloading the page or a dropped connection rejoins the same seat with the
  same score. Joining from another device with the same name takes over a
  *disconnected* seat.
- Players can join mid-game, starting at 0, while there are free seats.
- Rooms delete themselves after 2 hours with nobody connected.

## 6. Architecture

- **Cloudflare Workers**, deployed with **Wrangler**, built with **Vite** and
  `@cloudflare/vite-plugin`.
- **Durable Object `GameRoom`** (SQLite-backed, so it works on the free plan):
  one per room code. It holds all state, owns the WebSockets (Hibernation
  API), runs the round timer with `alarm()`, and does all matching and
  scoring. State is persisted on every change.
- **Workers AI** binding `AI` for the fallback matcher.
- **Frontend**: React + TypeScript + `motion` for animations, served as Workers
  Static Assets from the same Worker.
- The question bank is bundled into the Worker at build time. If it grows past
  a few MB, move it to D1 or KV behind `src/worker/bank.ts`.

```
data/questions.txt         question bank
src/shared/                code shared by client and worker
  questions.ts             parser and tiers
  normalize.ts, matcher.ts rule-based matching
  scoring.ts               round length, rounds, player cap, speed bonus
  protocol.ts              WebSocket message types
src/worker/
  index.ts                 HTTP routes: POST /api/rooms, GET /api/rooms/:code, /ws/:code
  room.ts                  GameRoom Durable Object (game state machine)
  ai.ts                    Workers AI fallback
  bank.ts                  loads the bank and picks questions
src/client/                React app (Home, Lobby, Question, Results, Final)
scripts/check-data.ts      question bank linter
test/                      Vitest unit tests
```

## 7. Open questions

1. **What does "one in a million" mean in the data?** Right now it is just
   the 100-point tier. Should it get extra fanfare beyond the gold shimmer?
2. **AI strictness in practice:** once there's real play data, review the
   `ai_match` logs together and decide whether it's too lenient.
3. **Ready-up stalls:** if a player stays connected but never clicks Ready,
   the game waits forever. Should the host be able to skip them, or should
   Ready auto-trigger after something like 60 s?
4. **Showing missed answers:** after each round, should the leaderboard show
   a few answers nobody gave (e.g. "You could have said: Grisette (100)")?
