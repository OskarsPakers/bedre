-- Privacy-friendly analytics: aggregated daily counters only (no ids, no IPs, no cookies).
CREATE TABLE stats (
  day TEXT NOT NULL,           -- Riga calendar day
  key TEXT NOT NULL,           -- allow-listed counter name, e.g. pv, rs:classic, dev:mobile
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, key)
);
-- Short-lived rate-limit counters keyed by a salted hash of IP + UTC date (never the IP); rows expire and are purged.
CREATE TABLE rate_limits (
  k TEXT PRIMARY KEY,
  n INTEGER NOT NULL DEFAULT 0,
  exp INTEGER NOT NULL
);
CREATE INDEX idx_rate_limits_exp ON rate_limits(exp);
