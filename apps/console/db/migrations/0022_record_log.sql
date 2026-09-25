CREATE TABLE `record_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` text NOT NULL,
	`kind` text NOT NULL,
	`record_id` text NOT NULL,
	`at` text NOT NULL,
	`action` text NOT NULL,
	`detail` text NOT NULL,
	CONSTRAINT "record_log_kind" CHECK("record_log"."kind" in ('recipient', 'payable')),
	CONSTRAINT "record_log_action" CHECK("record_log"."action" in ('created', 'changed', 'deleted')),
	CONSTRAINT "record_log_detail_json" CHECK(json_valid("record_log"."detail") and json_type("record_log"."detail") = 'object')
);
--> statement-breakpoint
CREATE INDEX `record_log_record` ON `record_log` (`org_id`,`kind`,`record_id`,`id`);--> statement-breakpoint
-- Custom part (slice I4b; design I4b.2). Backfill first: one `created` per existing record, marked "backfilled", in
-- creation order. The address is abridged as `shortAddress` does it (design I4b.1.3): the UA prefixes contain no "1",
-- so the first "1" is the separator; keep it and 25 data characters.
INSERT INTO `record_log` (`org_id`, `kind`, `record_id`, `at`, `action`, `detail`)
SELECT org_id, kind, record_id, at, 'created', detail FROM (
  SELECT r.`org_id` AS org_id, 'recipient' AS kind, r.`id` AS record_id, r.`created_at` AS at,
    json_object('displayName', r.`display_name`, 'network', r.`network`, 'address', CASE WHEN length(r.`address`) <= instr(r.`address`, '1') + 26 THEN r.`address` ELSE substr(r.`address`, 1, instr(r.`address`, '1') + 25) || '…' END, 'backfilled', json('true')) AS detail FROM `recipients` r
  UNION ALL
  SELECT p.`org_id`, 'payable', p.`id`, p.`created_at`,
    json_object('recipientId', p.`recipient_id`, 'kind', p.`kind`, 'usdCents', p.`usd_cents`, 'reference', p.`reference`, 'backfilled', json('true')) FROM `payables` p
) ORDER BY at, kind, record_id;
--> statement-breakpoint
CREATE TRIGGER `record_log_no_update` BEFORE UPDATE ON `record_log`
BEGIN SELECT RAISE(ABORT, 'record log is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `record_log_no_delete` BEFORE DELETE ON `record_log`
BEGIN SELECT RAISE(ABORT, 'record log is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER `record_recipients_insert` AFTER INSERT ON `recipients`
BEGIN INSERT INTO `record_log` (`org_id`, `kind`, `record_id`, `at`, `action`, `detail`) VALUES (NEW.`org_id`, 'recipient', NEW.`id`, NEW.`created_at`, 'created', json_object('displayName', NEW.`display_name`, 'network', NEW.`network`, 'address', CASE WHEN length(NEW.`address`) <= instr(NEW.`address`, '1') + 26 THEN NEW.`address` ELSE substr(NEW.`address`, 1, instr(NEW.`address`, '1') + 25) || '…' END)); END;
--> statement-breakpoint
-- Only a change of a tracked field (IS NOT: nullable columns); `updated_at` alone is not an event. Each tracked field is
-- {previous, current} when it changed and null when it did not (the reader drops the nulls).
CREATE TRIGGER `record_recipients_update` AFTER UPDATE ON `recipients`
WHEN OLD.`display_name` IS NOT NEW.`display_name` OR OLD.`address` IS NOT NEW.`address` OR OLD.`network` IS NOT NEW.`network` OR OLD.`kyc_status` IS NOT NEW.`kyc_status` OR OLD.`tax_flag` IS NOT NEW.`tax_flag` OR OLD.`settlement_pref` IS NOT NEW.`settlement_pref` OR OLD.`notes` IS NOT NEW.`notes`
BEGIN INSERT INTO `record_log` (`org_id`, `kind`, `record_id`, `at`, `action`, `detail`) VALUES (NEW.`org_id`, 'recipient', NEW.`id`, NEW.`updated_at`, 'changed', json_object('fields', json_object('displayName', CASE WHEN OLD.`display_name` IS NOT NEW.`display_name` THEN json_object('previous', OLD.`display_name`, 'current', NEW.`display_name`) END, 'address', CASE WHEN CASE WHEN length(OLD.`address`) <= instr(OLD.`address`, '1') + 26 THEN OLD.`address` ELSE substr(OLD.`address`, 1, instr(OLD.`address`, '1') + 25) || '…' END IS NOT CASE WHEN length(NEW.`address`) <= instr(NEW.`address`, '1') + 26 THEN NEW.`address` ELSE substr(NEW.`address`, 1, instr(NEW.`address`, '1') + 25) || '…' END THEN json_object('previous', CASE WHEN length(OLD.`address`) <= instr(OLD.`address`, '1') + 26 THEN OLD.`address` ELSE substr(OLD.`address`, 1, instr(OLD.`address`, '1') + 25) || '…' END, 'current', CASE WHEN length(NEW.`address`) <= instr(NEW.`address`, '1') + 26 THEN NEW.`address` ELSE substr(NEW.`address`, 1, instr(NEW.`address`, '1') + 25) || '…' END) END, 'network', CASE WHEN OLD.`network` IS NOT NEW.`network` THEN json_object('previous', OLD.`network`, 'current', NEW.`network`) END, 'kycStatus', CASE WHEN OLD.`kyc_status` IS NOT NEW.`kyc_status` THEN json_object('previous', OLD.`kyc_status`, 'current', NEW.`kyc_status`) END, 'taxFlag', CASE WHEN OLD.`tax_flag` IS NOT NEW.`tax_flag` THEN json_object('previous', OLD.`tax_flag`, 'current', NEW.`tax_flag`) END, 'settlementPref', CASE WHEN OLD.`settlement_pref` IS NOT NEW.`settlement_pref` THEN json_object('previous', OLD.`settlement_pref`, 'current', NEW.`settlement_pref`) END, 'notes', CASE WHEN OLD.`notes` IS NOT NEW.`notes` THEN json_object('previous', OLD.`notes`, 'current', NEW.`notes`) END))); END;
--> statement-breakpoint
CREATE TRIGGER `record_recipients_delete` AFTER DELETE ON `recipients`
BEGIN INSERT INTO `record_log` (`org_id`, `kind`, `record_id`, `at`, `action`, `detail`) VALUES (OLD.`org_id`, 'recipient', OLD.`id`, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'deleted', json_object('displayName', OLD.`display_name`)); END;
--> statement-breakpoint
CREATE TRIGGER `record_payables_insert` AFTER INSERT ON `payables`
BEGIN INSERT INTO `record_log` (`org_id`, `kind`, `record_id`, `at`, `action`, `detail`) VALUES (NEW.`org_id`, 'payable', NEW.`id`, NEW.`created_at`, 'created', json_object('recipientId', NEW.`recipient_id`, 'kind', NEW.`kind`, 'usdCents', NEW.`usd_cents`, 'reference', NEW.`reference`)); END;
--> statement-breakpoint
-- Payables have no updated_at: a change or delete is stamped with the database clock at the change.
CREATE TRIGGER `record_payables_update` AFTER UPDATE ON `payables`
WHEN OLD.`recipient_id` IS NOT NEW.`recipient_id` OR OLD.`kind` IS NOT NEW.`kind` OR OLD.`usd_cents` IS NOT NEW.`usd_cents` OR OLD.`reference` IS NOT NEW.`reference` OR OLD.`source_url` IS NOT NEW.`source_url`
BEGIN INSERT INTO `record_log` (`org_id`, `kind`, `record_id`, `at`, `action`, `detail`) VALUES (NEW.`org_id`, 'payable', NEW.`id`, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'changed', json_object('fields', json_object('recipientId', CASE WHEN OLD.`recipient_id` IS NOT NEW.`recipient_id` THEN json_object('previous', OLD.`recipient_id`, 'current', NEW.`recipient_id`) END, 'kind', CASE WHEN OLD.`kind` IS NOT NEW.`kind` THEN json_object('previous', OLD.`kind`, 'current', NEW.`kind`) END, 'usdCents', CASE WHEN OLD.`usd_cents` IS NOT NEW.`usd_cents` THEN json_object('previous', OLD.`usd_cents`, 'current', NEW.`usd_cents`) END, 'reference', CASE WHEN OLD.`reference` IS NOT NEW.`reference` THEN json_object('previous', OLD.`reference`, 'current', NEW.`reference`) END, 'sourceUrl', CASE WHEN OLD.`source_url` IS NOT NEW.`source_url` THEN json_object('previous', OLD.`source_url`, 'current', NEW.`source_url`) END))); END;
--> statement-breakpoint
CREATE TRIGGER `record_payables_delete` AFTER DELETE ON `payables`
BEGIN INSERT INTO `record_log` (`org_id`, `kind`, `record_id`, `at`, `action`, `detail`) VALUES (OLD.`org_id`, 'payable', OLD.`id`, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'deleted', json_object('reference', OLD.`reference`)); END;
