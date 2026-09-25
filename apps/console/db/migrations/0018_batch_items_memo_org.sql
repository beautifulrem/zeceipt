-- Review H5a round 1: one obligation must not sit in two batches, whichever way they were made. A memo is a payable
-- reference (REQ-CON-3), so it is unique across the org's batch lines, not only within one batch. Voiding a draft
-- (slice H5c) must release its memos with this index in mind.
CREATE UNIQUE INDEX `batch_items_memo_org` ON `batch_items` (`org_id`,`memo`);
--> statement-breakpoint
-- A hand-made line (no payable_ref) cannot carry a payable's id or reference: a payable is paid only through a batch
-- made from payables, where its line is tied to its facts (0017). This also covers a payable created after the line.
CREATE TRIGGER `batch_items_manual_not_payable` BEFORE INSERT ON `batch_items`
WHEN NEW.`payable_ref` IS NULL AND EXISTS (SELECT 1 FROM `payables` p WHERE p.`org_id` = NEW.`org_id` AND (p.`id` = NEW.`payable_id` OR p.`reference` = NEW.`memo`))
BEGIN SELECT RAISE(ABORT, 'batch item: a hand-made line cannot pay a payable; make a batch from payables'); END;
