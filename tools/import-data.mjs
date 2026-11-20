// Import grave records from the nghiatrangvinhthanh app into data/graves.json.
// Usage: node tools/import-data.mjs [path/to/cemetery-data.ts]
import fs from "node:fs";
import path from "node:path";
import { gravesToSql } from "../server/store.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const src = process.argv[2] || path.resolve(ROOT, "../nghiatrangvinhthanh/lib/cemetery-data.ts");
const text = fs.readFileSync(src, "utf8");
const start = text.indexOf("[", text.indexOf("=", text.indexOf("CEMETERY_DATA")));
const end = text.indexOf("];", start);
if (start < 0 || end < 0) throw new Error(`CEMETERY_DATA array not found in ${src}`);
const body = text.slice(start, end + 1).replace(/,\s*]$/, "]");
const graves = JSON.parse(body);

const required = ["id", "name", "hometown", "fullBirth", "fullDeath", "birthYear", "deathYear", "row", "col"];
for (const g of graves) {
  for (const k of required) if (!(k in g)) throw new Error(`grave ${g.id ?? "?"} missing ${k}`);
}
const ids = new Set(graves.map((g) => g.id));
if (ids.size !== graves.length) throw new Error("duplicate grave ids");

fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "data/graves.json"), JSON.stringify(graves, null, 1) + "\n");
// SQL for Cloudflare D1: npx wrangler d1 execute vinhthanh-3d --remote --file=data/graves.sql
fs.writeFileSync(path.join(ROOT, "data/graves.sql"), gravesToSql(graves));
console.log(`imported ${graves.length} graves from ${src} → data/graves.json, data/graves.sql`);
