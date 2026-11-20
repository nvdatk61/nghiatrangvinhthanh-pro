// Local Node server for the Vinh Thanh martyrs' cemetery 3D memorial.
// No dependencies besides node: static files, a tiny JSON API and a WebSocket room (see room.mjs).
// Production runs on Cloudflare instead (worker/worker.mjs) with the same room logic.
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createRoom, CAPACITY } from "./room.mjs";
import { loadGraves, loadMemorial, insertOffering, gravesToSql } from "./store.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const DATA = path.resolve(ROOT, process.env.DATA_DIR || "data");
const DB_FILE = path.join(DATA, "local.db");
const PORT = Number(process.env.PORT || 3100);
const HOST = process.env.HOST || "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".mp3": "audio/mpeg",
  ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};
const STATIC_ALIAS = { "/vendor/three.module.js": path.join(ROOT, "node_modules/three/build/three.module.js") };

// ---------- database (same schema as Cloudflare D1) + room ----------
fs.mkdirSync(DATA, { recursive: true });
const sqlite = new DatabaseSync(DB_FILE);
for (const f of fs.readdirSync(path.join(ROOT, "migrations")).filter((f) => f.endsWith(".sql")).sort()) {
  sqlite.exec(fs.readFileSync(path.join(ROOT, "migrations", f), "utf8"));
}
const db = {
  all: async (sql, ...params) => sqlite.prepare(sql).all(...params),
  run: async (sql, ...params) => { sqlite.prepare(sql).run(...params); },
};
// data/graves.json (from `npm run import-data`) is upserted on start so the local DB follows the source app
const gravesJson = path.join(DATA, "graves.json");
if (fs.existsSync(gravesJson)) sqlite.exec(gravesToSql(JSON.parse(fs.readFileSync(gravesJson, "utf8"))));

const graves = await loadGraves(db);
const saved = await loadMemorial(db, graves);
const sessions = new Map();
const room = createRoom({
  graves,
  saved,
  onOffer: (o) => insertOffering(db, o),
  getSession: async (sid) => sessions.get(sid),
  putSession: (sid, profile) => { sessions.set(sid, profile); },
});

// ---------- minimal WebSocket (RFC 6455, text frames only) ----------
function acceptWebSocket(req, socket, onOpen) {
  const key = req.headers["sec-websocket-key"];
  if (!key) return socket.destroy();
  const accept = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  socket.setNoDelay(true);
  const ws = {
    closed: false,
    onmessage: () => {},
    onclose: () => {},
    sendFrame(opcode, payload) {
      if (this.closed) return;
      const len = payload.length;
      const head = len < 126 ? Buffer.from([0x80 | opcode, len])
        : len < 65536 ? Buffer.from([0x80 | opcode, 126, len >> 8, len & 255])
        : (() => { const b = Buffer.alloc(10); b[0] = 0x80 | opcode; b[1] = 127; b.writeBigUInt64BE(BigInt(len), 2); return b; })();
      socket.write(Buffer.concat([head, payload]));
    },
    send(s) { this.sendFrame(0x1, Buffer.from(s)); },
    close(code = 1000, reason = "") {
      if (this.closed) return;
      const r = Buffer.from(reason);
      const b = Buffer.alloc(2 + r.length); b.writeUInt16BE(code, 0); r.copy(b, 2);
      this.sendFrame(0x8, b);
      this.closed = true;
      socket.end();
    },
  };
  let buf = Buffer.alloc(0);
  let fragments = [];
  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const fin = buf[0] & 0x80, opcode = buf[0] & 0x0f, masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (len > 1 << 16) return socket.destroy();
      const need = off + (masked ? 4 : 0) + len;
      if (buf.length < need) return;
      let payload = buf.subarray(off + (masked ? 4 : 0), need);
      if (masked) {
        const mask = buf.subarray(off, off + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      buf = buf.subarray(need);
      if (opcode === 0x8) { ws.close(); continue; }
      if (opcode === 0x9) { ws.sendFrame(0xa, payload); continue; }
      if (opcode === 0xa) continue;
      fragments.push(payload);
      if (fin) {
        const data = Buffer.concat(fragments).toString("utf8");
        fragments = [];
        ws.onmessage(data);
      }
    }
  });
  const done = () => { if (!ws.closedNotified) { ws.closedNotified = true; ws.closed = true; ws.onclose(); } };
  socket.on("close", done);
  socket.on("error", done);
  onOpen(ws);
}

const parseCookies = (h = "") =>
  Object.fromEntries(h.split(";").map((c) => c.trim().split("=")).filter((x) => x[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join("="))]));

async function onWsConnect(req, ws) {
  const handlers = await room.connect(parseCookies(req.headers.cookie).vt_sid, ws);
  if (!handlers) return;
  ws.onmessage = handlers.onMessage;
  ws.onclose = handlers.onClose;
  if (ws.closed) handlers.onClose();
}

// ---------- HTTP ----------
const json = (res, code, data, headers = {}) => {
  res.writeHead(code, { "content-type": MIME[".json"], "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(data));
};
const readBody = (req) => new Promise((resolve, reject) => {
  let s = "";
  req.on("data", (c) => { s += c; if (s.length > 4096) req.destroy(); });
  req.on("end", () => resolve(s));
  req.on("error", reject);
});

async function serveFile(res, urlPath) {
  let file = STATIC_ALIAS[urlPath];
  if (!file) {
    const rel = decodeURIComponent(urlPath === "/" ? "/index.html" : urlPath);
    file = path.join(PUBLIC, path.normalize(rel));
    if (!file.startsWith(PUBLIC + path.sep)) return json(res, 403, { error: "forbidden" });
  }
  try {
    const data = await fsp.readFile(file);
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
    res.end(data);
  } catch {
    json(res, 404, { error: "not found" });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://local");
  const p = url.pathname;
  try {
    if (p === "/api/graves" && req.method === "GET") return json(res, 200, { graves });
    if (p === "/api/health") return json(res, 200, { ok: true, online: room.online(), capacity: CAPACITY });
    if (p === "/api/memorial" && req.method === "GET") return json(res, 200, room.memorialSnapshot());
    if (p === "/api/session" && req.method === "POST") {
      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch {}
      const r = await room.createSession(body.name);
      if (!r.ok) return json(res, 400, { error: r.error });
      return json(res, 200, { ok: true, name: r.name, color: r.color }, { "set-cookie": `vt_sid=${r.sid}; Path=/; HttpOnly; SameSite=Lax` });
    }
    if (p.startsWith("/api/")) return json(res, 404, { error: "not found" });
    if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "method not allowed" });
    return serveFile(res, p);
  } catch (e) {
    console.error(e);
    json(res, 500, { error: "server error" });
  }
});

server.on("upgrade", (req, socket) => {
  if (new URL(req.url, "http://local").pathname !== "/ws") return socket.destroy();
  acceptWebSocket(req, socket, (ws) => onWsConnect(req, ws));
});

server.listen(PORT, HOST, () => {
  console.log(`Vinh Thanh 3D memorial: http://${HOST}:${PORT}  (${graves.length} graves)`);
});
