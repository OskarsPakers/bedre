-- Game modes + anti-cheat columns. Existing rows become classic, non-suspect.
ALTER TABLE rounds ADD COLUMN mode TEXT NOT NULL DEFAULT 'classic';
ALTER TABLE rounds ADD COLUMN day TEXT;              -- daily challenge: Riga calendar day the round is bound to
ALTER TABLE rounds ADD COLUMN seed INTEGER;          -- server-generated seed (daily: derived from the day)

ALTER TABLE scores ADD COLUMN mode TEXT NOT NULL DEFAULT 'classic';  -- classic | quick | daily | online
ALTER TABLE scores ADD COLUMN day TEXT;              -- daily: Riga day; others: NULL
ALTER TABLE scores ADD COLUMN suspect INTEGER NOT NULL DEFAULT 0;    -- 1 = failed a soft plausibility check, hidden from public boards
ALTER TABLE scores ADD COLUMN flags TEXT;            -- comma separated reason codes (no personal data)
ALTER TABLE scores ADD COLUMN trace TEXT;            -- progress trace JSON as submitted (forensics for manual clean-up)
ALTER TABLE scores ADD COLUMN round_id TEXT;
ALTER TABLE scores ADD COLUMN kills INTEGER;
ALTER TABLE scores ADD COLUMN deaths INTEGER;

CREATE INDEX idx_scores_mode_score ON scores(mode, suspect, score DESC);
CREATE INDEX idx_scores_mode_day ON scores(mode, day, suspect, score DESC);
CREATE INDEX idx_scores_mode_created ON scores(mode, suspect, created_at);
CREATE INDEX idx_rounds_ip_mode ON rounds(ip_hash, used, mode, created_at);
