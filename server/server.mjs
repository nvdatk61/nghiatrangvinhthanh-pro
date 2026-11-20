// Local multiplayer server for the Vinh Thanh martyrs' cemetery 3D memorial.
// No dependencies besides node: static files, a tiny JSON API and a WebSocket room.
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.resolve(import.meta.dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const DATA = path.resolve(ROOT, process.env.DATA_DIR || "data");
const STATE_FILE = path.join(DATA, "state.json");
const PORT = Number(process.env.PORT || 3100);
const HOST = process.env.HOST || "127.0.0.1";
const CAPACITY = 50;
const ACTIVE_MS = 24 * 3600 * 1000; // an offering stays visible for 24h
const COOLDOWN_MS = 30 * 1000; // same player, same grave, same kind
const KINDS = ["incense", "flower", "candle"];
const KIND_LABEL = { incense: "thắp hương", flower: "đặt hoa", candle: "thắp nến" };
const NAME_RE = /^[\p{L}\p{N} ._\-]{2,24}$/u;
const COLORS = ["#c0392b", "#2e86de", "#27ae60", "#8e44ad", "#d35400", "#16a085", "#b8860b", "#5d6d7e"];

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".mp3": "audio/mpeg",
  ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};
const STATIC_ALIAS = { "/vendor/three.module.js": path.join(ROOT, "node_modules/three/build/three.module.js") };

// ---------- data ----------
const graves = JSON.parse(fs.readFileSync(path.join(DATA, "graves.json"), "utf8"));
const graveById = new Map(graves.map((g) => [g.id, g]));
const MONUMENT_ID = "monument";

/** memorial[id] = { events: [{kind, at}], total: {incense, flower, candle} } */
let memorial = {};
let feed = []; // recent offerings, newest last
try {
  const saved = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  memorial = saved.memorial || {};
  feed = saved.feed || [];
} catch {}

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    const tmp = STATE_FILE + ".tmp";
    await fsp.writeFile(tmp, JSON.stringify({ memorial, feed }));
    await fsp.rename(tmp, STATE_FILE);
  }, 1000);
}

function graveState(id, now = Date.now()) {
  const m = memorial[id];
  const active = { incense: 0, flower: 0, candle: 0 };
  if (!m) return { id, active, total: { ...active } };
  m.events = m.events.filter((e) => now - e.at < ACTIVE_MS);
  for (const e of m.events) active[e.kind]++;
  return { id, active, total: { ...m.total } };
}
const allStates = () => {
  const now = Date.now();
  return Object.keys(memorial).map((id) => graveState(id, now));
};

// ---------- room ----------
const sessions = new Map(); // sid -> {name, color}
const players = new Map(); // id -> {id, name, color, x, z, yaw, moving}
const sockets = new Map(); // id -> ws
const messages = [];
const cooldowns = new Map(); // `${sid}|${grave}|${kind}` -> ts
let nextId = 1;
let dirty = false;

const SPAWN = { x: 0, z: 44, yaw: Math.PI };
const send = (ws, msg) => ws.sendText(JSON.stringify(msg));
const broadcast = (msg, except) => {
  const s = JSON.stringify(msg);
  for (const [id, ws] of sockets) if (id !== except) ws.sendText(s);
};
setInterval(() => {
  if (!dirty) return;
  dirty = false;
  broadcast({ t: "players", players: [...players.values()] });
}, 100);

const num = (v, lo, hi) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);

