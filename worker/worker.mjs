// Cloudflare Worker entry: static assets + a single Durable Object that hosts the memorial room.
// Room logic is shared with the local Node server (server/room.mjs).
import { DurableObject } from "cloudflare:workers";
import { createRoom, CAPACITY } from "../server/room.mjs";
import graves from "../data/graves.json";

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });

const parseCookies = (h = "") =>
  Object.fromEntries(h.split(";").map((c) => c.trim().split("=")).filter((x) => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join("="))]));

export class MemorialRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const memorial = Object.fromEntries(
        [...(await ctx.storage.list({ prefix: "m:" }))].map(([k, v]) => [k.slice(2), v]),
      );
      const feed = (await ctx.storage.get("feed")) || [];
      this.room = createRoom({
        graves,
        saved: { memorial, feed },
        save: ({ memorial, feed, changed }) => {
          const entries = { feed };
          if (changed) entries[`m:${changed}`] = memorial[changed];
          ctx.storage.put(entries);
        },
        getSession: (sid) => ctx.storage.get(`s:${sid}`),
        putSession: (sid, profile) => ctx.storage.put(`s:${sid}`, profile),
      });
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const room = this.room;
    switch (url.pathname) {
      case "/api/health":
        return json({ ok: true, online: room.online(), capacity: CAPACITY });
      case "/api/memorial":
        return json(room.memorialSnapshot());
      case "/api/session": {
        if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
        let body = {};
        try { body = await request.json(); } catch {}
        const r = await room.createSession(body.name);
        if (!r.ok) return json({ error: r.error }, 400);
        const secure = url.protocol === "https:" ? "; Secure" : "";
        return json({ ok: true, name: r.name, color: r.color }, 200, {
          "set-cookie": `vt_sid=${r.sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`,
        });
      }
      case "/ws": {
        if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return json({ error: "expected websocket" }, 426);
        const { 0: client, 1: server } = new WebSocketPair();
        server.accept();
        const sock = {
          send: (s) => server.send(s),
          close: (code, reason) => { try { server.close(code, reason); } catch {} },
        };
        const handlers = await room.connect(parseCookies(request.headers.get("cookie") || "").vt_sid, sock);
        if (handlers) {
          server.addEventListener("message", (e) => handlers.onMessage(typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data)));
          server.addEventListener("close", () => handlers.onClose());
          server.addEventListener("error", () => handlers.onClose());
        }
        return new Response(null, { status: 101, webSocket: client });
      }
    }
    return json({ error: "not found" }, 404);
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/graves") return json({ graves }, 200, { "cache-control": "public, max-age=300" });
    if (pathname.startsWith("/api/") || pathname === "/ws") {
      return env.ROOM.get(env.ROOM.idFromName("main")).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
