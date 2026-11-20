// Build static assets for Cloudflare: public/ + three.js → dist/. Run by wrangler (build.command).
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist");

fs.rmSync(DIST, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, "public"), DIST, { recursive: true });
fs.mkdirSync(path.join(DIST, "vendor"), { recursive: true });
fs.copyFileSync(path.join(ROOT, "node_modules/three/build/three.module.js"), path.join(DIST, "vendor/three.module.js"));
console.log("built dist/");
