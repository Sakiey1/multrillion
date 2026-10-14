import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { AttemptStatus, ClientMessage, PublicState } from "../../shared/protocol";
import { Avatar } from "../components/Avatar";

function useNow(now: () => number) {
  const [t, setT] = useState(now);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setT(now());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [now]);
  return t;
}

interface Props {
  state: PublicState;
  attempt: AttemptStatus | null;
  send: (m: ClientMessage) => void;
  now: () => number;
}

export function QuestionScreen({ state, attempt, send, now }: Props) {
  const q = state.question!;
  const t = useNow(now);
  const [text, setText] = useState("");
  const [shake, setShake] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const open = t >= q.startedAt;
  const remainingMs = Math.max(0, q.endsAt - t);
  const fraction = Math.min(1, remainingMs / q.durationMs);
  const locked = state.me?.locked ?? (attempt?.status === "accepted" ? { input: attempt.input, answer: attempt.answer } : null);
  const checking = attempt?.status === "checking";

  useEffect(() => {
    if (attempt?.status === "invalid") {
      setShake((n) => n + 1);
      inputRef.current?.select();
    }
  }, [attempt]);

  useEffect(() => {
    if (open && !locked) inputRef.current?.focus();
  }, [open, locked]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value || checking || locked) return;
    send({ t: "answer", text: value });
  }

  if (!open) {
    const count = Math.ceil((q.startedAt - t) / 1000);
    return (
      <main className="screen center">
        <motion.div
          className="lead-in"
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 18 }}
        >
          <p className="muted">Round {state.round} of {state.totalRounds}</p>
          <div className="lead-count">{Math.max(1, count)}</div>
          <p className="muted">Get ready…</p>
        </motion.div>
      </main>
    );
  }

  return (
    <main className="screen question">
      <div className="timer">
        <div
          className={`timer-fill ${remainingMs < 5000 ? "urgent" : ""}`}
          style={{ transform: `scaleX(${fraction})` }}
        />
        <span className="timer-text">{Math.ceil(remainingMs / 1000)}s</span>
      </div>

      <motion.h1
        className="prompt"
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.35 }}
      >
        {q.prompt}
      </motion.h1>

      <AnimatePresence mode="wait">
        {locked ? (
          <motion.div
            key="locked"
            className="locked card"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
          >
            <p className="muted">Locked in</p>
            <p className="locked-answer">{locked.answer}</p>
            {normalizeDisplay(locked.input) !== normalizeDisplay(locked.answer) && (
              <p className="muted small">you typed “{locked.input}”</p>
            )}
          </motion.div>
        ) : (
          <motion.form key="input" className="answer-form" onSubmit={submit} exit={{ opacity: 0, y: -10 }}>
            <motion.div
              key={shake}
              animate={shake ? { x: [0, -10, 10, -6, 6, 0] } : {}}
              transition={{ duration: 0.35 }}
              className="answer-row"
            >
              <input
                ref={inputRef}
                className="answer-input"
                value={text}
                maxLength={60}
                placeholder="Type your answer…"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="send"
                disabled={checking}
                onChange={(e) => setText(e.target.value)}
              />
              <button className="btn primary" type="submit" disabled={checking || !text.trim()}>
                {checking ? <span className="spinner small" /> : "Go"}
              </button>
            </motion.div>
            <Feedback attempt={attempt} send={send} />
          </motion.form>
        )}
      </AnimatePresence>

      <ul className="answered-list">
        {state.players.map((p) => (
          <li key={p.id} className={`${p.answered ? "done" : ""} ${p.connected ? "" : "offline"}`}>
            <Avatar name={p.name} size={28} />
            <span>{p.name}</span>
            <span className="check">{p.answered ? "✓" : "…"}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}

function Feedback({ attempt, send }: { attempt: AttemptStatus | null; send: (m: ClientMessage) => void }) {
  if (!attempt) return <p className="hint">Only answers on the list count. Keep trying until one sticks!</p>;
  switch (attempt.status) {
    case "checking":
      return <p className="hint">Checking “{attempt.input}”…</p>;
    case "invalid":
      return (
        <p className="error">
          {attempt.reason === "Not on the list" ? `“${attempt.input}” isn't on the list. Try another.` : attempt.reason}
        </p>
      );
    case "ambiguous":
      return (
        <div className="ambiguous">
          <p className="hint">Which one did you mean?</p>
          <div className="options">
            {attempt.options.map((o) => (
              <button key={o} type="button" className="btn" onClick={() => send({ t: "answer", text: o })}>
                {o}
              </button>
            ))}
          </div>
        </div>
      );
    default:
      return null;
  }
}

function normalizeDisplay(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}
