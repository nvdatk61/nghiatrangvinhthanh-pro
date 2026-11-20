// Browser end-to-end check via Chrome DevTools Protocol (no dependencies).
// Launches its own headless Chrome (temporary profile), joins, walks, offers, chats and takes screenshots.
// Usage: node tools/e2e.mjs [baseUrl] [outDir]
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const [BASE = "http://127.0.0.1:3100", OUT = "e2e-out"] = process.argv.slice(2);
await mkdir(OUT, { recursive: true });
const PORT = 9400 + Math.floor(Math.random() * 400);
const profile = await mkdtemp(path.join(os.tmpdir(), "vt3d-chrome-"));
const chrome = spawn("google-chrome", [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run",
  "--window-size=1440,900", "--ignore-gpu-blocklist", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let targets;
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); break; } catch { await sleep(200); }
}
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let nextId = 1;
const pending = new Map();
const problems = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") problems.push("exception: " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) problems.push(`console.${m.params.type}: ` + m.params.args.map((a) => a.value ?? a.description).join(" "));
  if (m.method === "Log.entryAdded" && m.params.entry.level === "error") problems.push("log: " + m.params.entry.text + " " + (m.params.entry.url || ""));
};
const send = (method, params = {}) => new Promise((r) => { const id = nextId++; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description);
  return r.result?.result?.value;
};
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(path.join(OUT, name), Buffer.from(r.result.data, "base64"));
  console.log("screenshot", path.join(OUT, name));
};
const key = async (code, ms) => {
  const k = code.replace(/^Key/, "").toLowerCase();
  await send("Input.dispatchKeyEvent", { type: "keyDown", code, key: k });
  await sleep(ms);
  await send("Input.dispatchKeyEvent", { type: "keyUp", code, key: k });
};
let ok = true;
const check = (name, cond, extra = "") => { if (!cond) ok = false; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + extra}`); };

try {
  for (const d of ["Runtime", "Log", "Page"]) await send(`${d}.enable`);
  await send("Page.navigate", { url: BASE + "/" });
  await sleep(4000);
  await shot("01-join.png");
  check("join screen", await evaluate(`!document.getElementById('join').hidden`));

  await evaluate(`(() => { const i = document.getElementById('join-name'); i.value = 'Khách Thử'; document.getElementById('join-form').requestSubmit(); })()`);
  await sleep(2500);
  check("joined (hud visible)", await evaluate(`!document.getElementById('hud').hidden && document.getElementById('join').hidden`));
  check("online count", /1 người/.test(await evaluate(`document.getElementById('online').textContent`)));
  await shot("02-gate.png");

  await key("KeyW", 2500);
  await sleep(300);
  await shot("03-walk.png");

  // jump to a grave via search, offer everything
  await evaluate(`document.getElementById('btn-search').click()`);
  await sleep(300);
  const n = await evaluate(`document.querySelectorAll('#search-list li').length`);
  check("search lists graves", n > 0, String(n));
  await evaluate(`(() => { const i = document.getElementById('search-input'); i.value = 'vo danh'; i.dispatchEvent(new Event('input')); })()`);
  check("diacritic-insensitive search", (await evaluate(`document.querySelectorAll('#search-list li').length`)) >= 1);
  await evaluate(`(() => { const i = document.getElementById('search-input'); i.value = ''; i.dispatchEvent(new Event('input')); document.querySelector('#search-list li button').click(); })()`);
  await sleep(600);
  check("grave panel open", await evaluate(`!document.getElementById('grave').hidden && document.getElementById('grave-name').textContent.length > 0`));
  for (const k of ["incense", "flower", "candle"]) { await evaluate(`document.querySelector('[data-offer=${k}]').click()`); await sleep(250); }
  await sleep(800);
  check("offer counters updated", /hôm nay/.test(await evaluate(`document.getElementById('cnt-incense').textContent`)));
  check("feed shows offering", (await evaluate(`document.querySelectorAll('#feed .item').length`)) > 0);
  await sleep(2500);
  await shot("04-grave.png");

  await evaluate(`(() => { const i = document.getElementById('chat-input'); i.value = 'Đời đời nhớ ơn các anh hùng liệt sĩ'; document.getElementById('chat-form').requestSubmit(); })()`);
  await sleep(600);
  check("chat shown", /nhớ ơn/.test(await evaluate(`document.getElementById('chat-log').textContent`)));

  await evaluate(`document.querySelector('[data-close=grave]').click(); document.getElementById('btn-monument').click()`);
  await sleep(400);
  await evaluate(`(() => { document.querySelector('canvas').focus(); window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' })); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' })); })()`);
  await sleep(300);
  check("E opens monument panel", /Đài tưởng niệm/.test(await evaluate(`document.getElementById('grave-name').textContent`)));
  await evaluate(`document.querySelector('[data-offer=incense]').click()`);
  await sleep(3000);
  await shot("05-monument.png");
  console.log("fps (swiftshader, headless):", await evaluate(`window.__stats.fps`));
} catch (e) {
  check("unexpected error", false, e.stack);
} finally {
  check("no console errors/exceptions", problems.length === 0, "\n  " + problems.join("\n  "));
  ws.close();
  chrome.kill();
  await sleep(300);
  await rm(profile, { recursive: true, force: true });
}
process.exit(ok ? 0 : 1);
