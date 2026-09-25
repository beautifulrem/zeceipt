CREATE TABLE `approvals` (
	`org_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`seq` integer NOT NULL,
	`approver` text NOT NULL,
	`approved_at` text NOT NULL,
	`lock_seq` integer NOT NULL,
	`kid` text NOT NULL,
	`hmac` text NOT NULL,
	PRIMARY KEY(`org_id`, `batch_id`, `seq`),
	FOREIGN KEY (`org_id`,`batch_id`) REFERENCES `batches`(`org_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "approvals_seq" CHECK(typeof("approvals"."seq") = 'integer' and "approvals"."seq" >= 1),
	CONSTRAINT "approvals_lock_seq" CHECK(typeof("approvals"."lock_seq") = 'integer' and "approvals"."lock_seq" >= 1),
	CONSTRAINT "approvals_approver" CHECK(length("approvals"."approver") between 1 and 64),
	CONSTRAINT "approvals_approved_at" CHECK(typeof("approvals"."approved_at") = 'text' and length("approvals"."approved_at") = 24 and "approvals"."approved_at" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'),
	CONSTRAINT "approvals_kid" CHECK(length("approvals"."kid") between 1 and 32 and "approvals"."kid" not glob '*[^A-Za-z0-9_-]*'),
	CONSTRAINT "approvals_hmac_hex" CHECK(length("approvals"."hmac") = 64 and "approvals"."hmac" not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
-- Custom part (slice I3; design I3.2.1.2). Approvals are a record of what was approved: never changed, never removed.
CREATE TRIGGER `approvals_no_update` BEFORE UPDATE ON `approvals`
BEGIN SELECT RAISE(ABORT, 'approvals are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `approvals_no_delete` BEFORE DELETE ON `approvals`
BEGIN SELECT RAISE(ABORT, 'approvals are append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `approvals_not_voided` BEFORE INSERT ON `approvals`
WHEN EXISTS (SELECT 1 FROM `batch_voids` v WHERE v.`org_id` = NEW.`org_id` AND v.`batch_id` = NEW.`batch_id`)
BEGIN SELECT RAISE(ABORT, 'batch is voided: final'); END;
--> statement-breakpoint
-- As a lock (0014): allowed with no submission, or only a `failed_retryable` one (nothing was paid; a retry needs one).
CREATE TRIGGER `approvals_frozen` BEFORE INSERT ON `approvals`
WHEN EXISTS (SELECT 1 FROM `submissions` s WHERE s.`org_id` = NEW.`org_id` AND s.`batch_id` = NEW.`batch_id` AND s.`state` <> 'failed_retryable')
BEGIN SELECT RAISE(ABORT, 'batch is frozen: a submission may have paid'); END;
--> statement-breakpoint
CREATE TRIGGER `approvals_lock_exists` BEFORE INSERT ON `approvals`
WHEN NOT EXISTS (SELECT 1 FROM `rate_quotes` q WHERE q.`org_id` = NEW.`org_id` AND q.`batch_id` = NEW.`batch_id` AND q.`seq` = NEW.`lock_seq` AND q.`purpose` = 'lock')
BEGIN SELECT RAISE(ABORT, 'approval names no lock of this batch'); END;
