// Persistence shared by D1 (Cloudflare) and node:sqlite (local). Runtime-agnostic.
// `db` adapter: { all(sql, ...params): Promise<object[]>, run(sql, ...params): Promise<void> }

export const ACTIVE_MS = 24 * 3600 * 1000;
export const MONUMENT_ID = "monument";
const FEED_SIZE = 100;

export async function loadGraves(db) {
  const rows = await db.all(
    "SELECT id, name, hometown, full_birth, full_death, birth_year, death_year, row, col FROM graves ORDER BY row, col",
  );
  return rows.map((r) => ({
    id: r.id, name: r.name, hometown: r.hometown, fullBirth: r.full_birth, fullDeath: r.full_death,
    birthYear: r.birth_year, deathYear: r.death_year, row: Number(r.row), col: Number(r.col),
  }));
}

/** Rebuild the in-memory memorial state ({id: {events, total}}) and recent feed from the offerings table. */
export async function loadMemorial(db, graves, now = Date.now()) {
  const memorial = {};
  const rec = (id) => (memorial[id] ||= { events: [], total: { incense: 0, flower: 0, candle: 0 } });
  for (const r of await db.all("SELECT grave_id, kind, COUNT(*) AS n FROM offerings GROUP BY grave_id, kind")) {
    rec(r.grave_id).total[r.kind] = Number(r.n);
  }
  for (const r of await db.all("SELECT grave_id, kind, at FROM offerings WHERE at > ? ORDER BY at", now - ACTIVE_MS)) {
    rec(r.grave_id).events.push({ kind: r.kind, at: Number(r.at) });
  }
  const names = new Map(graves.map((g) => [g.id, g.name]));
  const recent = await db.all("SELECT grave_id, kind, name, at FROM offerings ORDER BY id DESC LIMIT ?", FEED_SIZE);
  const feed = recent.reverse().map((r) => ({
    name: r.name, kind: r.kind, graveId: r.grave_id, at: Number(r.at), target: offeringTarget(r.grave_id, names.get(r.grave_id)),
  }));
  return { memorial, feed };
}

export const offeringTarget = (graveId, graveName) =>
  graveId === MONUMENT_ID ? "Đài Tổ quốc ghi công" : `liệt sĩ ${graveName ?? graveId}`;

export const insertOffering = (db, { graveId, kind, name, at }) =>
  db.run("INSERT INTO offerings (grave_id, kind, name, at) VALUES (?, ?, ?, ?)", graveId, kind, name, at);

/** SQL that upserts grave records (for `wrangler d1 execute --file`). */
export function gravesToSql(graves) {
  const q = (v) => (typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
  const lines = graves.map((g) =>
    `INSERT OR REPLACE INTO graves (id, name, hometown, full_birth, full_death, birth_year, death_year, row, col) VALUES (${
      [g.id, g.name, g.hometown, g.fullBirth, g.fullDeath, g.birthYear, g.deathYear, g.row, g.col].map(q).join(", ")
    });`);
  return lines.join("\n") + "\n";
}
