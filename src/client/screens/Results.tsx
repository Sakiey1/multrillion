import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import type { ClientMessage, PublicState, ResultRow } from "../../shared/protocol";
import { Avatar } from "../components/Avatar";
import { TierBadge } from "../components/TierBadge";

// Animation timeline (ms).
const SPLASH_MS = 1400;
const REVEAL_GAP_MS = 700;
const COUNT_MS = 900;

type Stage = "splash" | "reveal" | "count" | "sorted";

function useCountUp(from: number, to: number, run: boolean, duration = COUNT_MS) {
  const [value, setValue] = useState(from);
  useEffect(() => {
    if (!run) {
      setValue(from);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(from + (to - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [from, to, run, duration]);
  return value;
}

export function Results({ state, send }: { state: PublicState; send: (m: ClientMessage) => void }) {
  // Freeze this round's results so later state pushes (e.g. ready ticks) don't restart the animation.
  const [results] = useState(() => state.results!);
  const rows = results.rows;
  const [stage, setStage] = useState<Stage>("splash");
  const [revealed, setRevealed] = useState(0);
  const everyoneAnswered = rows.every((r) => r.answer);

  // Reveal the weakest answers first and save the best for last.
  const revealOrder = useMemo(
    () => [...rows].sort((a, b) => a.gained - b.gained || a.name.localeCompare(b.name)).map((r) => r.playerId),
    [rows],
  );

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    at(SPLASH_MS, () => setStage("reveal"));
    revealOrder.forEach((_, i) => at(SPLASH_MS + 400 + i * REVEAL_GAP_MS, () => setRevealed(i + 1)));
    const revealDone = SPLASH_MS + 400 + revealOrder.length * REVEAL_GAP_MS;
    at(revealDone + 200, () => setStage("count"));
    at(revealDone + 200 + COUNT_MS + 300, () => setStage("sorted"));
    return () => timers.forEach(clearTimeout);
  }, [revealOrder]);

  const ordered = useMemo(() => {
    const key = stage === "sorted" ? (r: ResultRow) => r.newScore : (r: ResultRow) => r.prevScore;
    return [...rows].sort((a, b) => key(b) - key(a) || a.name.localeCompare(b.name));
  }, [rows, stage]);

  const prevRank = useMemo(() => {
    const m = new Map<string, number>();
    [...rows].sort((a, b) => b.prevScore - a.prevScore).forEach((r, i) => m.set(r.playerId, i));
    return m;
  }, [rows]);

  const rarest = useMemo(() => {
    const best = Math.max(...rows.map((r) => r.points));
    return best > 0 ? rows.filter((r) => r.points === best).map((r) => r.playerId) : [];
  }, [rows]);

  const me = state.players.find((p) => p.id === state.me?.id);
  const isLast = state.round >= state.totalRounds;
  const waitingOn = state.players.filter((p) => p.connected && !p.ready).length;

  return (
    <main className="screen results">
      <AnimatePresence>
        {stage === "splash" && (
          <motion.div
            className="splash"
            initial={{ scale: 0.4, opacity: 0, rotate: -6 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            exit={{ scale: 1.4, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 16 }}
          >
            {everyoneAnswered ? "All answers in!" : "Time's up!"}
          </motion.div>
        )}
      </AnimatePresence>

      {stage !== "splash" && (
        <>
          <motion.p className="results-prompt" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            {results.prompt}
          </motion.p>

          <motion.ol className="board" layout>
            {ordered.map((r, i) => {
              const shown = revealOrder.indexOf(r.playerId) < revealed;
              const player = state.players.find((p) => p.id === r.playerId);
              const moved = stage === "sorted" ? (prevRank.get(r.playerId) ?? i) - i : 0;
              return (
                <motion.li
                  key={r.playerId}
                  layout
                  transition={{ layout: { type: "spring", stiffness: 200, damping: 24 } }}
                  className={`board-row ${r.playerId === state.me?.id ? "me" : ""} ${
                    shown && rarest.includes(r.playerId) ? "rarest" : ""
                  }`}
                >
                  <span className="rank">
                    {i + 1}
                    {moved !== 0 && <span className={moved > 0 ? "up" : "down"}>{moved > 0 ? "▲" : "▼"}</span>}
                  </span>
                  <Avatar name={r.name} size={34} />
                  <div className="board-main">
                    <div className="board-name">
                      {r.name}
                      {player?.ready && stage === "sorted" && <span className="ready-dot">Ready</span>}
                    </div>
                    <AnswerReveal row={r} shown={shown} />
                  </div>
                  <div className="board-score">
                    <AnimatePresence>
                      {shown && (
                        <motion.span
                          className={`gain ${r.gained ? "" : "zero"}`}
                          initial={{ y: 10, opacity: 0, scale: 0.6 }}
                          animate={{ y: 0, opacity: 1, scale: 1 }}
                        >
                          +{r.gained}
                        </motion.span>
                      )}
                    </AnimatePresence>
                    <Score row={r} run={stage === "count" || stage === "sorted"} />
                  </div>
                </motion.li>
              );
            })}
          </motion.ol>

          {stage === "sorted" && (
            <motion.div className="ready-area" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              {me?.ready ? (
                <p className="muted">
                  Waiting for {waitingOn} player{waitingOn === 1 ? "" : "s"}…
                </p>
              ) : (
                <button className="btn primary big" onClick={() => send({ t: "ready" })}>
                  {isLast ? "See final results" : "Ready for next round"}
                </button>
              )}
            </motion.div>
          )}
        </>
      )}
    </main>
  );
}

function AnswerReveal({ row, shown }: { row: ResultRow; shown: boolean }) {
  if (!shown) return <div className="board-answer hidden">• • •</div>;
  if (!row.answer) {
    return (
      <motion.div className="board-answer none" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        No answer
      </motion.div>
    );
  }
  const typedDifferently =
    row.input && row.input.toLowerCase().replace(/[^a-z0-9]/g, "") !== row.answer.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (
    <motion.div className="board-answer" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}>
      <span className="answer-text">{row.answer}</span>
      <TierBadge points={row.points} />
      {row.speedBonus > 0 && <span className="speed">⚡+{row.speedBonus}</span>}
      {typedDifferently && <span className="typed">“{row.input}”</span>}
    </motion.div>
  );
}

function Score({ row, run }: { row: ResultRow; run: boolean }) {
  const value = useCountUp(row.prevScore, row.newScore, run);
  return <span className="total">{value}</span>;
}
