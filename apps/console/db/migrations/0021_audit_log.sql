CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`at` text NOT NULL,
	`action` text NOT NULL,
	`detail` text NOT NULL,
	CONSTRAINT "audit_log_action" CHECK(length("audit_log"."action") between 1 and 40),
	CONSTRAINT "audit_log_detail_json" CHECK(json_valid("audit_log"."detail") and json_type("audit_log"."detail") = 'object')
);
--> statement-breakpoint
CREATE INDEX `audit_log_batch` ON `audit_log` (`org_id`,`batch_id`,`id`);--> statement-breakpoint
-- Custom part (slice I4; design I4.2). Backfill first, one event per existing record, marked "backfilled": ordered per
-- batch by time, then by kind (created, quotes, approvals, the submission's current state, void, receipts), so the ids
-- follow the history. A submission's earlier attempts were never kept: only its current state can be backfilled.
INSERT INTO `audit_log` (`org_id`, `batch_id`, `at`, `action`, `detail`)
SELECT org_id, batch_id, at, action, detail FROM (
  SELECT b.`org_id` AS org_id, b.`id` AS batch_id, b.`created_at` AS at, 0 AS kind, 0 AS n, 'created' AS action,
    json_object('title', b.`title`, 'network', b.`network`, 'backfilled', json('true')) AS detail FROM `batches` b
  UNION ALL
  SELECT q.`org_id`, q.`batch_id`, q.`recorded_at`, 1, q.`seq`, CASE q.`purpose` WHEN 'lock' THEN 'locked' ELSE 'quoted' END,
    json_object('seq', q.`seq`, 'rate', q.`rate`, 'source', q.`source`, 'backfilled', json('true')) FROM `rate_quotes` q
  UNION ALL
  SELECT a.`org_id`, a.`batch_id`, a.`approved_at`, 2, a.`seq`, 'approved',
    json_object('seq', a.`seq`, 'lockSeq', a.`lock_seq`, 'approver', a.`approver`, 'backfilled', json('true')) FROM `approvals` a
  UNION ALL
  SELECT s.`org_id`, s.`batch_id`, s.`updated_at`, 3, 0, 'attempt_' || s.`state`,
    json_object('attempts', s.`attempts`, 'state', s.`state`, 'txid', s.`txid`, 'error', s.`error`, 'expiresBy', s.`expires_by`, 'backfilled', json('true')) FROM `submissions` s
  UNION ALL
  SELECT v.`org_id`, v.`batch_id`, v.`voided_at`, 4, 0, 'voided', json_object('backfilled', json('true')) FROM `batch_voids` v
  UNION ALL
  SELECT r.`org_id`, r.`batch_id`, r.`issued_at`, 5, r.`idx`, 'receipt_issued',
    json_object('idx', r.`idx`, 'pool', r.`pool`, 'outputIndex', r.`output_index`, 'txid', r.`txid`, 'valueZat', r.`value_zat`, 'backfilled', json('true')) FROM `receipts` r
) ORDER BY org_id, batch_id, at, kind, n;
--> statement-breakpoint
CREATE TRIGGER `audit_log_no_update` BEFORE UPDATE ON `audit_log`
BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `audit_log_no_delete` BEFORE DELETE ON `audit_log`
BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
--> statement-breakpoint
-- Each detail names chosen, non-secret columns only: never an approval's HMAC, a sealed receipt, a receipt's memo or
-- recipient, or a line's address or memo (design I4.1.3).
CREATE TRIGGER `audit_batches_insert` AFTER INSERT ON `batches`
BEGIN INSERT INTO `audit_log` (`org_id`, `batch_id`, `at`, `action`, `detail`) VALUES (NEW.`org_id`, NEW.`id`, NEW.`created_at`, 'created', json_object('title', NEW.`title`, 'network', NEW.`network`)); END;
--> statement-breakpoint
CREATE TRIGGER `audit_rate_quotes_insert` AFTER INSERT ON `rate_quotes`
BEGIN INSERT INTO `audit_log` (`org_id`, `batch_id`, `at`, `action`, `detail`) VALUES (NEW.`org_id`, NEW.`batch_id`, NEW.`recorded_at`, CASE NEW.`purpose` WHEN 'lock' THEN 'locked' ELSE 'quoted' END, json_object('seq', NEW.`seq`, 'rate', NEW.`rate`, 'source', NEW.`source`)); END;
--> statement-breakpoint
CREATE TRIGGER `audit_approvals_insert` AFTER INSERT ON `approvals`
BEGIN INSERT INTO `audit_log` (`org_id`, `batch_id`, `at`, `action`, `detail`) VALUES (NEW.`org_id`, NEW.`batch_id`, NEW.`approved_at`, 'approved', json_object('seq', NEW.`seq`, 'lockSeq', NEW.`lock_seq`, 'approver', NEW.`approver`)); END;
--> statement-breakpoint
CREATE TRIGGER `audit_submissions_insert` AFTER INSERT ON `submissions`
BEGIN INSERT INTO `audit_log` (`org_id`, `batch_id`, `at`, `action`, `detail`) VALUES (NEW.`org_id`, NEW.`batch_id`, NEW.`created_at`, 'attempt_' || NEW.`state`, json_object('attempts', NEW.`attempts`, 'state', NEW.`state`, 'txid', NEW.`txid`, 'error', NEW.`error`, 'expiresBy', NEW.`expires_by`)); END;
--> statement-breakpoint
-- Only a real change (the columns can be NULL, hence IS NOT); a new expiry bound alone is 'expiry_recorded'.
CREATE TRIGGER `audit_submissions_update` AFTER UPDATE ON `submissions`
WHEN OLD.`state` IS NOT NEW.`state` OR OLD.`attempts` IS NOT NEW.`attempts` OR OLD.`txid` IS NOT NEW.`txid` OR OLD.`expires_by` IS NOT NEW.`expires_by`
BEGIN INSERT INTO `audit_log` (`org_id`, `batch_id`, `at`, `action`, `detail`) VALUES (NEW.`org_id`, NEW.`batch_id`, NEW.`updated_at`,
  CASE WHEN OLD.`state` IS NOT NEW.`state` OR OLD.`attempts` IS NOT NEW.`attempts` OR OLD.`txid` IS NOT NEW.`txid` THEN 'attempt_' || NEW.`state` ELSE 'expiry_recorded' END,
  json_object('attempts', NEW.`attempts`, 'state', NEW.`state`, 'txid', NEW.`txid`, 'error', NEW.`error`, 'expiresBy', NEW.`expires_by`)); END;
--> statement-breakpoint
CREATE TRIGGER `audit_batch_voids_insert` AFTER INSERT ON `batch_voids`
BEGIN INSERT INTO `audit_log` (`org_id`, `batch_id`, `at`, `action`, `detail`) VALUES (NEW.`org_id`, NEW.`batch_id`, NEW.`voided_at`, 'voided', json_object()); END;
--> statement-breakpoint
CREATE TRIGGER `audit_receipts_insert` AFTER INSERT ON `receipts`
BEGIN INSERT INTO `audit_log` (`org_id`, `batch_id`, `at`, `action`, `detail`) VALUES (NEW.`org_id`, NEW.`batch_id`, NEW.`issued_at`, 'receipt_issued', json_object('idx', NEW.`idx`, 'pool', NEW.`pool`, 'outputIndex', NEW.`output_index`, 'txid', NEW.`txid`, 'valueZat', NEW.`value_zat`)); END;
