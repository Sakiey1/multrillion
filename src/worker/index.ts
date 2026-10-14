export { GameRoom } from "./room";

// No I/O/0/1 lookalikes.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_RE = /^[A-Z]{4}$/;

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

function room(env: Env, code: string) {
  return env.ROOMS.get(env.ROOMS.idFromName(code));
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/rooms" && request.method === "POST") {
      for (let i = 0; i < 8; i++) {
        const code = randomCode();
        const res = await room(env, code).fetch("https://room/init", {
          method: "POST",
          body: JSON.stringify({ code }),
        });
        if (res.ok) return Response.json({ code });
      }
      return Response.json({ error: "Could not allocate a room code" }, { status: 503 });
    }

    const info = /^\/api\/rooms\/([A-Za-z]{4})$/.exec(path);
    if (info && request.method === "GET") {
      const code = info[1].toUpperCase();
      return room(env, code).fetch("https://room/info");
    }

    const ws = /^\/ws\/([A-Za-z]{4})$/.exec(path);
    if (ws) {
      const code = ws[1].toUpperCase();
      if (!CODE_RE.test(code)) return new Response("bad code", { status: 400 });
      return room(env, code).fetch(new Request("https://room/ws", request));
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
