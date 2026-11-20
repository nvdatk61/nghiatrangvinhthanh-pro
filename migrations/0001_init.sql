-- Schema shared by Cloudflare D1 (production) and node:sqlite (local dev).
-- Idempotent so the local server can re-apply it on every start.

CREATE TABLE IF NOT EXISTS graves (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  hometown    TEXT NOT NULL DEFAULT '',
  full_birth  TEXT NOT NULL DEFAULT '',
  full_death  TEXT NOT NULL DEFAULT '',
  birth_year  TEXT NOT NULL DEFAULT '',
  death_year  TEXT NOT NULL DEFAULT '',
  row         INTEGER NOT NULL,
  col         INTEGER NOT NULL
);

-- One row per offering. "monument" is used as grave_id for the central memorial.
CREATE TABLE IF NOT EXISTS offerings (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  grave_id  TEXT NOT NULL,
  kind      TEXT NOT NULL CHECK (kind IN ('incense', 'flower', 'candle')),
  name      TEXT NOT NULL,
  at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS offerings_at ON offerings (at);
CREATE INDEX IF NOT EXISTS offerings_grave_kind ON offerings (grave_id, kind);
