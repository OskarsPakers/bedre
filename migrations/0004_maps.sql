-- Per-map leaderboards: rounds and scores remember which map (district) they were played on. Existing rows are the centre map.
ALTER TABLE rounds ADD COLUMN map TEXT NOT NULL DEFAULT 'centrs';
ALTER TABLE scores ADD COLUMN map TEXT NOT NULL DEFAULT 'centrs';

CREATE INDEX idx_scores_map_mode_score ON scores(map, mode, suspect, score DESC);
CREATE INDEX idx_scores_map_mode_day ON scores(map, mode, day, suspect, score DESC);
CREATE INDEX idx_scores_map_mode_created ON scores(map, mode, suspect, created_at);
