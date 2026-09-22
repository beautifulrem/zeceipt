-- Custom migration (slice B2): an issued receipt is a record. It is never deleted; its identity and
-- projections never change; only the sealed payload and its key id may change (re-wrap under a newer
-- key). INSERT OR REPLACE of an existing receipt is a no-op (first receipt per output wins; RAISE(IGNORE)
-- keeps the repository's ON CONFLICT DO NOTHING working, as for the ledger in 0004).
CREATE TRIGGER `receipts_no_delete` BEFORE DELETE ON `receipts`
BEGIN SELECT RAISE(ABORT, 'receipts are records and are never deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `receipts_fixed` BEFORE UPDATE ON `receipts`
WHEN NEW.`org_id` IS NOT OLD.`org_id` OR NEW.`txid` IS NOT OLD.`txid` OR NEW.`pool` IS NOT OLD.`pool`
  OR NEW.`output_index` IS NOT OLD.`output_index` OR NEW.`batch_id` IS NOT OLD.`batch_id` OR NEW.`idx` IS NOT OLD.`idx`
  OR NEW.`value_zat` IS NOT OLD.`value_zat` OR NEW.`recipient` IS NOT OLD.`recipient` OR NEW.`memo_text` IS NOT OLD.`memo_text`
  OR NEW.`issued_at` IS NOT OLD.`issued_at` OR NEW.`verified_at` IS NOT OLD.`verified_at`
BEGIN SELECT RAISE(ABORT, 'a receipt never changes except for re-wrapping its sealed payload'); END;
--> statement-breakpoint
CREATE TRIGGER `receipts_keep` BEFORE INSERT ON `receipts`
WHEN EXISTS (SELECT 1 FROM `receipts` r WHERE r.`org_id` = NEW.`org_id` AND r.`txid` = NEW.`txid` AND r.`pool` = NEW.`pool` AND r.`output_index` = NEW.`output_index`)
BEGIN SELECT RAISE(IGNORE); END;
