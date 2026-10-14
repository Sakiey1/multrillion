import { motion } from "motion/react";
import { navigate } from "../App";
import type { ClientMessage, PublicState } from "../../shared/protocol";
import { Avatar } from "../components/Avatar";
import { TierBadge } from "../components/TierBadge";

export function Final({ state, send }: { state: PublicState; send: (m: ClientMessage) => void }) {
  const ranked = [...state.players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  // Podium order: 2nd, 1st, 3rd.
  const podium = [ranked[1], ranked[0], ranked[2]];
  const heights = [110, 150, 80];
  const places = [2, 1, 3];
  const isHost = state.me?.id === state.hostId;

  return (
    <main className="screen final">
      <motion.h1 className="final-title" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
        {ranked[0] ? `${ranked[0].name} wins!` : "Game over"}
      </motion.h1>

      <div className="podium">
        {podium.map((p, i) =>
          p ? (
            <motion.div
              key={p.id}
              className={`podium-col place-${places[i]}`}
              initial={{ y: 60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: [0.6, 1.1, 0.2][i], type: "spring", stiffness: 160, damping: 16 }}
            >
              <Avatar name={p.name} size={places[i] === 1 ? 56 : 44} />
              <div className="podium-name">{p.name}</div>
              <div className="podium-score">{p.score}</div>
              <div className="podium-block" style={{ height: heights[i] }}>
                {places[i]}
              </div>
            </motion.div>
          ) : (
            <div key={`empty-${i}`} className="podium-col" />
          ),
        )}
      </div>

      <ol className="final-list card">
        {ranked.map((p, i) => {
          const best = state.best?.[p.id];
          return (
            <li key={p.id} className={p.id === state.me?.id ? "me" : ""}>
              <span className="rank">{i + 1}</span>
              <Avatar name={p.name} size={30} />
              <div className="board-main">
                <div className="board-name">{p.name}</div>
                {best ? (
                  <div className="best">
                    Best: <strong>{best.answer}</strong> <TierBadge points={best.points} />
                  </div>
                ) : (
                  <div className="best muted">No answers</div>
                )}
              </div>
              <span className="total">{p.score}</span>
            </li>
          );
        })}
      </ol>

      <div className="row center">
        {isHost ? (
          <button className="btn primary big" onClick={() => send({ t: "playAgain" })}>
            Play again
          </button>
        ) : (
          <p className="muted">Waiting for the host to start another game…</p>
        )}
        <button className="btn" onClick={() => navigate("/")}>
          Leave
        </button>
      </div>
    </main>
  );
}
