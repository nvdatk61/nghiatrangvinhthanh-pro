// Cloudflare Worker entry: static assets + a single Durable Object that hosts the memorial room.
// Room logic is shared with the local Node server (server/room.mjs).
import { DurableObject } from "cloudflare:workers";
import { createRoom, CAPACITY } from "../server/room.mjs";
import { loadGraves, loadMemorial, insertOffering } from "../server/store.mjs";

// D1 adapter matching store.mjs
const d1 = (DB) => ({
  all: async (sql, ...params) => (await DB.prepare(sql).bind(...params).all()).results,
  run: async (sql, ...params) => { await DB.prepare(sql).bind(...params).run(); },
});

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });

const parseCookies = (h = "") =>
  Object.fromEntries(h.split(";").map((c) => c.trim().split("=")).filter((x) => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join("="))]));

export class MemorialRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // Durable data (graves, offerings) lives in D1; this object only keeps the realtime room
    // and visitor sessions (in its own storage).
    ctx.blockConcurrencyWhile(async () => {
      const db = d1(env.DB);
      const graves = await loadGraves(db);
      this.graves = graves;
      this.room = createRoom({
        graves,
        saved: await loadMemorial(db, graves),
        onOffer: (o) => insertOffering(db, o),
        getSession: (sid) => ctx.storage.get(`s:${sid}`),
        putSession: (sid, profile) => ctx.storage.put(`s:${sid}`, profile),
      });
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const room = this.room;
    switch (url.pathname) {
      case "/api/graves":
        return json({ graves: this.graves }, 200, { "cache-control": "public, max-age=60" });
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
    if (pathname.startsWith("/api/") || pathname === "/ws") {
      return env.ROOM.get(env.ROOM.idFromName("main")).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};
