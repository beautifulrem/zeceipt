-- Custom migration (slice B2 review round 1): the sealed column must always hold a well-formed envelope
-- whose own key id equals `sealed_kid` (rotation selects rows by key id, so a drifted copy would let a
-- rewrap skip rows and a key retirement strand them), and a receipt may only be recorded for its batch's
-- own broadcast transaction — on any connection, not only through the repository.
CREATE TRIGGER `receipts_sealed_valid_insert` BEFORE INSERT ON `receipts`
WHEN NOT (json_valid(NEW.`sealed`) AND json_extract(NEW.`sealed`, '$.v') IS 1
  AND json_type(NEW.`sealed`, '$.iv') = 'text' AND json_type(NEW.`sealed`, '$.tag') = 'text' AND json_type(NEW.`sealed`, '$.ct') = 'text'
  AND json_extract(NEW.`sealed`, '$.kid') IS NEW.`sealed_kid`)
BEGIN SELECT RAISE(ABORT, 'sealed payload is not a valid envelope for its key id'); END;
--> statement-breakpoint
CREATE TRIGGER `receipts_sealed_valid_update` BEFORE UPDATE ON `receipts`
WHEN NOT (json_valid(NEW.`sealed`) AND json_extract(NEW.`sealed`, '$.v') IS 1
  AND json_type(NEW.`sealed`, '$.iv') = 'text' AND json_type(NEW.`sealed`, '$.tag') = 'text' AND json_type(NEW.`sealed`, '$.ct') = 'text'
  AND json_extract(NEW.`sealed`, '$.kid') IS NEW.`sealed_kid`)
BEGIN SELECT RAISE(ABORT, 'sealed payload is not a valid envelope for its key id'); END;
--> statement-breakpoint
CREATE TRIGGER `receipts_own_broadcast` BEFORE INSERT ON `receipts`
WHEN NOT EXISTS (SELECT 1 FROM `submissions` s WHERE s.`org_id` = NEW.`org_id` AND s.`batch_id` = NEW.`batch_id` AND s.`state` = 'broadcast' AND s.`txid` = NEW.`txid`)
 AND NOT EXISTS (SELECT 1 FROM `receipts` r WHERE r.`org_id` = NEW.`org_id` AND r.`txid` = NEW.`txid` AND r.`pool` = NEW.`pool` AND r.`output_index` = NEW.`output_index`)
BEGIN SELECT RAISE(ABORT, 'a receipt is recorded only for its batch''s own broadcast transaction'); END;
