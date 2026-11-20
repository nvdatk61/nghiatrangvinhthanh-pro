// Room logic shared by the local Node server and the Cloudflare Durable Object.
// Runtime-agnostic: no node:* imports. Storage and sockets are injected.

export const CAPACITY = 50;
const ACTIVE_MS = 24 * 3600 * 1000; // an offering stays visible for 24h
const COOLDOWN_MS = 30 * 1000; // same session, same grave, same kind
const KINDS = ["incense", "flower", "candle"];
const KIND_LABEL = { incense: "thắp hương", flower: "đặt hoa", candle: "thắp nến" };
const NAME_RE = /^[\p{L}\p{N} ._\-]{2,24}$/u;
const COLORS = ["#c0392b", "#2e86de", "#27ae60", "#8e44ad", "#d35400", "#16a085", "#b8860b", "#5d6d7e"];
const SPAWN = { x: 0, z: 44, yaw: Math.PI };
export const MONUMENT_ID = "monument";

const num = (v, lo, hi) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);
const randomId = (bytes = 18) => {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/**
 * @param {object} opts
 * @param {Array} opts.graves
 * @param {{memorial?: object, feed?: Array}} opts.saved  previously persisted state
 * @param {(state: {memorial: object, feed: Array}) => void} opts.save  persist (may be async, fire-and-forget)
 * @param {(sid: string) => Promise<object|undefined>} opts.getSession
 * @param {(sid: string, profile: object) => Promise<void>|void} opts.putSession
 */
export function createRoom({ graves, saved = {}, save, getSession, putSession }) {
  const graveById = new Map(graves.map((g) => [g.id, g]));
  let memorial = saved.memorial || {};
  let feed = saved.feed || [];
  const players = new Map(); // id -> player
  const sockets = new Map(); // id -> {send, close}
  const messages = [];
  const cooldowns = new Map();
  let nextId = 1;
  let dirty = false;
  let ticker = null;

  // `changed` lets key-value backends write only the touched grave
  const persist = (changed) => save({ memorial, feed, changed });

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

  const publicPlayer = ({ sid, ...p }) => p;
  const send = (sock, msg) => { try { sock.send(JSON.stringify(msg)); } catch {} };
  const broadcast = (msg, except) => {
    const s = JSON.stringify(msg);
    for (const [id, sock] of sockets) if (id !== except) { try { sock.send(s); } catch {} }
  };
  function tick() {
    if (!dirty) return;
    dirty = false;
    broadcast({ t: "players", players: [...players.values()].map(publicPlayer) });
  }
  const startTicker = () => { ticker ??= setInterval(tick, 100); };
  const stopTicker = () => { if (ticker && players.size === 0) { clearInterval(ticker); ticker = null; } };

  function handle(id, sid, msg) {
    const p = players.get(id);
    const sock = sockets.get(id);
    if (!p || !sock || !msg || typeof msg !== "object") return;
    switch (msg.t) {
      case "ping":
        return send(sock, { t: "pong", at: Date.now() });
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
        const m = { id: randomId(9), playerId: id, name: p.name, color: p.color, text, at: Date.now() };
        messages.push(m);
        if (messages.length > 60) messages.shift();
        return broadcast({ t: "chat", message: m });
      }
      case "offer": {
        const graveId = String(msg.graveId || "");
        const kind = String(msg.kind || "");
        if (!KINDS.includes(kind)) return send(sock, { t: "error", message: "Lễ vật không hợp lệ." });
        if (graveId !== MONUMENT_ID && !graveById.has(graveId)) return send(sock, { t: "error", message: "Không tìm thấy phần mộ." });
        const key = `${sid}|${graveId}|${kind}`;
        const now = Date.now();
        const last = cooldowns.get(key) || 0;
        if (now - last < COOLDOWN_MS) {
          const wait = Math.ceil((COOLDOWN_MS - (now - last)) / 1000);
          return send(sock, { t: "error", message: `Bạn vừa ${KIND_LABEL[kind]} ở đây, xin chờ ${wait} giây.` });
        }
        cooldowns.set(key, now);
        if (cooldowns.size > 5000) for (const [k, t] of cooldowns) if (now - t > COOLDOWN_MS) cooldowns.delete(k);
        const m = (memorial[graveId] ||= { events: [], total: { incense: 0, flower: 0, candle: 0 } });
        m.events.push({ kind, at: now });
        m.total[kind] = (m.total[kind] || 0) + 1;
        const target = graveId === MONUMENT_ID ? "Đài Tổ quốc ghi công" : `liệt sĩ ${graveById.get(graveId).name}`;
        const entry = { name: p.name, kind, graveId, target, at: now };
        feed.push(entry);
        if (feed.length > 100) feed.shift();
        const state = graveState(graveId, now); // also prunes expired events before saving
        persist(graveId);
        broadcast({ t: "memorial", state, entry });
        return;
      }
    }
  }

  return {
    graves,
    online: () => players.size,
    memorialSnapshot: () => ({ states: allStates(), feed: feed.slice(-20) }),

    /** @returns {Promise<{ok: true, sid, name, color} | {ok: false, error}>} */
    async createSession(rawName) {
      const name = String(rawName || "").replace(/\s+/g, " ").trim();
      if (!NAME_RE.test(name)) return { ok: false, error: "Tên cần 2–24 ký tự (chữ, số, khoảng trắng)." };
      const sid = randomId();
      const color = COLORS[Math.floor(Math.random() * COLORS.length)];
      await putSession(sid, { name, color, at: Date.now() });
      return { ok: true, sid, name, color };
    },

    /**
     * Attach an open socket. `sock` needs send(string) and close(code, reason).
     * @returns {Promise<null | {onMessage(data: string): void, onClose(): void}>}
     */
    async connect(sid, sock) {
      const profile = sid && (await getSession(sid));
      if (!profile) { sock.close(4004, "NO_SESSION"); return null; }
      if (players.size >= CAPACITY) { sock.close(4003, "FULL"); return null; }
      for (const [pid, p] of players) if (p.sid === sid) sockets.get(pid)?.close(4001, "REPLACED");
      const id = `p${nextId++}`;
      players.set(id, { id, sid, name: profile.name, color: profile.color, ...SPAWN, moving: false });
      sockets.set(id, sock);
      dirty = true;
      startTicker();
      send(sock, {
        t: "welcome", id, players: [...players.values()].map(publicPlayer), messages, ...{ memorial: allStates(), feed: feed.slice(-20) },
      });
      let closed = false;
      return {
        onMessage(data) { try { handle(id, sid, JSON.parse(data)); } catch {} },
        onClose() {
          if (closed) return;
          closed = true;
          players.delete(id);
          sockets.delete(id);
          dirty = true;
          broadcast({ t: "leave", id });
          stopTicker();
        },
      };
    },
  };
}
