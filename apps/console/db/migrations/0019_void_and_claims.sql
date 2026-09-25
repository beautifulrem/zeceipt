CREATE TABLE `batch_voids` (
	`org_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`voided_at` text NOT NULL,
	PRIMARY KEY(`org_id`, `batch_id`),
	FOREIGN KEY (`org_id`,`batch_id`) REFERENCES `batches`(`org_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "batch_voids_voided_at" CHECK(typeof("batch_voids"."voided_at") = 'text' and length("batch_voids"."voided_at") = 24 and "batch_voids"."voided_at" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
);
--> statement-breakpoint
CREATE TABLE `memo_claims` (
	`org_id` text NOT NULL,
	`memo` text NOT NULL,
	`batch_id` text NOT NULL,
	PRIMARY KEY(`org_id`, `memo`),
	FOREIGN KEY (`org_id`,`batch_id`) REFERENCES `batches`(`org_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `memo_claims_batch` ON `memo_claims` (`org_id`,`batch_id`);--> statement-breakpoint
DROP INDEX `batch_items_payable_once`;--> statement-breakpoint
DROP INDEX `batch_items_memo_org`;--> statement-breakpoint
-- Custom part (slice H5c; design H5c.1). Claim every existing line's memo: 0018 guaranteed they are unique per org,
-- so this cannot conflict. Then every new line claims its memo; a second live line with the memo fails on the claim.
INSERT INTO `memo_claims` (`org_id`, `memo`, `batch_id`) SELECT `org_id`, `memo`, `batch_id` FROM `batch_items`;
--> statement-breakpoint
CREATE TRIGGER `batch_items_claim_memo` AFTER INSERT ON `batch_items`
BEGIN INSERT INTO `memo_claims` (`org_id`, `memo`, `batch_id`) VALUES (NEW.`org_id`, NEW.`memo`, NEW.`batch_id`); END;
--> statement-breakpoint
CREATE TRIGGER `memo_claims_no_update` BEFORE UPDATE ON `memo_claims`
BEGIN SELECT RAISE(ABORT, 'memo claim: fixed'); END;
--> statement-breakpoint
-- A claim is released only by its batch's void (the void's own transaction deletes them).
CREATE TRIGGER `memo_claims_release_only_voided` BEFORE DELETE ON `memo_claims`
WHEN NOT EXISTS (SELECT 1 FROM `batch_voids` v WHERE v.`org_id` = OLD.`org_id` AND v.`batch_id` = OLD.`batch_id`)
BEGIN SELECT RAISE(ABORT, 'memo claim: released only when its batch is voided'); END;
--> statement-breakpoint
-- BTCPay cancels a payout unless it is InProgress or Completed (R82): a void only while nothing may have been sent.
CREATE TRIGGER `batch_voids_only_unpaid` BEFORE INSERT ON `batch_voids`
WHEN EXISTS (SELECT 1 FROM `submissions` s WHERE s.`org_id` = NEW.`org_id` AND s.`batch_id` = NEW.`batch_id` AND s.`state` <> 'failed_retryable')
BEGIN SELECT RAISE(ABORT, 'batch is frozen: a submission may have paid'); END;
--> statement-breakpoint
CREATE TRIGGER `batch_voids_no_update` BEFORE UPDATE ON `batch_voids`
BEGIN SELECT RAISE(ABORT, 'batch is voided: final'); END;
--> statement-breakpoint
CREATE TRIGGER `batch_voids_no_delete` BEFORE DELETE ON `batch_voids`
BEGIN SELECT RAISE(ABORT, 'batch is voided: final'); END;
--> statement-breakpoint
-- A voided batch is final: no attempt, no retry, no quote, no receipt, and its record does not change.
CREATE TRIGGER `submissions_not_voided_insert` BEFORE INSERT ON `submissions`
WHEN EXISTS (SELECT 1 FROM `batch_voids` v WHERE v.`org_id` = NEW.`org_id` AND v.`batch_id` = NEW.`batch_id`)
BEGIN SELECT RAISE(ABORT, 'batch is voided: final'); END;
--> statement-breakpoint
CREATE TRIGGER `submissions_not_voided_retry` BEFORE UPDATE ON `submissions`
WHEN NEW.`state` = 'submitting' AND EXISTS (SELECT 1 FROM `batch_voids` v WHERE v.`org_id` = NEW.`org_id` AND v.`batch_id` = NEW.`batch_id`)
BEGIN SELECT RAISE(ABORT, 'batch is voided: final'); END;
--> statement-breakpoint
CREATE TRIGGER `rate_quotes_not_voided` BEFORE INSERT ON `rate_quotes`
WHEN EXISTS (SELECT 1 FROM `batch_voids` v WHERE v.`org_id` = NEW.`org_id` AND v.`batch_id` = NEW.`batch_id`)
BEGIN SELECT RAISE(ABORT, 'batch is voided: final'); END;
--> statement-breakpoint
CREATE TRIGGER `receipts_not_voided` BEFORE INSERT ON `receipts`
WHEN EXISTS (SELECT 1 FROM `batch_voids` v WHERE v.`org_id` = NEW.`org_id` AND v.`batch_id` = NEW.`batch_id`)
BEGIN SELECT RAISE(ABORT, 'batch is voided: final'); END;
--> statement-breakpoint
CREATE TRIGGER `batch_items_not_voided_insert` BEFORE INSERT ON `batch_items`
WHEN EXISTS (SELECT 1 FROM `batch_voids` v WHERE v.`org_id` = NEW.`org_id` AND v.`batch_id` = NEW.`batch_id`)
BEGIN SELECT RAISE(ABORT, 'batch is voided: final'); END;
--> statement-breakpoint
CREATE TRIGGER `batch_items_not_voided_change` BEFORE UPDATE ON `batch_items`
WHEN EXISTS (SELECT 1 FROM `batch_voids` v WHERE v.`org_id` = OLD.`org_id` AND v.`batch_id` = OLD.`batch_id`)
BEGIN SELECT RAISE(ABORT, 'batch is voided: final'); END;
--> statement-breakpoint
CREATE TRIGGER `batch_items_not_voided_delete` BEFORE DELETE ON `batch_items`
WHEN EXISTS (SELECT 1 FROM `batch_voids` v WHERE v.`org_id` = OLD.`org_id` AND v.`batch_id` = OLD.`batch_id`)
BEGIN SELECT RAISE(ABORT, 'batch is voided: final'); END;
--> statement-breakpoint
CREATE TRIGGER `batches_not_voided_change` BEFORE UPDATE ON `batches`
WHEN EXISTS (SELECT 1 FROM `batch_voids` v WHERE v.`org_id` = OLD.`org_id` AND v.`batch_id` = OLD.`id`)
BEGIN SELECT RAISE(ABORT, 'batch is voided: final'); END;
--> statement-breakpoint
CREATE TRIGGER `batches_not_voided_delete` BEFORE DELETE ON `batches`
WHEN EXISTS (SELECT 1 FROM `batch_voids` v WHERE v.`org_id` = OLD.`org_id` AND v.`batch_id` = OLD.`id`)
BEGIN SELECT RAISE(ABORT, 'batch is voided: final'); END;
