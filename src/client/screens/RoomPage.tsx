import { useEffect, useState } from "react";
import { navigate } from "../App";
import { loadCredentials, loadName, saveName, useRoom } from "../connection";
import { Final } from "./Final";
import { Lobby } from "./Lobby";
import { QuestionScreen } from "./Question";
import { Results } from "./Results";

type RoomInfo = { phase: string; players: number; maxPlayers: number } | "missing" | null;

export function RoomPage({ code, autoName }: { code: string; autoName: string | null }) {
  const hasCreds = !!loadCredentials(code);
  const [name, setName] = useState<string | null>(autoName ?? (hasCreds ? loadName() || "?" : null));
  const [draft, setDraft] = useState(loadName);
  const [info, setInfo] = useState<RoomInfo>(null);
  const room = useRoom(code, name);

  useEffect(() => {
    fetch(`/api/rooms/${code}`)
      .then((r) => (r.ok ? r.json() : "missing"))
      .then(setInfo)
      .catch(() => setInfo("missing"));
  }, [code]);

  // Name rejected by the server: go back to the name form.
  useEffect(() => {
    if (room.error && ["name_taken", "bad_name", "room_full"].includes(room.error.code)) setName(null);
  }, [room.error]);

  if (info === "missing") {
    return (
      <main className="screen center">
        <div className="card stack">
          <h2>Room {code} not found</h2>
          <p className="muted">It may have expired. Ask for a new link or start your own game.</p>
          <button className="btn primary" onClick={() => navigate("/")}>
            Back home
          </button>
        </div>
      </main>
    );
  }

  if (name === null) {
    const submit = (e: React.FormEvent) => {
      e.preventDefault();
      const n = draft.trim();
      if (!n) return;
      saveName(n);
      room.clearError();
      setName(n);
    };
    return (
      <main className="screen center">
        <form className="card stack" onSubmit={submit}>
          <p className="muted">Joining room</p>
          <div className="room-code">{code}</div>
          <label className="field">
            <span>Your name</span>
            <input autoFocus value={draft} maxLength={16} onChange={(e) => setDraft(e.target.value)} />
          </label>
          <button className="btn primary big" type="submit" disabled={!draft.trim()}>
            Join game
          </button>
          {room.error && <p className="error">{room.error.message}</p>}
        </form>
      </main>
    );
  }

  const s = room.state;
  return (
    <div className="app">
      <header className="topbar">
        <button className="logo small" onClick={() => navigate("/")}>
          Multr<span>illion</span>
        </button>
        {s && s.phase !== "lobby" && (
          <span className="round-pill">
            Round {Math.min(s.round, s.totalRounds)}/{s.totalRounds}
          </span>
        )}
        <span className="code-pill">{code}</span>
      </header>
      {room.status !== "open" && (
        <div className="banner">{room.status === "closed" ? room.error?.message : "Reconnecting…"}</div>
      )}
      {!s ? (
        <main className="screen center">
          <div className="spinner" />
        </main>
      ) : s.phase === "lobby" ? (
        <Lobby state={s} send={room.send} />
      ) : s.phase === "question" ? (
        <QuestionScreen key={s.round} state={s} attempt={room.attempt} send={room.send} now={room.now} />
      ) : s.phase === "results" ? (
        <Results key={s.round} state={s} send={room.send} />
      ) : (
        <Final state={s} send={room.send} />
      )}
    </div>
  );
}
