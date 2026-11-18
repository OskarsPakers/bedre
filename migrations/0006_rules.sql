-- Scoring rules version of a score (COMBOS + POWER-UPS, src/combo.js RULES_VERSION). Rows written before the combos existed keep NULL (= rules 1:
-- points were the plain swallowed value); new rows carry 2. The two are not comparable, so the boards show only the current version by default and the
-- old rows stay in the table, visible under the "Archive" toggle (GET /api/scores?archive=1). Additive and nullable: nothing is rewritten.
ALTER TABLE scores ADD COLUMN rules INTEGER;
