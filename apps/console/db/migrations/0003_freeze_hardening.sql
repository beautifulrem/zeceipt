-- Custom migration: close the freeze bypasses found in review (slice B1 round 1).
-- 1. INSERT OR REPLACE on `batches` deletes and re-inserts the row; with recursive_triggers off the delete
--    trigger does not fire, so an INSERT trigger is needed as well.
-- 2. The freeze depends on the `submissions` row, which is also the payment ledger: it may never be deleted,
--    and its identity (org, nonce, batch, digest) may never change. The compare-and-set rewrites every
--    column with the same identity values, so the update trigger compares values instead of using UPDATE OF.
-- 3. The txid index is never deleted either (a superseded txid must keep resolving).
CREATE TRIGGER `batches_frozen_insert` BEFORE INSERT ON `batches`
WHEN EXISTS (SELECT 1 FROM `submissions` s WHERE s.`org_id` = NEW.`org_id` AND s.`batch_id` = NEW.`id`)
BEGIN SELECT RAISE(ABORT, 'batch is frozen: a submission exists'); END;
--> statement-breakpoint
CREATE TRIGGER `submissions_no_delete` BEFORE DELETE ON `submissions`
BEGIN SELECT RAISE(ABORT, 'submissions are the payment ledger and are never deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `submissions_identity_fixed` BEFORE UPDATE ON `submissions`
WHEN NEW.`org_id` IS NOT OLD.`org_id` OR NEW.`nonce` IS NOT OLD.`nonce` OR NEW.`batch_id` IS NOT OLD.`batch_id` OR NEW.`batch_digest` IS NOT OLD.`batch_digest`
BEGIN SELECT RAISE(ABORT, 'a submission''s org, nonce, batch and digest never change'); END;
--> statement-breakpoint
CREATE TRIGGER `submission_txids_no_delete` BEFORE DELETE ON `submission_txids`
BEGIN SELECT RAISE(ABORT, 'the txid index is never deleted'); END;
