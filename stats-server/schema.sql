-- One row per copy of the program, one row per day, and a shelf for the
-- answer GitHub gave about the newest version. Nothing else is kept:
-- no addresses, no callsigns, nothing out of anybody's log.

CREATE TABLE IF NOT EXISTS installs (
  id          TEXT PRIMARY KEY,   -- the random number the program made up for itself
  first_seen  TEXT NOT NULL,      -- YYYY-MM-DD
  last_seen   TEXT NOT NULL,
  version     TEXT,
  os          TEXT,               -- mac | win | web
  os_name     TEXT,               -- "macOS 15.6", "Windows 10"
  lang        TEXT,               -- ru | en
  country     TEXT                -- two letters, from the network
);

CREATE INDEX IF NOT EXISTS installs_last_seen ON installs (last_seen);
CREATE INDEX IF NOT EXISTS installs_first_seen ON installs (first_seen);

CREATE TABLE IF NOT EXISTS days (
  day   TEXT PRIMARY KEY,         -- YYYY-MM-DD
  added INTEGER NOT NULL DEFAULT 0,   -- installs seen for the first time
  seen  INTEGER NOT NULL DEFAULT 0    -- copies that said hello that day
);

CREATE TABLE IF NOT EXISTS cache (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  ts    INTEGER NOT NULL
);
