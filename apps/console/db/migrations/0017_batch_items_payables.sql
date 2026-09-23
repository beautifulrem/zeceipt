-- Custom migration (slice H5a): batch lines made from payables. `ALTER TABLE … ADD COLUMN`, not a table rebuild:
-- a rebuild would drop the freeze triggers on batch_items (0002, 0003). SQLite cannot add a composite foreign key
-- by ALTER, so the payable's existence (and the line's copy of its reference and amount) is a trigger.
ALTER TABLE `batch_items` ADD COLUMN `payable_ref` text;
--> statement-breakpoint
ALTER TABLE `batch_items` ADD COLUMN `usd_cents` integer CONSTRAINT `batch_items_usd_cents` CHECK (
  (`payable_ref` IS NULL) = (`usd_cents` IS NULL)
  AND (`usd_cents` IS NULL OR (typeof(`usd_cents`) = 'integer' AND `usd_cents` BETWEEN 1 AND 99999999))
);
--> statement-breakpoint
-- A payable is paid through at most one batch, whatever the timing (design H5a.1.3).
CREATE UNIQUE INDEX `batch_items_payable_once` ON `batch_items` (`org_id`, `payable_ref`) WHERE `payable_ref` IS NOT NULL;
--> statement-breakpoint
-- A line that names a payable carries that payable's reference as its memo and its amount in cents, and is added
-- before the batch has a lock: the batch's single lock (below) then comes after every line, as the API writes it.
CREATE TRIGGER `batch_items_payable_fact` BEFORE INSERT ON `batch_items`
WHEN NEW.`payable_ref` IS NOT NULL AND (
  NOT EXISTS (SELECT 1 FROM `payables` p WHERE p.`org_id` = NEW.`org_id` AND p.`id` = NEW.`payable_ref` AND p.`reference` = NEW.`memo` AND p.`usd_cents` = NEW.`usd_cents`)
  OR EXISTS (SELECT 1 FROM `rate_quotes` q WHERE q.`org_id` = NEW.`org_id` AND q.`batch_id` = NEW.`batch_id` AND q.`purpose` = 'lock')
)
BEGIN SELECT RAISE(ABORT, 'batch item from a payable: it must carry an existing payable''s reference and cents, before the batch is locked'); END;
--> statement-breakpoint
-- Neither the link nor the facts it carries change once written (any line that names a payable, before or after).
CREATE TRIGGER `batch_items_payable_fixed` BEFORE UPDATE OF `payable_ref`, `usd_cents`, `memo` ON `batch_items`
WHEN OLD.`payable_ref` IS NOT NULL OR NEW.`payable_ref` IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'batch item from a payable: its payable, cents and memo are fixed'); END;
--> statement-breakpoint
-- A payable in a batch keeps the reference and amount its line copied.
CREATE TRIGGER `payables_batched_keep` BEFORE UPDATE ON `payables`
WHEN EXISTS (SELECT 1 FROM `batch_items` b WHERE b.`org_id` = OLD.`org_id` AND b.`payable_ref` = OLD.`id`)
BEGIN SELECT RAISE(ABORT, 'payable is in a batch: it cannot change'); END;
--> statement-breakpoint
CREATE TRIGGER `payables_batched_no_delete` BEFORE DELETE ON `payables`
WHEN EXISTS (SELECT 1 FROM `batch_items` b WHERE b.`org_id` = OLD.`org_id` AND b.`payable_ref` = OLD.`id`)
BEGIN SELECT RAISE(ABORT, 'payable is in a batch: it cannot be deleted'); END;
--> statement-breakpoint
-- The rate of a batch made from payables is fixed (BTCPay's approved payout; design H5a.1.5): its amounts were
-- converted at its first lock, so no second lock may be recorded. Execution quotes (the guard's) are unaffected.
CREATE TRIGGER `rate_quotes_fixed_for_payables` BEFORE INSERT ON `rate_quotes`
WHEN NEW.`purpose` = 'lock'
  AND EXISTS (SELECT 1 FROM `batch_items` b WHERE b.`org_id` = NEW.`org_id` AND b.`batch_id` = NEW.`batch_id` AND b.`payable_ref` IS NOT NULL)
  AND EXISTS (SELECT 1 FROM `rate_quotes` q WHERE q.`org_id` = NEW.`org_id` AND q.`batch_id` = NEW.`batch_id` AND q.`purpose` = 'lock')
BEGIN SELECT RAISE(ABORT, 'rate is fixed: the batch was made from payables'); END;
