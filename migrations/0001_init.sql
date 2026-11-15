CREATE TABLE rounds (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  ip_hash TEXT,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  eaten INTEGER,
  radius REAL,
  rank INTEGER,
  biggest TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_scores_score ON scores(score DESC);
CREATE INDEX idx_scores_created ON scores(created_at);
CREATE INDEX idx_rounds_created ON rounds(created_at);
CREATE INDEX idx_rounds_ip ON rounds(ip_hash, created_at);
