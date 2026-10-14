import { useState } from "react";
import type { ClientMessage, PublicState } from "../../shared/protocol";
import { Avatar } from "../components/Avatar";

export function Lobby({ state, send }: { state: PublicState; send: (m: ClientMessage) => void }) {
  const [copied, setCopied] = useState(false);
  const isHost = state.me?.id === state.hostId;
  const link = `${location.origin}/r/${state.code}`;
  const empty = Math.max(0, state.maxPlayers - state.players.length);

  async function copy() {
    try {
      if (navigator.share && matchMedia("(pointer: coarse)").matches) {
        await navigator.share({ title: "Multrillion", text: `Join my Multrillion game: ${state.code}`, url: link });
      } else {
        await navigator.clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } catch {
      // Share sheet dismissed.
    }
  }

  return (
    <main className="screen lobby">
      <div className="card stack center-text">
        <p className="muted">Room code</p>
        <div className="room-code big">{state.code}</div>
        <button className="btn" onClick={copy}>
          {copied ? "Link copied!" : "Copy invite link"}
        </button>
      </div>

      <div className="card">
        <h2 className="card-title">
          Players <span className="muted">{state.players.length}/{state.maxPlayers}</span>
        </h2>
        <ul className="player-list">
          {state.players.map((p) => (
            <li key={p.id} className={p.connected ? "" : "offline"}>
              <Avatar name={p.name} />
              <span className="pname">
                {p.name}
                {p.id === state.me?.id && <span className="you"> (you)</span>}
              </span>
              {p.id === state.hostId && <span className="tag">Host</span>}
              {!p.connected && <span className="tag dim">Offline</span>}
            </li>
          ))}
          {Array.from({ length: empty }, (_, i) => (
            <li key={`empty-${i}`} className="empty-slot">
              Waiting for player…
            </li>
          ))}
        </ul>
      </div>

      {isHost ? (
        <button className="btn primary big" onClick={() => send({ t: "start" })}>
          Start game
        </button>
      ) : (
        <p className="muted center-text">Waiting for the host to start…</p>
      )}
    </main>
  );
}
