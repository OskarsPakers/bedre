-- Informational difficulty tag of a score ('easy' | 'normal' | 'hard'). NULL for rows written before the difficulty levels existed and for
-- online rows. It never splits a leaderboard: boards stay one per map x mode.
ALTER TABLE scores ADD COLUMN difficulty TEXT;
