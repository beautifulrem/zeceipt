-- Custom migration (slice G1b): a recorded rate quote is evidence of what a payout was based on. It is never
-- updated or deleted, and an INSERT onto an existing seq aborts: unlike the ledger's RAISE(IGNORE), a replaced
-- quote would silently change evidence, so the attempt must fail loudly. A lock quote is refused once a
-- submission exists for the batch (the batch is frozen, as batch_items_frozen_insert in 0002); an execution
-- quote is always allowed (taken at submit, slice G2). WHEN clauses use EXISTS or comparisons of NOT NULL
-- columns only, so they can never be NULL (the 0010 convention).
CREATE TRIGGER `rate_quotes_no_update` BEFORE UPDATE ON `rate_quotes`
BEGIN SELECT RAISE(ABORT, 'rate quotes are records and never change'); END;
--> statement-breakpoint
CREATE TRIGGER `rate_quotes_no_delete` BEFORE DELETE ON `rate_quotes`
BEGIN SELECT RAISE(ABORT, 'rate quotes are records and are never deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `rate_quotes_no_replace` BEFORE INSERT ON `rate_quotes`
WHEN EXISTS (SELECT 1 FROM `rate_quotes` q WHERE q.`org_id` = NEW.`org_id` AND q.`batch_id` = NEW.`batch_id` AND q.`seq` = NEW.`seq`)
BEGIN SELECT RAISE(ABORT, 'a rate quote is never replaced'); END;
--> statement-breakpoint
CREATE TRIGGER `rate_quotes_lock_frozen` BEFORE INSERT ON `rate_quotes`
WHEN NEW.`purpose` = 'lock' AND EXISTS (SELECT 1 FROM `submissions` s WHERE s.`org_id` = NEW.`org_id` AND s.`batch_id` = NEW.`batch_id`)
BEGIN SELECT RAISE(ABORT, 'batch is frozen: a submission exists'); END;
