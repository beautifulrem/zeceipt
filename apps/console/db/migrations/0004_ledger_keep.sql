-- Custom migration (slice B1 review round 2): INSERT OR REPLACE on a connection with recursive triggers off
-- (SQLite's default: the sqlite3 CLI, admin tools) deletes and re-inserts a row without firing delete
-- triggers, which re-pointed a submission and moved txid index entries. A BEFORE INSERT trigger that
-- IGNOREs a row whose key already exists turns REPLACE into a no-op while keeping the store's
-- `INSERT … ON CONFLICT DO NOTHING` (createIntent) and the index upsert working: the insert of an existing
-- key is simply skipped (changes = 0). ABORT would break those paths. First record wins: a ledger row and an
-- index entry never move.
CREATE TRIGGER `submissions_keep` BEFORE INSERT ON `submissions`
WHEN EXISTS (SELECT 1 FROM `submissions` s WHERE s.`org_id` = NEW.`org_id` AND s.`nonce` = NEW.`nonce`)
BEGIN SELECT RAISE(IGNORE); END;
--> statement-breakpoint
CREATE TRIGGER `submission_txids_keep` BEFORE INSERT ON `submission_txids`
WHEN EXISTS (SELECT 1 FROM `submission_txids` t WHERE t.`org_id` = NEW.`org_id` AND t.`txid` = NEW.`txid`)
BEGIN SELECT RAISE(IGNORE); END;
