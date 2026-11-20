// Vinh Thanh martyrs' cemetery — 3D memorial client.
import * as THREE from "three";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------- layout
// Graves: rows run along x, row 3 nearest the monument. Steles face +z (south, toward the gate).
const ROW_SPACING = 3.4;
const COL_SPACING = 1.8;
const AISLE = 1.2;
const GRAVE_Z0 = 2;
const MONUMENT_Z = 15;
const URN_Z = 21.5;
const GATE_Z = 40;
const FLAG_POS = new THREE.Vector3(-9, 0, 16);
const BOUNDS = { minX: -27.4, maxX: 27.4, minZ: -32.4, maxZ: 39.6 };
const YARD = { minX: -7.4, maxX: 7.4, maxZ: 52 };
const SPAWN = { x: 0, z: 46, yaw: Math.PI };
const PLAYER_R = 0.32;

const graveX = (col) => (col - 12.5) * COL_SPACING + (col >= 13 ? AISLE : -AISLE);
const graveZ = (row) => GRAVE_Z0 - (row - 3) * ROW_SPACING;
const visitPoint = (g) => ({ x: g.x, z: g.z + 1.75, yaw: Math.PI });

// ---------------------------------------------------------------- renderer
const canvas = $("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// ---------------------------------------------------------------- textures
function canvasTexture(w, h, draw, { repeat, srgb = true } = {}) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}
function noise(ctx, w, h, base, spread, n = 9000, size = 2) {
  ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const v = (Math.random() - 0.5) * spread;
    ctx.fillStyle = `rgba(${v > 0 ? "255,255,255" : "0,0,0"},${Math.abs(v)})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, size, size);
  }
}
function starPath(ctx, cx, cy, R, r = R * 0.382) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 ? r : R;
    ctx[i ? "lineTo" : "moveTo"](cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
  }
  ctx.closePath();
}
function starShape(R, r = R * 0.382) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 ? r : R;
    const x = Math.cos(a) * rad, y = Math.sin(a) * rad;
    i ? s.lineTo(x, y) : s.moveTo(x, y);
  }
  s.closePath();
  return s;
}
function wrapText(ctx, text, maxW) {
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}
const SERIF = '"Noto Serif", "Times New Roman", serif';
const SANS = '"Be Vietnam Pro", "Noto Sans", Arial, sans-serif';

const grassTex = canvasTexture(256, 256, (c, w, h) => {
  noise(c, w, h, "#5f7d3a", 0.18, 14000, 2);
  for (let i = 0; i < 1500; i++) {
    c.strokeStyle = `rgba(${90 + Math.random() * 60},${120 + Math.random() * 60},50,0.5)`;
    const x = Math.random() * w, y = Math.random() * h;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + (Math.random() - 0.5) * 3, y - 4 - Math.random() * 4); c.stroke();
  }
}, { repeat: [60, 60] });
const paveTex = canvasTexture(256, 256, (c, w, h) => {
  noise(c, w, h, "#b9b2a3", 0.12, 8000, 2);
  c.strokeStyle = "rgba(60,55,48,0.45)"; c.lineWidth = 2;
  for (let y = 0; y <= h; y += 64) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
  for (let y = 0; y < h; y += 64) for (let x = (y / 64) % 2 ? 32 : 0; x <= w; x += 64) { c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + 64); c.stroke(); }
}, { repeat: [1, 1] });
const stoneTex = canvasTexture(128, 128, (c, w, h) => noise(c, w, h, "#d8d2c4", 0.14, 4000, 1), { repeat: [1, 1] });
const graniteTex = canvasTexture(128, 128, (c, w, h) => noise(c, w, h, "#8f8a84", 0.25, 6000, 1), { repeat: [1, 1] });
const tileTex = canvasTexture(128, 128, (c, w, h) => {
  c.fillStyle = "#7d2a1c"; c.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 16) {
    c.fillStyle = "rgba(0,0,0,0.25)"; c.fillRect(0, y + 13, w, 3);
    for (let x = (y / 16) % 2 ? 8 : 0; x < w; x += 16) { c.fillStyle = "rgba(255,200,160,0.08)"; c.fillRect(x, y, 2, 13); }
  }
}, { repeat: [3, 2] });

function skyTexture() {
  return canvasTexture(16, 512, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#5b8fc7"); g.addColorStop(0.55, "#a9c9e6"); g.addColorStop(0.75, "#f2dcb6"); g.addColorStop(1, "#e7c79c");
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  });
}
scene.background = skyTexture();
scene.fog = new THREE.Fog(0xd9d2c0, 55, 150);

// ---------------------------------------------------------------- lights
const hemi = new THREE.HemisphereLight(0xdbe8ff, 0x5c6b3a, 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe2b8, 2.4);
sun.position.set(-30, 45, 25);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 50, bottom: -50, near: 5, far: 140 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.03;
scene.add(sun);

// ---------------------------------------------------------------- materials
const M = {
  grass: new THREE.MeshLambertMaterial({ map: grassTex }),
  pave: new THREE.MeshLambertMaterial({ map: paveTex }),
  stone: new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.9 }),
  cream: new THREE.MeshStandardMaterial({ color: 0xefe3c2, roughness: 0.85 }),
  wall: new THREE.MeshStandardMaterial({ color: 0xe8d8ae, roughness: 0.9 }),
  wallCap: new THREE.MeshStandardMaterial({ color: 0x8a3a24, roughness: 0.8 }),
  granite: new THREE.MeshStandardMaterial({ map: graniteTex, roughness: 0.6 }),
  tile: new THREE.MeshStandardMaterial({ map: tileTex, roughness: 0.8 }),
  red: new THREE.MeshStandardMaterial({ color: 0xa4161a, roughness: 0.6 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xf0b93a, metalness: 0.65, roughness: 0.3, emissive: 0x3a2500 }),
  bronze: new THREE.MeshStandardMaterial({ color: 0x6b4a22, metalness: 0.7, roughness: 0.45 }),
  trunk: new THREE.MeshLambertMaterial({ color: 0x5a4030 }),
  leaf: new THREE.MeshLambertMaterial({ color: 0x2f5a2a }),
  leaf2: new THREE.MeshLambertMaterial({ color: 0x3d6e2c }),
  pole: new THREE.MeshStandardMaterial({ color: 0xcfd3d6, metalness: 0.8, roughness: 0.3 }),
  soil: new THREE.MeshLambertMaterial({ color: 0x6d6a3a }),
};

const add = (geo, mat, x, y, z, { cast = true, receive = true, parent = scene, rotY = 0 } = {}) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.y = rotY;
  m.castShadow = cast; m.receiveShadow = receive;
  parent.add(m);
  return m;
};

// ---------------------------------------------------------------- collision
const colliders = []; // AABBs {minX,maxX,minZ,maxZ}
const box = (cx, cz, w, d) => colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });

function collide(pos) {
  // region clamp: main grounds or the entrance yard in front of the gate
  if (pos.z > BOUNDS.maxZ) {
    pos.x = clamp(pos.x, YARD.minX, YARD.maxX);
    pos.z = Math.min(pos.z, YARD.maxZ);
  } else {
    pos.x = clamp(pos.x, BOUNDS.minX, BOUNDS.maxX);
    pos.z = Math.max(pos.z, BOUNDS.minZ);
  }
  for (const b of colliders) {
    const nx = clamp(pos.x, b.minX, b.maxX), nz = clamp(pos.z, b.minZ, b.maxZ);
    const dx = pos.x - nx, dz = pos.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= PLAYER_R * PLAYER_R) continue;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      pos.x = nx + (dx / d) * PLAYER_R;
      pos.z = nz + (dz / d) * PLAYER_R;
    } else {
      // centre inside the box: push out along the shallowest axis
      const pen = [pos.x - b.minX, b.maxX - pos.x, pos.z - b.minZ, b.maxZ - pos.z];
      const i = pen.indexOf(Math.min(...pen));
      if (i === 0) pos.x = b.minX - PLAYER_R; else if (i === 1) pos.x = b.maxX + PLAYER_R;
      else if (i === 2) pos.z = b.minZ - PLAYER_R; else pos.z = b.maxZ + PLAYER_R;
    }
  }
}

// ---------------------------------------------------------------- ground & paths
{
  const g = add(new THREE.PlaneGeometry(400, 400), M.grass, 0, 0, 0, { cast: false });
  g.rotation.x = -Math.PI / 2;
  const path = (x0, x1, z0, z1, y = 0.012) => {
    const w = x1 - x0, d = z1 - z0;
    const t = paveTex.clone(); t.needsUpdate = true; t.repeat.set(w / 2, d / 2);
    const m = add(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ map: t }), (x0 + x1) / 2, y, (z0 + z1) / 2, { cast: false });
    m.rotation.x = -Math.PI / 2;
  };
  path(-1.4, 1.4, -30, 56);            // main axis gate → monument → graves
  path(-11, 11, 9, 27, 0.014);          // memorial plaza
  for (let r = 3; r <= 10; r++) path(-22.6, 22.6, graveZ(r) + 1.25, graveZ(r) + 2.25, 0.013); // visitor lanes
  path(-23.4, -22.6, graveZ(10) + 1.25, graveZ(3) + 2.25, 0.013);
  path(22.6, 23.4, graveZ(10) + 1.25, graveZ(3) + 2.25, 0.013);
}

// ---------------------------------------------------------------- perimeter wall & gate
{
  const wallH = 1.3, t = 0.4;
  const wall = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const horiz = Math.abs(z1 - z0) < 1e-3;
    const w = horiz ? len : t, d = horiz ? t : len;
    add(new THREE.BoxGeometry(w, wallH, d), M.wall, cx, wallH / 2, cz);
    add(new THREE.BoxGeometry(w + 0.12, 0.12, d + 0.12), M.wallCap, cx, wallH + 0.06, cz);
    box(cx, cz, w, d);
    // little pillars every ~6m
    const n = Math.floor(len / 6);
    for (let i = 0; i <= n; i++) {
      const f = n ? i / n : 0.5;
      add(new THREE.BoxGeometry(0.6, wallH + 0.35, 0.6), M.cream, x0 + (x1 - x0) * f, (wallH + 0.35) / 2, z0 + (z1 - z0) * f);
    }
  };
  const W = 28, back = -33, front = GATE_Z;
  wall(-W, back, W, back);
  wall(-W, back, -W, front);
  wall(W, back, W, front);
  wall(-W, front, -7.5, front);
  wall(7.5, front, W, front);

  // tam quan gate: four pillars, high centre roof, lower side roofs
  const gate = new THREE.Group();
  scene.add(gate);
  const pillar = (x, h) => {
    add(new THREE.BoxGeometry(1, h, 1), M.cream, x, h / 2, GATE_Z, { parent: gate });
    add(new THREE.BoxGeometry(1.25, 0.35, 1.25), M.wallCap, x, 0.17, GATE_Z, { parent: gate });
    add(new THREE.BoxGeometry(1.2, 0.25, 1.2), M.cream, x, h + 0.12, GATE_Z, { parent: gate });
    box(x, GATE_Z, 1, 1);
  };
  pillar(-7, 4.6); pillar(7, 4.6); pillar(-2.6, 6); pillar(2.6, 6);
  const roof = (x0, x1, y, depth) => {
    const w = x1 - x0;
    add(new THREE.BoxGeometry(w + 0.6, 0.7, 1.3), M.cream, (x0 + x1) / 2, y, GATE_Z, { parent: gate });
    const shape = new THREE.Shape();
    shape.moveTo(-depth / 2 - 0.5, 0); shape.quadraticCurveTo(-depth / 4, 0.25, 0, 1.25); shape.quadraticCurveTo(depth / 4, 0.25, depth / 2 + 0.5, 0); shape.lineTo(-depth / 2 - 0.5, 0);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: w + 1.4, bevelEnabled: false });
    geo.translate(0, 0, -(w + 1.4) / 2);
    const r = add(geo, M.tile, (x0 + x1) / 2, y + 0.35, GATE_Z, { parent: gate });
    r.rotation.y = Math.PI / 2;
    // upturned eave tips
    for (const sx of [x0 - 0.7, x1 + 0.7]) for (const sz of [-1, 1]) {
      const tip = add(new THREE.ConeGeometry(0.12, 0.6, 6), M.tile, sx, y + 0.55, GATE_Z + sz * (depth / 2 + 0.45), { parent: gate });
      tip.rotation.x = sz * 0.9;
    }
  };
  roof(-2.6, 2.6, 6.45, 2.6);
  roof(-7, -2.6, 5.05, 2.2);
  roof(2.6, 7, 5.05, 2.2);
  // central star on the ridge
  const star = add(new THREE.ExtrudeGeometry(starShape(0.55), { depth: 0.12, bevelEnabled: false }), M.gold, 0, 8.25, GATE_Z - 0.06, { parent: gate });
  star.castShadow = true;
  // plaques (front & back)
  const plaqueTex = canvasTexture(1024, 160, (c, w, h) => {
    c.fillStyle = "#a4161a"; c.fillRect(0, 0, w, h);
    c.strokeStyle = "#e9b949"; c.lineWidth = 8; c.strokeRect(10, 10, w - 20, h - 20);
    c.fillStyle = "#f6d47a"; c.textAlign = "center"; c.textBaseline = "middle";
    c.font = `700 64px ${SERIF}`; c.fillText("NGHĨA TRANG LIỆT SĨ", w / 2, 62);
    c.font = `600 40px ${SERIF}`; c.fillText("XÃ VĨNH THANH", w / 2, 118);
  });
  const plaqueMat = new THREE.MeshStandardMaterial({ map: plaqueTex, roughness: 0.6 });
  for (const s of [1, -1]) {
    const p = add(new THREE.PlaneGeometry(4.6, 0.72), plaqueMat, 0, 6.45, GATE_Z + s * 0.66, { parent: gate, cast: false });
    if (s < 0) p.rotation.y = Math.PI;
  }
  // couplet boards on central pillars
  const couplet = (text) => canvasTexture(96, 512, (c, w, h) => {
    c.fillStyle = "#a4161a"; c.fillRect(0, 0, w, h);
    c.strokeStyle = "#e9b949"; c.lineWidth = 5; c.strokeRect(6, 6, w - 12, h - 12);
    c.fillStyle = "#f6d47a"; c.font = `700 38px ${SERIF}`; c.textAlign = "center"; c.textBaseline = "middle";
    const words = text.split(" ");
    words.forEach((wd, i) => c.fillText(wd, w / 2, (h / (words.length + 1)) * (i + 1)));
  });
  const leftC = new THREE.MeshStandardMaterial({ map: couplet("ĐỜI ĐỜI NHỚ ƠN") });
  const rightC = new THREE.MeshStandardMaterial({ map: couplet("CÁC ANH HÙNG LIỆT SĨ") });
  add(new THREE.PlaneGeometry(0.55, 3), leftC, -2.6, 3, GATE_Z + 0.51, { parent: gate, cast: false });
  add(new THREE.PlaneGeometry(0.55, 3), rightC, 2.6, 3, GATE_Z + 0.51, { parent: gate, cast: false });
}

// ---------------------------------------------------------------- monument (Tổ quốc ghi công)
const monument = new THREE.Group();
scene.add(monument);
{
  const z = MONUMENT_Z;
  const steps = [[9, 0.3], [7.6, 0.3], [6.2, 0.3]];
  let y = 0;
  for (const [s, h] of steps) { add(new THREE.BoxGeometry(s, h, s), M.granite, 0, y + h / 2, z, { parent: monument }); y += h; }
  box(0, z, 6.2, 6.2);
  // side wings
  for (const sx of [-1, 1]) {
    add(new THREE.BoxGeometry(1.4, 4.2, 1.1), M.cream, sx * 2.1, y + 2.1, z, { parent: monument });
    add(new THREE.BoxGeometry(1.6, 0.25, 1.3), M.cream, sx * 2.1, y + 4.3, z, { parent: monument });
  }
  // central obelisk-like stele
  add(new THREE.BoxGeometry(2.4, 0.5, 1.6), M.cream, 0, y + 0.25, z, { parent: monument });
  const steleGeo = new THREE.CylinderGeometry(0.85, 1.1, 8.2, 4, 1);
  steleGeo.rotateY(Math.PI / 4);
  steleGeo.scale(1.15, 1, 0.65);
  add(steleGeo, M.cream, 0, y + 4.6, z, { parent: monument });
  add(new THREE.BoxGeometry(1.5, 0.35, 0.95), M.cream, 0, y + 8.85, z, { parent: monument });
  const star = add(new THREE.ExtrudeGeometry(starShape(0.9), { depth: 0.2, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 1 }), M.gold, 0, y + 10, z - 0.1, { parent: monument });
  star.userData.spin = true;
  // plaque
  const tex = canvasTexture(640, 220, (c, w, h) => {
    c.fillStyle = "#9e1418"; c.fillRect(0, 0, w, h);
    c.strokeStyle = "#e9b949"; c.lineWidth = 8; c.strokeRect(12, 12, w - 24, h - 24);
    c.fillStyle = "#f6d47a"; c.textAlign = "center"; c.textBaseline = "middle";
    c.font = `700 80px ${SERIF}`; c.fillText("TỔ QUỐC", w / 2, 78);
    c.fillText("GHI CÔNG", w / 2, 160);
  });
  const plaque = add(new THREE.PlaneGeometry(1.7, 0.58), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }), 0, y + 2.3, z + 0.54, { parent: monument, cast: false });
  plaque.rotation.x = -0.027; // follow the stele's slight taper
  // altar table in front
  add(new THREE.BoxGeometry(3.2, 0.9, 1), M.granite, 0, y + 0.45, z + 2.4, { parent: monument });
  add(new THREE.BoxGeometry(3.4, 0.08, 1.15), M.granite, 0, y + 0.94, z + 2.4, { parent: monument });
}

// big bronze incense urn
const urn = new THREE.Group();
scene.add(urn);
{
  const z = URN_Z;
  add(new THREE.CylinderGeometry(1.0, 1.15, 0.5, 24), M.granite, 0, 0.25, z, { parent: urn });
  const pts = [];
  for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push(new THREE.Vector2(0.45 + Math.sin(t * Math.PI) * 0.35 + t * 0.1, t * 0.9)); }
  add(new THREE.LatheGeometry(pts, 28), M.bronze, 0, 0.5, z, { parent: urn });
  add(new THREE.TorusGeometry(0.58, 0.05, 8, 28), M.bronze, 0, 1.4, z, { parent: urn }).rotation.x = Math.PI / 2;
  for (const sx of [-1, 1]) {
    const ear = add(new THREE.TorusGeometry(0.16, 0.04, 6, 12), M.bronze, sx * 0.72, 1.25, z, { parent: urn });
    ear.rotation.y = Math.PI / 2;
  }
  add(new THREE.CircleGeometry(0.55, 24), M.soil, 0, 1.36, z, { parent: urn, cast: false }).rotation.x = -Math.PI / 2;
  box(0, z, 2.1, 2.1);
}

// flagpole + flag
let flag;
{
  add(new THREE.CylinderGeometry(0.06, 0.09, 12, 12), M.pole, FLAG_POS.x, 6, FLAG_POS.z);
  add(new THREE.SphereGeometry(0.14, 12, 8), M.gold, FLAG_POS.x, 12.05, FLAG_POS.z);
  add(new THREE.CylinderGeometry(0.7, 0.9, 0.4, 16), M.granite, FLAG_POS.x, 0.2, FLAG_POS.z);
  box(FLAG_POS.x, FLAG_POS.z, 1.6, 1.6);
  const tex = canvasTexture(300, 200, (c, w, h) => {
    c.fillStyle = "#da251d"; c.fillRect(0, 0, w, h);
    c.fillStyle = "#ffcd00"; starPath(c, w / 2, h / 2 + 4, 62); c.fill();
  });
  const geo = new THREE.PlaneGeometry(3, 2, 24, 8);
  geo.translate(1.5, 0, 0);
  flag = add(geo, new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.8 }), FLAG_POS.x + 0.08, 10.9, FLAG_POS.z, { receive: false });
  flag.userData.base = Float32Array.from(geo.attributes.position.array);
}

// trees: cypresses along the walls, round trees in the corners
{
  const cyp = new THREE.ConeGeometry(0.9, 5.5, 10);
  const round = new THREE.IcosahedronGeometry(2, 1);
  const trunkG = new THREE.CylinderGeometry(0.15, 0.22, 1.6, 8);
  const spots = [];
  for (let z = -29; z <= 36; z += 6.5) spots.push([-25.5, z, "c"], [25.5, z, "c"]);
  for (let x = -21; x <= 21; x += 7) spots.push([x, -30.5, "c"]);
  spots.push([-17, 24, "r"], [17, 24, "r"], [-17, 33, "r"], [17, 33, "r"], [-12, 36.5, "c"], [12, 36.5, "c"]);
  for (const [x, z, kind] of spots) {
    const s = 0.85 + Math.random() * 0.3;
    add(trunkG, M.trunk, x, 0.8, z).scale.setScalar(s);
    if (kind === "c") add(cyp, Math.random() > 0.5 ? M.leaf : M.leaf2, x, 1.2 + 2.75 * s, z).scale.setScalar(s);
    else add(round, M.leaf2, x, 3.2 * s, z).scale.set(s, s * 0.9, s);
    box(x, z, 0.5, 0.5);
  }
  // low hedges around the plaza
  const hedge = new THREE.BoxGeometry(1, 0.7, 1);
  for (const [x0, x1, z] of [[-11, -2, 27.2], [2, 11, 27.2]]) {
    const m = add(hedge, M.leaf2, (x0 + x1) / 2, 0.35, z);
    m.scale.set(x1 - x0, 1, 0.7);
    box((x0 + x1) / 2, z, x1 - x0, 0.7);
  }
}

// ---------------------------------------------------------------- graves
const graves = []; // {...data, x, z, stele, offer:{group, ...}}
const graveById = new Map();
const pickables = [];
const steleGeo = new THREE.BoxGeometry(0.86, 1.2, 0.14);
const tombGeo = new THREE.BoxGeometry(1.0, 0.34, 1.9);
const borderGeo = new THREE.BoxGeometry(1.24, 0.08, 2.2);
const steleBaseGeo = new THREE.BoxGeometry(1.0, 0.22, 0.32);
const smallStarGeo = new THREE.ExtrudeGeometry(starShape(0.11), { depth: 0.03, bevelEnabled: false });
const steleSideMat = new THREE.MeshStandardMaterial({ color: 0xe9e1cf, roughness: 0.7 });

function steleTexture(g) {
  return canvasTexture(256, 360, (c, w, h) => {
    const grd = c.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, "#f7f1e3"); grd.addColorStop(1, "#e6dcc6");
    c.fillStyle = grd; c.fillRect(0, 0, w, h);
    c.strokeStyle = "#b08a3c"; c.lineWidth = 4; c.strokeRect(10, 10, w - 20, h - 20);
    c.fillStyle = "#c1121f"; starPath(c, w / 2, 56, 30); c.fill();
    c.textAlign = "center"; c.textBaseline = "middle";
    c.fillStyle = "#a4161a"; c.font = `700 30px ${SERIF}`;
    const unknown = /vô danh/i.test(g.name);
    c.fillText("LIỆT SĨ", w / 2, 112);
    c.fillStyle = "#1f1a17";
    let y = 160;
    c.font = `700 ${g.name.length > 16 ? 26 : 30}px ${SERIF}`;
    for (const line of wrapText(c, unknown ? "VÔ DANH" : g.name, w - 40)) { c.fillText(line, w / 2, y); y += 34; }
    c.font = `500 19px ${SANS}`; c.fillStyle = "#3c332b";
    if (!unknown) {
      y += 6;
      c.fillText(`Quê: ${g.hometown}`, w / 2, y); y += 28;
      c.fillText(`Sinh: ${g.birthYear}`, w / 2, y); y += 28;
      c.fillText(`Hy sinh: ${g.deathYear}`, w / 2, y);
    }
    c.font = `500 15px ${SANS}`; c.fillStyle = "#7a6a55";
    c.fillText(`Hàng ${g.row} · Mộ ${g.col}`, w / 2, h - 30);
  });
}

function buildGraves(list) {
  const n = list.length;
  const tombs = new THREE.InstancedMesh(tombGeo, M.stone, n);
  const borders = new THREE.InstancedMesh(borderGeo, M.granite, n);
  const bases = new THREE.InstancedMesh(steleBaseGeo, M.granite, n);
  const stars = new THREE.InstancedMesh(smallStarGeo, M.gold, n);
  for (const im of [tombs, borders, bases, stars]) { im.castShadow = true; im.receiveShadow = true; scene.add(im); }
  const mtx = new THREE.Matrix4();
  list.forEach((d, i) => {
    const g = { ...d, x: graveX(d.col), z: graveZ(d.row) };
    graves.push(g);
    graveById.set(g.id, g);
    borders.setMatrixAt(i, mtx.makeTranslation(g.x, 0.04, g.z + 0.15));
    tombs.setMatrixAt(i, mtx.makeTranslation(g.x, 0.25, g.z + 0.25));
    bases.setMatrixAt(i, mtx.makeTranslation(g.x, 0.11, g.z - 0.85));
    stars.setMatrixAt(i, mtx.makeTranslation(g.x, 1.58, g.z - 0.86));
    const faceMat = new THREE.MeshStandardMaterial({ map: steleTexture(g), roughness: 0.6 });
    const mats = [steleSideMat, steleSideMat, steleSideMat, steleSideMat, faceMat, steleSideMat];
    const stele = add(steleGeo, mats, g.x, 0.82, g.z - 0.85);
    stele.userData.graveId = g.id;
    g.stele = stele;
    pickables.push(stele);
    // offerings holder on the tomb, in front of the stele
    g.offer = new THREE.Group();
    g.offer.position.set(g.x, 0.42, g.z - 0.35);
    scene.add(g.offer);
    box(g.x, g.z + 0.1, 1.24, 2.3);
  });
  tombs.userData.list = graves;
  pickables.push(tombs);
}

// ---------------------------------------------------------------- offerings visuals
const flameTex = canvasTexture(64, 64, (c, w, h) => {
  const g = c.createRadialGradient(w / 2, h * 0.6, 2, w / 2, h * 0.55, w / 2);
  g.addColorStop(0, "rgba(255,250,210,1)"); g.addColorStop(0.35, "rgba(255,180,60,0.9)"); g.addColorStop(1, "rgba(255,90,0,0)");
  c.fillStyle = g; c.fillRect(0, 0, w, h);
});
const smokeTex = canvasTexture(64, 64, (c, w, h) => {
  const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, "rgba(255,255,255,0.9)"); g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g; c.fillRect(0, 0, w, h);
});
const flameMat = new THREE.SpriteMaterial({ map: flameTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
const OG = {
  pot: new THREE.CylinderGeometry(0.09, 0.07, 0.12, 12),
  stick: new THREE.CylinderGeometry(0.006, 0.006, 0.34, 4),
  ember: new THREE.SphereGeometry(0.014, 6, 4),
  vase: new THREE.CylinderGeometry(0.06, 0.045, 0.2, 10),
  stem: new THREE.CylinderGeometry(0.005, 0.005, 0.22, 4),
  bloom: new THREE.IcosahedronGeometry(0.045, 0),
  candle: new THREE.CylinderGeometry(0.03, 0.03, 0.14, 10),
};
const OM = {
  pot: new THREE.MeshStandardMaterial({ color: 0x9c7a3c, metalness: 0.5, roughness: 0.4 }),
  stick: new THREE.MeshLambertMaterial({ color: 0xb5452e }),
  ember: new THREE.MeshBasicMaterial({ color: 0xff7a1a }),
  vase: new THREE.MeshStandardMaterial({ color: 0x2f5d8a, roughness: 0.3 }),
  stem: new THREE.MeshLambertMaterial({ color: 0x3f7a2a }),
  blooms: [0xf2f2f2, 0xf6c443, 0xe8505b, 0xf09ac0].map((c) => new THREE.MeshLambertMaterial({ color: c })),
  candle: new THREE.MeshStandardMaterial({ color: 0xc81d25, roughness: 0.5, emissive: 0x220000 }),
};
const flames = []; // sprites to flicker
const smokeSources = new Map(); // key -> {pos, rate}

function incenseBundle(parent, x, z, sticks, scale = 1) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.scale.setScalar(scale);
  parent.add(g);
  const pot = new THREE.Mesh(OG.pot, OM.pot); pot.position.y = 0.06; g.add(pot);
  for (let i = 0; i < sticks; i++) {
    const a = (i / sticks) * TAU, r = sticks > 1 ? 0.03 : 0;
    const s = new THREE.Mesh(OG.stick, OM.stick);
    s.position.set(Math.cos(a) * r, 0.25, Math.sin(a) * r);
    s.rotation.z = Math.cos(a) * 0.08; s.rotation.x = Math.sin(a) * 0.08;
    g.add(s);
    const e = new THREE.Mesh(OG.ember, OM.ember); e.position.set(Math.cos(a) * r * 1.6, 0.42, Math.sin(a) * r * 1.6); g.add(e);
  }
  return g;
}
function flowerVase(parent, x, z, seed) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  parent.add(g);
  const v = new THREE.Mesh(OG.vase, OM.vase); v.position.y = 0.1; g.add(v);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + seed;
    const s = new THREE.Mesh(OG.stem, OM.stem); s.position.set(Math.cos(a) * 0.02, 0.3, Math.sin(a) * 0.02); s.rotation.z = Math.cos(a) * 0.25; s.rotation.x = Math.sin(a) * 0.25; g.add(s);
    const b = new THREE.Mesh(OG.bloom, OM.blooms[(i + Math.floor(seed * 10)) % OM.blooms.length]);
    b.position.set(Math.cos(a) * 0.07, 0.42 + (i % 2) * 0.03, Math.sin(a) * 0.07); g.add(b);
  }
  return g;
}
function candle(parent, x, z, scale = 1) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.scale.setScalar(scale);
  parent.add(g);
  const c = new THREE.Mesh(OG.candle, OM.candle); c.position.y = 0.07; g.add(c);
  const f = new THREE.Sprite(flameMat); f.position.y = 0.18; f.scale.set(0.07, 0.11, 1); g.add(f);
  f.userData.base = 0.11; flames.push(f);
  return g;
}
function clearGroup(group) {
  for (const ch of [...group.children]) {
    ch.traverse((o) => { const i = flames.indexOf(o); if (i >= 0) flames.splice(i, 1); });
    group.remove(ch);
  }
}

const memorial = new Map(); // id -> {active, total}
const monumentOffer = new THREE.Group();
scene.add(monumentOffer);

function renderOfferings(id) {
  const st = memorial.get(id);
  const a = st?.active || { incense: 0, flower: 0, candle: 0 };
  if (id === "monument") {
    clearGroup(monumentOffer);
    const sticks = Math.min(a.incense, 40);
    for (let i = 0; i < sticks; i++) {
      const ang = i * 2.399, r = 0.12 + 0.35 * Math.sqrt(i / 40);
      const s = new THREE.Mesh(OG.stick, OM.stick);
      s.scale.set(2, 1.6, 2);
      s.position.set(Math.cos(ang) * r, 1.6, URN_Z + Math.sin(ang) * r);
      monumentOffer.add(s);
      const e = new THREE.Mesh(OG.ember, OM.ember); e.position.set(s.position.x, 1.88, s.position.z); monumentOffer.add(e);
    }
    if (sticks) smokeSources.set(id, { pos: new THREE.Vector3(0, 1.95, URN_Z), rate: 4 + sticks * 0.8, spread: 0.35 });
    else smokeSources.delete(id);
    const altarY = 0.9 + 0.98, altarZ = MONUMENT_Z + 2.4;
    const vases = Math.min(a.flower, 8);
    for (let i = 0; i < vases; i++) {
      const v = flowerVase(monumentOffer, -1.4 + (i / Math.max(1, 7)) * 2.8, altarZ - 0.25, i * 0.7);
      v.position.y = altarY; v.scale.setScalar(1.6);
    }
    const cs = Math.min(a.candle, 12);
    for (let i = 0; i < cs; i++) {
      const c = candle(monumentOffer, -1.45 + (i / Math.max(1, 11)) * 2.9, altarZ + 0.25, 1.5);
      c.position.y = altarY;
    }
    return;
  }
  const g = graveById.get(id);
  if (!g) return;
  clearGroup(g.offer);
  const sticks = Math.min(a.incense, 7);
  if (sticks) {
    incenseBundle(g.offer, 0, 0, Math.max(3, Math.min(7, sticks + 2)));
    smokeSources.set(id, { pos: new THREE.Vector3(g.x, 0.86, g.z - 0.35), rate: 1.5 + sticks * 0.5, spread: 0.04 });
  } else smokeSources.delete(id);
  const fl = Math.min(a.flower, 2);
  for (let i = 0; i < fl; i++) flowerVase(g.offer, i ? 0.32 : -0.32, 0.05, i + id.length);
  const cs = Math.min(a.candle, 4);
  for (let i = 0; i < cs; i++) candle(g.offer, -0.27 + i * 0.18, 0.32);
}

// smoke particles
const SMOKE_MAX = 900;
const smoke = {
  pos: new Float32Array(SMOKE_MAX * 3),
  col: new Float32Array(SMOKE_MAX * 4),
  vel: new Float32Array(SMOKE_MAX * 3),
  life: new Float32Array(SMOKE_MAX),
  next: 0,
  acc: new Map(),
};
const smokeGeo = new THREE.BufferGeometry();
smokeGeo.setAttribute("position", new THREE.BufferAttribute(smoke.pos, 3));
smokeGeo.setAttribute("color", new THREE.BufferAttribute(smoke.col, 4));
const smokePts = new THREE.Points(smokeGeo, new THREE.PointsMaterial({
  size: 0.45, map: smokeTex, transparent: true, depthWrite: false, vertexColors: true, sizeAttenuation: true,
}));
smokePts.frustumCulled = false;
scene.add(smokePts);
for (let i = 0; i < SMOKE_MAX; i++) smoke.pos[i * 3 + 1] = -100;

function updateSmoke(dt, t) {
  for (const [key, src] of smokeSources) {
    let acc = (smoke.acc.get(key) || 0) + dt * src.rate;
    while (acc >= 1) {
      acc -= 1;
      const i = smoke.next; smoke.next = (smoke.next + 1) % SMOKE_MAX;
      smoke.pos[i * 3] = src.pos.x + (Math.random() - 0.5) * src.spread;
      smoke.pos[i * 3 + 1] = src.pos.y;
      smoke.pos[i * 3 + 2] = src.pos.z + (Math.random() - 0.5) * src.spread;
      smoke.vel[i * 3] = (Math.random() - 0.5) * 0.06;
      smoke.vel[i * 3 + 1] = 0.28 + Math.random() * 0.15;
      smoke.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.06;
      smoke.life[i] = 1;
    }
    smoke.acc.set(key, acc);
  }
  for (let i = 0; i < SMOKE_MAX; i++) {
    if (smoke.life[i] <= 0) { smoke.col[i * 4 + 3] = 0; continue; }
    smoke.life[i] -= dt / 4.5;
    const l = Math.max(0, smoke.life[i]);
    smoke.pos[i * 3] += (smoke.vel[i * 3] + Math.sin(t * 0.8 + i) * 0.05) * dt;
    smoke.pos[i * 3 + 1] += smoke.vel[i * 3 + 1] * dt;
    smoke.pos[i * 3 + 2] += (smoke.vel[i * 3 + 2] + 0.04) * dt;
    smoke.col[i * 4] = smoke.col[i * 4 + 1] = smoke.col[i * 4 + 2] = 0.92;
    smoke.col[i * 4 + 3] = Math.min(1, (1 - l) * 4) * l * 0.32;
  }
  smokeGeo.attributes.position.needsUpdate = true;
  smokeGeo.attributes.color.needsUpdate = true;
}

// ---------------------------------------------------------------- avatars
const bodyGeo = new THREE.CapsuleGeometry(0.26, 0.7, 4, 12);
const headGeo = new THREE.SphereGeometry(0.19, 16, 12);
const skinMat = new THREE.MeshStandardMaterial({ color: 0xe0b48c, roughness: 0.7 });
const hairMat = new THREE.MeshStandardMaterial({ color: 0x1c1410, roughness: 0.8 });
const hairGeo = new THREE.SphereGeometry(0.2, 16, 8, 0, TAU, 0, Math.PI / 2);

function labelSprite(text, { bg = "rgba(20,15,12,0.72)", fg = "#fff3d6", font = 30, maxW = 420 } = {}) {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  ctx.font = `600 ${font}px ${SANS}`;
  const lines = wrapText(ctx, text, maxW).slice(0, 3);
  const w = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width))) + 28;
  const h = lines.length * (font + 8) + 16;
  c.width = w; c.height = h;
  ctx.font = `600 ${font}px ${SANS}`;
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.roundRect(0, 0, w, h, 14); ctx.fill();
  ctx.fillStyle = fg; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  lines.forEach((l, i) => ctx.fillText(l, w / 2, 8 + (font + 8) * i + (font + 8) / 2));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  const k = 0.0042;
  s.scale.set(w * k, h * k, 1);
  s.renderOrder = 10;
  return s;
}

function makeAvatar(p) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.75 });
  const body = new THREE.Mesh(bodyGeo, mat); body.position.y = 0.62; body.castShadow = true; g.add(body);
  const head = new THREE.Mesh(headGeo, skinMat); head.position.y = 1.42; head.castShadow = true; g.add(head);
  const hair = new THREE.Mesh(hairGeo, hairMat); hair.position.y = 1.45; g.add(hair);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.08), skinMat); nose.position.set(0, 1.41, 0.19); g.add(nose);
  const name = labelSprite(p.name, { font: 26 }); name.position.y = 1.95; g.add(name);
  g.userData = { body, head, name, bubble: null, bubbleUntil: 0, phase: Math.random() * TAU };
  scene.add(g);
  return g;
}
function setBubble(av, text) {
  if (av.userData.bubble) { av.remove(av.userData.bubble); av.userData.bubble.material.map.dispose(); }
  const b = labelSprite(text, { bg: "rgba(255,248,230,0.94)", fg: "#2a211b", font: 24, maxW: 360 });
  b.position.y = 2.35 + b.scale.y / 2;
  av.add(b);
  av.userData.bubble = b;
  av.userData.bubbleUntil = performance.now() + 7000;
}
function animateAvatar(av, moving, dt) {
  const u = av.userData;
  u.phase += dt * (moving ? 10 : 2);
  u.body.position.y = 0.62 + (moving ? Math.abs(Math.sin(u.phase)) * 0.05 : Math.sin(u.phase) * 0.008);
  u.body.rotation.z = moving ? Math.sin(u.phase) * 0.05 : 0;
  if (u.bubble && performance.now() > u.bubbleUntil) { av.remove(u.bubble); u.bubble.material.map.dispose(); u.bubble = null; }
}

// ---------------------------------------------------------------- local player & camera
const me = { id: null, name: "", color: "#c0392b", x: SPAWN.x, z: SPAWN.z, yaw: SPAWN.yaw, moving: false, avatar: null };
const cam = { yaw: SPAWN.yaw, pitch: 0.38, dist: 7, target: new THREE.Vector3() };
const keys = new Set();
const joy = { x: 0, y: 0, active: false };
let joined = false;

function teleport(x, z, yaw) {
  me.x = x; me.z = z; me.yaw = yaw; cam.yaw = yaw;
  const pos = { x, z }; collide(pos); me.x = pos.x; me.z = pos.z;
  sendMove(true);
}

function updateLocal(dt) {
  let fx = 0, fz = 0;
  const typing = document.activeElement && ["INPUT", "TEXTAREA"].includes(document.activeElement.tagName);
  if (!typing) {
    if (keys.has("KeyW") || keys.has("ArrowUp")) fz += 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) fz -= 1;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) fx -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) fx += 1;
  }
  if (joy.active) { fx += joy.x; fz += -joy.y; }
  const len = Math.hypot(fx, fz);
  me.moving = len > 0.05;
  if (me.moving) {
    fx /= Math.max(1, len); fz /= Math.max(1, len);
    const speed = (keys.has("ShiftLeft") || keys.has("ShiftRight") ? 6.5 : 3.6) * Math.min(1, len);
    // camera-relative: forward is the direction the camera looks
    const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw);
    const dx = fz * sy - fx * cy, dz = fz * cy + fx * sy;
    const n = Math.hypot(dx, dz) || 1;
    const pos = { x: me.x + (dx / n) * speed * dt, z: me.z + (dz / n) * speed * dt };
    collide(pos);
    me.x = pos.x; me.z = pos.z;
    const targetYaw = Math.atan2(dx, dz);
    let d = targetYaw - me.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    me.yaw += d * Math.min(1, dt * 12);
  }
  if (me.avatar) {
    me.avatar.position.set(me.x, 0, me.z);
    me.avatar.rotation.y = me.yaw;
    animateAvatar(me.avatar, me.moving, dt);
  }
  // camera follow
  cam.target.lerp(new THREE.Vector3(me.x, 1.45, me.z), Math.min(1, dt * 10));
  const horiz = Math.cos(cam.pitch) * cam.dist;
  camera.position.set(
    cam.target.x - Math.sin(cam.yaw) * horiz,
    cam.target.y + Math.sin(cam.pitch) * cam.dist,
    cam.target.z - Math.cos(cam.yaw) * horiz,
  );
  camera.lookAt(cam.target);
}

// pointer: drag to orbit, click to pick
let drag = null;
canvas.addEventListener("pointerdown", (e) => {
  if (!joined) return;
  canvas.focus();
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (!drag || drag.id !== e.pointerId) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  drag.x = e.clientX; drag.y = e.clientY;
  cam.yaw -= dx * 0.006;
  cam.pitch = clamp(cam.pitch + dy * 0.004, 0.05, 1.25);
});
canvas.addEventListener("pointerup", (e) => {
  if (!drag || drag.id !== e.pointerId) return;
  if (drag.moved < 6) pick(e.clientX, e.clientY);
  drag = null;
});
canvas.addEventListener("wheel", (e) => { cam.dist = clamp(cam.dist * (1 + Math.sign(e.deltaY) * 0.1), 2.2, 22); e.preventDefault(); }, { passive: false });

const raycaster = new THREE.Raycaster();
function pick(cx, cy) {
  const ndc = new THREE.Vector2((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects([...pickables, monument, urn], true);
  for (const h of hits) {
    if (h.object.userData.graveId) return openGrave(h.object.userData.graveId);
    if (h.object.isInstancedMesh && h.object.userData.list) return openGrave(h.object.userData.list[h.instanceId].id);
    let o = h.object;
    while (o) { if (o === monument || o === urn) return openGrave("monument"); o = o.parent; }
  }
}

window.addEventListener("keydown", (e) => {
  const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
  if (typing) {
    if (e.key === "Escape") document.activeElement.blur();
    return;
  }
  if (!joined) return;
  keys.add(e.code);
  if (e.code === "Enter") { e.preventDefault(); $("chat-input").focus(); }
  if (e.code === "KeyE" && nearest) openGrave(nearest.id);
  if (e.code === "Escape") { closeGrave(); $("search").hidden = true; }
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => keys.clear());

// touch joystick
if (matchMedia("(pointer: coarse)").matches) {
  const j = $("joystick"), knob = j.querySelector(".knob");
  let jid = null;
  const setKnob = (x, y) => { knob.style.transform = `translate(${x * 35}px, ${y * 35}px)`; };
  j.addEventListener("pointerdown", (e) => { jid = e.pointerId; j.setPointerCapture(jid); joy.active = true; move(e); });
  const move = (e) => {
    if (e.pointerId !== jid) return;
    const r = j.getBoundingClientRect();
    let x = (e.clientX - r.left - r.width / 2) / (r.width / 2), y = (e.clientY - r.top - r.height / 2) / (r.height / 2);
    const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    joy.x = x; joy.y = y; setKnob(x, y);
  };
  j.addEventListener("pointermove", move);
  const end = (e) => { if (e.pointerId !== jid) return; jid = null; joy.active = false; joy.x = joy.y = 0; setKnob(0, 0); };
  j.addEventListener("pointerup", end);
  j.addEventListener("pointercancel", end);
  window.__showJoystick = () => { j.hidden = false; };
}

// ---------------------------------------------------------------- nearest grave prompt
let nearest = null;
function updateNearest() {
  let best = null, bd = 2.4;
  for (const g of graves) {
    const v = visitPoint(g);
    const d = Math.hypot(me.x - v.x, me.z - v.z);
    if (d < bd) { bd = d; best = g; }
  }
  const dm = Math.hypot(me.x, me.z - (URN_Z + 2));
  if (!best && dm < 3.5) best = { id: "monument", name: "Đài Tổ quốc ghi công" };
  if (best?.id !== nearest?.id) {
    nearest = best;
    const el = $("prompt");
    if (nearest && $("grave").hidden) {
      el.innerHTML = "";
      const k = document.createElement("kbd"); k.textContent = "E";
      el.append(k, nearest.id === "monument" ? "Dâng hương tại Đài Tổ quốc ghi công" : `Viếng liệt sĩ ${nearest.name}`);
      el.hidden = false;
    } else el.hidden = true;
  }
}
$("prompt").addEventListener("click", () => nearest && openGrave(nearest.id));

// ---------------------------------------------------------------- remote players
const others = new Map(); // id -> {data, avatar, tx, tz, tyaw}
function syncPlayers(list) {
  const seen = new Set();
  for (const p of list) {
    if (p.id === me.id) continue;
    seen.add(p.id);
    let o = others.get(p.id);
    if (!o) { o = { avatar: makeAvatar(p), x: p.x, z: p.z, yaw: p.yaw }; others.set(p.id, o); }
    o.tx = p.x; o.tz = p.z; o.tyaw = p.yaw; o.moving = p.moving;
  }
  for (const [id, o] of others) if (!seen.has(id)) removeOther(id);
  $("online").textContent = `${list.length} người đang viếng`;
}
function removeOther(id) {
  const o = others.get(id);
  if (!o) return;
  scene.remove(o.avatar);
  others.delete(id);
}
function updateOthers(dt) {
  const k = Math.min(1, dt * 10);
  for (const o of others.values()) {
    o.x += (o.tx - o.x) * k; o.z += (o.tz - o.z) * k;
    let d = o.tyaw - o.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); o.yaw += d * k;
    o.avatar.position.set(o.x, 0, o.z);
    o.avatar.rotation.y = o.yaw;
    animateAvatar(o.avatar, o.moving, dt);
  }
}

// ---------------------------------------------------------------- network
let ws = null;
let lastSent = { x: 0, z: 0, yaw: 0, moving: false, at: 0 };
function sendMove(force = false) {
  if (!ws || ws.readyState !== 1) return;
  const now = performance.now();
  const changed = Math.abs(me.x - lastSent.x) > 0.01 || Math.abs(me.z - lastSent.z) > 0.01 || Math.abs(me.yaw - lastSent.yaw) > 0.02 || me.moving !== lastSent.moving;
  if (!force && (!changed || now - lastSent.at < 90)) return;
  lastSent = { x: me.x, z: me.z, yaw: me.yaw, moving: me.moving, at: now };
  ws.send(JSON.stringify({ t: "move", x: me.x, z: me.z, yaw: me.yaw, moving: me.moving }));
}
const wsSend = (msg) => ws?.readyState === 1 && ws.send(JSON.stringify(msg));

function connect() {
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  ws.onmessage = (ev) => {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    switch (msg.t) {
      case "welcome": {
        me.id = msg.id;
        const self = msg.players.find((p) => p.id === msg.id);
        if (self) { me.color = self.color; }
        if (!me.avatar) { me.avatar = makeAvatar({ name: me.name, color: me.color }); }
        if (!welcomed) { teleport(SPAWN.x, SPAWN.z, SPAWN.yaw); welcomed = true; } else sendMove(true);
        syncPlayers(msg.players);
        $("chat-log").innerHTML = "";
        for (const m of msg.messages) addChat(m);
        memorial.clear();
        for (const s of msg.memorial) memorial.set(s.id, s);
        for (const g of graves) renderOfferings(g.id);
        renderOfferings("monument");
        refreshGravePanel();
        break;
      }
      case "players": syncPlayers(msg.players); break;
      case "leave": removeOther(msg.id); break;
      case "chat": {
        addChat(msg.message);
        const av = msg.message.playerId === me.id ? me.avatar : others.get(msg.message.playerId)?.avatar;
        if (av) setBubble(av, msg.message.text);
        break;
      }
      case "memorial": {
        memorial.set(msg.state.id, msg.state);
        renderOfferings(msg.state.id);
        refreshGravePanel();
        if (msg.entry) showFeed(msg.entry);
        break;
      }
      case "error": toast(msg.message); break;
    }
  };
  ws.onclose = (ev) => {
    if (ev.code === 4001) return toast("Bạn đã mở không gian này ở tab khác.");
    if (ev.code === 4004) { joined = false; $("join").hidden = false; return; }
    if (ev.code === 4003) return toast("Không gian đang quá đông, xin thử lại sau.");
    setTimeout(connect, 2000);
  };
}
let welcomed = false;

// ---------------------------------------------------------------- UI
function addChat(m) {
  const li = document.createElement("li");
  const b = document.createElement("b"); b.style.color = m.color || "#e9b949"; b.textContent = m.name + ":";
  li.append(b, document.createTextNode(" " + m.text));
  const log = $("chat-log");
  log.append(li);
  while (log.children.length > 60) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
}
const KIND_TEXT = { incense: "thắp hương", flower: "đặt hoa", candle: "thắp nến" };
function showFeed(e) {
  const el = document.createElement("div");
  el.className = "item";
  el.textContent = `${e.name} đã ${KIND_TEXT[e.kind]} — ${e.target}`;
  $("feed").prepend(el);
  setTimeout(() => el.remove(), 6000);
  while ($("feed").children.length > 3) $("feed").lastChild.remove();
}
let toastTimer;
function toast(text) {
  const t = $("toast");
  t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

let openId = null;
function openGrave(id) {
  openId = id;
  $("search").hidden = true;
  $("grave").hidden = false;
  $("prompt").hidden = true;
  refreshGravePanel();
}
function closeGrave() { openId = null; $("grave").hidden = true; nearest = null; }
function refreshGravePanel() {
  if (!openId) return;
  const st = memorial.get(openId) || { active: { incense: 0, flower: 0, candle: 0 }, total: { incense: 0, flower: 0, candle: 0 } };
  const dl = $("grave").querySelector("dl");
  if (openId === "monument") {
    $("grave-eyebrow").textContent = "Tổ quốc ghi công";
    $("grave-name").textContent = "Đài tưởng niệm";
    dl.hidden = true;
    $("grave-go").textContent = "Đến trước đài tưởng niệm";
  } else {
    const g = graveById.get(openId);
    const unknown = /vô danh/i.test(g.name);
    $("grave-eyebrow").textContent = unknown ? "Liệt sĩ chưa xác định danh tính" : "Liệt sĩ";
    $("grave-name").textContent = unknown ? "Liệt sĩ vô danh" : g.name;
    dl.hidden = false;
    $("grave-home").textContent = g.hometown;
    $("grave-birth").textContent = g.fullBirth.replace(/^Sinh\s*/i, "");
    $("grave-death").textContent = g.fullDeath.replace(/^Mất\s*/i, "");
    $("grave-pos").textContent = `Hàng ${g.row}, mộ số ${g.col}`;
    $("grave-go").textContent = "Đến trước phần mộ";
  }
  for (const k of ["incense", "flower", "candle"]) $(`cnt-${k}`).textContent = st.active[k] ? `${st.active[k]} hôm nay` : "";
  const tot = st.total.incense + st.total.flower + st.total.candle;
  $("grave-total").textContent = tot
    ? `Tổng cộng: ${st.total.incense} nén hương · ${st.total.flower} bó hoa · ${st.total.candle} ngọn nến`
    : "Chưa có ai dâng lễ. Hãy là người đầu tiên tưởng nhớ.";
}
function goTo(id) {
  if (id === "monument") teleport(0, URN_Z + 2.2, Math.PI);
  else { const v = visitPoint(graveById.get(id)); teleport(v.x, v.z, v.yaw); }
}
$("grave-go").addEventListener("click", () => openId && goTo(openId));
for (const b of document.querySelectorAll("[data-offer]")) {
  b.addEventListener("click", () => {
    if (!openId) return;
    wsSend({ t: "offer", graveId: openId, kind: b.dataset.offer });
    const bell = $("bell"); bell.currentTime = 0; bell.play().catch(() => {});
  });
}
for (const b of document.querySelectorAll("[data-close]")) {
  b.addEventListener("click", () => (b.dataset.close === "grave" ? closeGrave() : ($(b.dataset.close).hidden = true)));
}

// search
const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
function renderSearch() {
  const q = norm($("search-input").value.trim());
  const list = graves.filter((g) => !q || norm(`${g.name} ${g.hometown}`).includes(q));
  $("search-count").textContent = `${list.length} / ${graves.length} phần mộ`;
  const ul = $("search-list");
  ul.innerHTML = "";
  for (const g of list.slice(0, 200)) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    const name = document.createElement("span"); name.textContent = /vô danh/i.test(g.name) ? "Liệt sĩ vô danh" : g.name;
    const meta = document.createElement("small"); meta.textContent = `${g.hometown} · H${g.row}-M${g.col}`;
    b.append(name, meta);
    b.addEventListener("click", () => { goTo(g.id); openGrave(g.id); });
    li.append(b); ul.append(li);
  }
}
$("search-input").addEventListener("input", renderSearch);
$("btn-search").addEventListener("click", () => {
  const s = $("search");
  s.hidden = !s.hidden;
  if (!s.hidden) { $("grave").hidden = true; openId = null; renderSearch(); $("search-input").focus(); }
});
$("btn-monument").addEventListener("click", () => goTo("monument"));
$("btn-music").addEventListener("click", () => {
  const m = $("music"), b = $("btn-music");
  if (m.paused) { m.volume = 0.35; m.play().catch(() => {}); b.setAttribute("aria-pressed", "true"); }
  else { m.pause(); b.setAttribute("aria-pressed", "false"); }
});

$("chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const i = $("chat-input");
  const text = i.value.trim();
  if (text) wsSend({ t: "chat", text });
  i.value = "";
  i.blur();
});

$("join-name").value = localStorage.getItem("vt_name") || "";
$("join-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("join-name").value.trim();
  $("join-btn").disabled = true;
  $("join-error").textContent = "";
  try {
    const r = await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Không vào được.");
    try { localStorage.setItem("vt_name", name); } catch {}
    me.name = data.name;
    me.color = data.color;
    if (me.avatar) { scene.remove(me.avatar); me.avatar = null; }
    joined = true;
    $("join").hidden = true;
    for (const id of ["hud", "chat"]) $(id).hidden = false;
    window.__showJoystick?.();
    if (ws) { ws.onclose = null; ws.close(); }
    welcomed = false;
    connect();
    canvas.focus();
  } catch (err) {
    $("join-error").textContent = err.message;
  } finally {
    $("join-btn").disabled = false;
  }
});

// ---------------------------------------------------------------- boot
const res = await fetch("/api/graves");
buildGraves((await res.json()).graves);

const clock = new THREE.Clock();
let fpsFrames = 0, fpsT = 0;
window.__stats = { fps: 0 };
function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  const t = clock.elapsedTime;
  if (joined) { updateLocal(dt); updateNearest(); sendMove(); }
  else {
    // idle flyover on the join screen
    const a = t * 0.05;
    camera.position.set(Math.sin(a) * 34, 15, 20 + Math.cos(a) * 30);
    camera.lookAt(0, 3, 4);
  }
  updateOthers(dt);
  updateSmoke(dt, t);
  for (const f of flames) { const s = f.userData.base * (0.85 + Math.random() * 0.3); f.scale.y = s; }
  // flag wave
  const pos = flag.geometry.attributes.position, base = flag.userData.base;
  for (let i = 0; i < pos.count; i++) {
    const x = base[i * 3];
    pos.setZ(i, Math.sin(x * 2.2 - t * 4) * 0.12 * (x / 3) + Math.sin(x * 4 + t * 3) * 0.03 * (x / 3));
  }
  pos.needsUpdate = true;
  flag.geometry.computeVertexNormals();
  monument.traverse((o) => { if (o.userData.spin) o.rotation.y = Math.sin(t * 0.5) * 0.25; });
  renderer.render(scene, camera);
  fpsFrames++; fpsT += dt;
  if (fpsT >= 1) { window.__stats.fps = Math.round(fpsFrames / fpsT); fpsFrames = 0; fpsT = 0; }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
canvas.tabIndex = 0;
