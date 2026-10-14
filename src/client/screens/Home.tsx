import { useState } from "react";
import { navigate } from "../App";
import { loadName, saveName } from "../connection";

export function Home() {
  const [name, setName] = useState(loadName);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();

  async function create() {
    if (!trimmed) return setError("Enter your name first");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/rooms", { method: "POST" });
      if (!res.ok) throw new Error();
      const { code } = (await res.json()) as { code: string };
      saveName(trimmed);
      navigate(`/r/${code}`, { name: trimmed });
    } catch {
      setError("Couldn't create a game. Try again.");
      setBusy(false);
    }
  }

  function join(e: React.FormEvent) {
    e.preventDefault();
    if (!trimmed) return setError("Enter your name first");
    const c = code.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(c)) return setError("Room codes are 4 letters");
    saveName(trimmed);
    navigate(`/r/${c}`, { name: trimmed });
  }

  return (
    <main className="screen home">
      <h1 className="logo">
        Multr<span>illion</span>
      </h1>
      <p className="tagline">Name it. The rarer the answer, the bigger the points.</p>

      <div className="card stack">
        <label className="field">
          <span>Your name</span>
          <input
            value={name}
            maxLength={16}
            autoComplete="nickname"
            placeholder="e.g. Sam"
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <button className="btn primary big" disabled={busy} onClick={create}>
          {busy ? "Creating…" : "Create game"}
        </button>

        <div className="divider">
          <span>or join one</span>
        </div>

        <form className="row" onSubmit={join}>
          <input
            className="code-input"
            value={code}
            maxLength={4}
            placeholder="CODE"
            autoCapitalize="characters"
            autoComplete="off"
            onChange={(e) => setCode(e.target.value.replace(/[^a-z]/gi, "").toUpperCase())}
          />
          <button className="btn" type="submit">
            Join
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </div>

      <section className="how">
        <h2>How it works</h2>
        <ol>
          <li>Up to 5 players, 7 rounds, 30 seconds each.</li>
          <li>Type any valid answer. Rare answers score up to 100, common ones 10.</li>
          <li>Faster answers earn a small bonus, but rarity matters most.</li>
        </ol>
      </section>
    </main>
  );
}
