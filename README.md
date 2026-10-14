# Multrillion

A multiplayer party game inspired by Krillion. Up to 5 players, 7 rounds. Name
something that fits the prompt, and the rarer your answer, the more points you
score. See [`PROMPT.md`](PROMPT.md) for the full spec.

Built on Cloudflare Workers, Durable Objects and Workers AI, with a React
frontend.

## Setup

```sh
npm install
npx wrangler login        # needed for the Workers AI fallback, even in dev
npm run dev               # http://localhost:5173
```

Open the URL in two browser windows (or on your phone over your LAN, using
`npm run dev -- --host`) to play against yourself.

To work without a Cloudflare login, run `npm run dev:offline`. Everything works
except the AI fallback, so only exact, alias, plural and typo matches are
accepted.

## Deploy

```sh
npm run deploy
```

This lints the question bank, builds the app and runs `wrangler deploy`. The
game goes live at `https://multrillion.<your-subdomain>.workers.dev`. Durable
Objects (SQLite) and Workers AI both work on the free plan. Workers AI's free
allowance is 10,000 neurons a day, which is plenty for testing.

To see AI decisions and unrecognised answers live:

```sh
npx wrangler tail
```

## Editing questions

Edit [`data/questions.txt`](data/questions.txt):

```
Name a prehistoric animal
* Paraceratherium | Indricotherium | Baluchitherium +85
* Woolly mammoth +10
```

Points: 10 common, 30 uncommon, 60 rare, 85 extraordinary, 100 one in a
million. Names after `|` are aliases. Typos, plurals, accents and synonyms are
handled automatically, so add aliases only for alternate names you want
matched without relying on the AI.

Run `npm run check-data` to lint the file.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Local dev server with hot reload |
| `npm run dev:offline` | Same, without remote bindings (no AI fallback) |
| `npm test` | Unit tests (matcher, scoring, AI reply parsing, bank) |
| `npm run typecheck` | TypeScript for worker, client and scripts |
| `npm run check-data` | Lint `data/questions.txt` |
| `npm run deploy` | Lint, build and deploy to Cloudflare |

## Tuning

The game constants live in `src/shared/scoring.ts`: round length, number of
rounds, player cap and speed bonus. Lead-in time, AI limits and the room
cleanup timeout are at the top of `src/worker/room.ts`. The AI model is set by
`AI_MODEL` in `wrangler.jsonc`.
