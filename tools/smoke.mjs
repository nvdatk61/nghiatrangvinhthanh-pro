// Smoke test: boots the server on a spare port with a throwaway data dir and exercises HTTP + WebSocket.
// Usage: node tools/smoke.mjs [baseUrl]   (Node >= 22, uses the built-in WebSocket)
//   no baseUrl: spawns the local Node server with a throwaway data dir
//   baseUrl:    tests an already running target (e.g. `wrangler dev` at http://127.0.0.1:8787);
//               counters there may already be non-zero, so those checks compare before/after.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const EXTERNAL = process.argv[2];
const PORT = 3000 + 100 + Math.floor(Math.random() * 800);
const BASE = EXTERNAL ? EXTERNAL.replace(/\/$/, "") : `http://127.0.0.1:${PORT}`;
const tmp = EXTERNAL ? null : fs.mkdtempSync(path.join(os.tmpdir(), "vt3d-"));
if (tmp) fs.copyFileSync(path.join(ROOT, "data/graves.json"), path.join(tmp, "graves.json"));

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !extra ? "" : "  — " + extra}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let server = null;
if (!EXTERNAL) {
  server = spawn(process.execPath, [path.join(ROOT, "server/server.mjs")], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: tmp },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise((resolve, reject) => {
    server.stdout.on("data", (d) => String(d).includes("http://") && resolve());
    server.on("exit", (c) => reject(new Error(`server exited ${c}`)));
    setTimeout(() => reject(new Error("server start timeout")), 5000);
  });
}

async function session(name) {
  const r = await fetch(`${BASE}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
  return { r, cookie: (r.headers.get("set-cookie") || "").split(";")[0], body: await r.json() };
}
function client(cookie) {
  const ws = new WebSocket(BASE.replace(/^http/, "ws") + "/ws", { headers: { cookie } });
  const inbox = [];
  const waiters = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    inbox.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  };
  const wait = (pred, ms = 2000) => {
    const hit = inbox.find(pred);
    if (hit) { inbox.splice(inbox.indexOf(hit), 1); return Promise.resolve(hit); }
    return new Promise((resolve, reject) => {
      const w = { pred, resolve: (m) => { inbox.splice(inbox.indexOf(m), 1); clearTimeout(t); resolve(m); } };
      const t = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reject(new Error("timeout")); }, ms);
      waiters.push(w);
    });
  };
  const opened = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  return { ws, wait, opened, send: (m) => ws.send(JSON.stringify(m)), clear: () => inbox.splice(0) };
}

try {
  // static + api
  for (const p of ["/", "/app.js", "/style.css", "/vendor/three.module.js", "/bell.mp3"]) {
    const r = await fetch(BASE + p);
    check(`GET ${p}`, r.status === 200, String(r.status));
  }
  check("path traversal blocked", (await fetch(BASE + "/%2e%2e/package.json")).status !== 200);
  const g = await (await fetch(BASE + "/api/graves")).json();
  check("graves list", Array.isArray(g.graves) && g.graves.length > 0, String(g.graves?.length));
  const graveId = g.graves[0].id;
  check("health", (await (await fetch(BASE + "/api/health")).json()).ok === true);
  check("invalid name rejected", (await session("x")).r.status === 400);

  // two players
  const a = await session("Người Viếng A");
  const b = await session("Người Viếng B");
  check("session ok", a.r.ok && a.cookie.startsWith("vt_sid=") && b.r.ok);
  const ca = client(a.cookie), cb = client(b.cookie);
  await Promise.all([ca.opened, cb.opened]);
  const wa = await ca.wait((m) => m.t === "welcome");
  const before = (id) => wa.memorial.find((s) => s.id === id) || { active: { incense: 0, flower: 0 }, total: { incense: 0, flower: 0 } };
  const g0 = before(graveId), m0 = before("monument");
  const wb = await cb.wait((m) => m.t === "welcome");
  check("welcome has id & memorial", !!wa.id && Array.isArray(wa.memorial) && Array.isArray(wa.messages));

  ca.send({ t: "move", x: 3, z: 10, yaw: 1, moving: true });
  const seen = await cb.wait((m) => m.t === "players" && m.players.some((p) => p.id === wa.id && p.x === 3 && p.z === 10));
  check("move broadcast", !!seen);
  ca.send({ t: "move", x: 9999, z: -9999, yaw: 0 });
  const clamped = await cb.wait((m) => m.t === "players" && m.players.some((p) => p.id === wa.id && p.x === 60 && p.z === -60));
  check("move clamped to world bounds", !!clamped);

  cb.send({ t: "chat", text: "  Đời đời nhớ ơn   các liệt sĩ " });
  const chat = await ca.wait((m) => m.t === "chat");
  check("chat broadcast + trimmed", chat.message.text === "Đời đời nhớ ơn các liệt sĩ" && chat.message.playerId === wb.id);

  ca.send({ t: "offer", graveId, kind: "incense" });
  const mem = await cb.wait((m) => m.t === "memorial");
  check("offer broadcast", mem.state.id === graveId && mem.state.active.incense === g0.active.incense + 1 && mem.state.total.incense === g0.total.incense + 1 && mem.entry.name === "Người Viếng A");
  ca.send({ t: "offer", graveId, kind: "incense" });
  const cd = await ca.wait((m) => m.t === "error");
  check("offer cooldown", /chờ/.test(cd.message));
  ca.send({ t: "offer", graveId: "monument", kind: "flower" });
  check("monument offer", (await cb.wait((m) => m.t === "memorial" && m.state.id === "monument")).state.active.flower === m0.active.flower + 1);
  ca.send({ t: "offer", graveId: "nope", kind: "flower" });
  check("unknown grave rejected", !!(await ca.wait((m) => m.t === "error")));
  ca.send({ t: "offer", graveId, kind: "money" });
  check("unknown kind rejected", !!(await ca.wait((m) => m.t === "error")));

  if (tmp) {
    await sleep(1300);
    const saved = JSON.parse(fs.readFileSync(path.join(tmp, "state.json"), "utf8"));
    check("state persisted to disk", saved.memorial[graveId]?.total.incense === 1 && saved.feed.length === 2);
  }
  const api = await (await fetch(BASE + "/api/memorial")).json();
  check("memorial api", api.states.some((s) => s.id === graveId));

  // replacing a session's connection
  const ca2 = client(a.cookie);
  await ca2.opened;
  await ca2.wait((m) => m.t === "welcome");
  const closed = await new Promise((r) => { ca.ws.onclose = (e) => r(e.code); setTimeout(() => r(null), 2000); });
  check("second tab replaces first (4001)", closed === 4001, String(closed));

  cb.ws.close();
  const left = await ca2.wait((m) => m.t === "leave" && m.id === wb.id);
  check("leave broadcast", !!left);
  ca2.ws.close();
} catch (e) {
  check("unexpected error", false, e.stack);
} finally {
  server?.kill();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
