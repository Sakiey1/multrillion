// WebSocket connection to a room, with automatic reconnect and server-clock sync.

import { useCallback, useEffect, useRef, useState } from "react";
import type { AttemptStatus, ClientMessage, PublicState, ServerMessage } from "../shared/protocol";

interface Credentials {
  playerId: string;
  token: string;
}

const credKey = (code: string) => `multrillion:room:${code}`;

export function loadCredentials(code: string): Credentials | null {
  try {
    const raw = localStorage.getItem(credKey(code));
    return raw ? (JSON.parse(raw) as Credentials) : null;
  } catch {
    return null;
  }
}

function saveCredentials(code: string, creds: Credentials) {
  try {
    localStorage.setItem(credKey(code), JSON.stringify(creds));
  } catch {
    // Private mode: reconnect just won't survive a reload.
  }
}

export function loadName(): string {
  try {
    return localStorage.getItem("multrillion:name") ?? "";
  } catch {
    return "";
  }
}

export function saveName(name: string) {
  try {
    localStorage.setItem("multrillion:name", name);
  } catch {
    // ignore
  }
}

export type ConnStatus = "connecting" | "open" | "reconnecting" | "closed";

export interface Room {
  status: ConnStatus;
  state: PublicState | null;
  attempt: AttemptStatus | null;
  error: { code: string; message: string } | null;
  /** Estimated server time in ms. */
  now: () => number;
  send: (msg: ClientMessage) => void;
  clearError: () => void;
}

/** Connects once `name` is set (or immediately if we have saved credentials). */
export function useRoom(code: string, name: string | null): Room {
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [state, setState] = useState<PublicState | null>(null);
  const [attempt, setAttempt] = useState<AttemptStatus | null>(null);
  const [error, setError] = useState<Room["error"]>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const offsetRef = useRef(0);
  const bestRttRef = useRef(Infinity);
  const lastRef = useRef<PublicState | null>(null);

  useEffect(() => {
    if (name === null) return;
    let closed = false;
    let retry = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws/${code}`);
      wsRef.current = ws;

      ws.onopen = () => {
        retry = 0;
        setStatus("open");
        const creds = loadCredentials(code);
        ws.send(JSON.stringify({ t: "join", name, ...creds } satisfies ClientMessage));
        const ping = () => ws.send(JSON.stringify({ t: "ping", clientTime: Date.now() } satisfies ClientMessage));
        ping();
        pingTimer = setInterval(ping, 10_000);
      };

      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string) as ServerMessage;
        switch (msg.t) {
          case "welcome":
            saveCredentials(code, { playerId: msg.playerId, token: msg.token });
            setError(null);
            break;
          case "state":
            // A new round or phase clears the last attempt's feedback.
            if (lastRef.current?.round !== msg.state.round || lastRef.current?.phase !== msg.state.phase) {
              setAttempt(null);
            }
            lastRef.current = msg.state;
            setState(msg.state);
            break;
          case "attempt": {
            const { t: _t, ...a } = msg;
            setAttempt(a as AttemptStatus);
            break;
          }
          case "pong": {
            const now = Date.now();
            const rtt = now - msg.clientTime;
            if (rtt <= bestRttRef.current) {
              bestRttRef.current = rtt;
              offsetRef.current = msg.serverTime + rtt / 2 - now;
            }
            break;
          }
          case "error":
            setError({ code: msg.code, message: msg.message });
            break;
        }
      };

      ws.onclose = (ev) => {
        clearInterval(pingTimer);
        if (closed) return;
        if (ev.code === 4001 || ev.code === 4004) {
          setStatus("closed");
          setError({ code: "closed", message: ev.reason || "Disconnected" });
          return;
        }
        setStatus("reconnecting");
        retry += 1;
        retryTimer = setTimeout(connect, Math.min(8000, 500 * 2 ** retry));
      };
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(retryTimer);
      clearInterval(pingTimer);
      wsRef.current?.close();
    };
  }, [code, name]);

  const now = useCallback(() => Date.now() + offsetRef.current, []);
  const send = useCallback((msg: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(msg));
  }, []);
  const clearError = useCallback(() => setError(null), []);

  return { status, state, attempt, error, now, send, clearError };
}