function handle(id, sid, msg) {
  const p = players.get(id);
  const ws = sockets.get(id);
  if (!p || !ws || !msg || typeof msg !== "object") return;
  switch (msg.t) {
    case "ping":
      return send(ws, { t: "pong", at: Date.now() });
    case "move": {
      const x = num(msg.x, -60, 60), z = num(msg.z, -60, 60), yaw = num(msg.yaw, -100, 100);
      if (x === null || z === null || yaw === null) return;
      Object.assign(p, { x, z, yaw, moving: !!msg.moving });
      dirty = true;
      return;
    }
    case "chat": {
      const text = String(msg.text || "").replace(/\s+/g, " ").trim().slice(0, 200);
      if (!text) return;
      const m = { id: crypto.randomUUID(), playerId: id, name: p.name, color: p.color, text, at: Date.now() };
      messages.push(m);
      if (messages.length > 60) messages.shift();
      return broadcast({ t: "chat", message: m });
    }
    case "offer": {
      const graveId = String(msg.graveId || "");
      const kind = String(msg.kind || "");
      if (!KINDS.includes(kind)) return send(ws, { t: "error", message: "Lễ vật không hợp lệ." });
      if (graveId !== MONUMENT_ID && !graveById.has(graveId)) return send(ws, { t: "error", message: "Không tìm thấy phần mộ." });
      const key = `${sid}|${graveId}|${kind}`;
      const now = Date.now();
      const last = cooldowns.get(key) || 0;
      if (now - last < COOLDOWN_MS) {
        const wait = Math.ceil((COOLDOWN_MS - (now - last)) / 1000);
        return send(ws, { t: "error", message: `Bạn vừa ${KIND_LABEL[kind]} ở đây, xin chờ ${wait} giây.` });
      }
      cooldowns.set(key, now);
      const m = (memorial[graveId] ||= { events: [], total: { incense: 0, flower: 0, candle: 0 } });
      m.events.push({ kind, at: now });
      m.total[kind] = (m.total[kind] || 0) + 1;
      const target = graveId === MONUMENT_ID ? "Đài Tổ quốc ghi công" : `liệt sĩ ${graveById.get(graveId).name}`;
      const entry = { name: p.name, kind, graveId, target, at: now };
      feed.push(entry);
      if (feed.length > 100) feed.shift();
      scheduleSave();
      broadcast({ t: "memorial", state: graveState(graveId, now), entry });
      return;
    }
  }
}

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
    sendText(s) { this.sendFrame(0x1, Buffer.from(s)); },
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

function onWsConnect(req, ws) {
  const sid = parseCookies(req.headers.cookie).vt_sid;
  const profile = sid && sessions.get(sid);
  if (!profile) return ws.close(4004, "NO_SESSION");
  if (players.size >= CAPACITY) return ws.close(4003, "FULL");
  // one connection per session: replace the old one
  for (const [pid, p] of players) {
    if (p.sid === sid) { sockets.get(pid)?.close(4001, "REPLACED"); }
  }
  const id = `p${nextId++}`;
  const player = { id, sid, name: profile.name, color: profile.color, ...SPAWN, moving: false };
  players.set(id, player);
  sockets.set(id, ws);
  dirty = true;
  send(ws, { t: "welcome", id, players: [...players.values()], messages, memorial: allStates(), feed: feed.slice(-20) });
  ws.onmessage = (data) => { try { handle(id, sid, JSON.parse(data)); } catch {} };
  ws.onclose = () => {
    players.delete(id);
    sockets.delete(id);
    dirty = true;
    broadcast({ t: "leave", id });
  };
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
    if (p === "/api/health") return json(res, 200, { ok: true, online: players.size, capacity: CAPACITY });
    if (p === "/api/memorial" && req.method === "GET") return json(res, 200, { states: allStates(), feed: feed.slice(-20) });
    if (p === "/api/session" && req.method === "POST") {
      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch {}
      const name = String(body.name || "").replace(/\s+/g, " ").trim();
      if (!NAME_RE.test(name)) return json(res, 400, { error: "Tên cần 2–24 ký tự (chữ, số, khoảng trắng)." });
      const sid = crypto.randomBytes(18).toString("base64url");
      const color = COLORS[crypto.randomInt(COLORS.length)];
      sessions.set(sid, { name, color });
      return json(res, 200, { ok: true, name, color }, { "set-cookie": `vt_sid=${sid}; Path=/; HttpOnly; SameSite=Lax` });
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
