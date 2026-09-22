-- Custom migration (slice B2 review round 3): a trigger whose WHEN is NULL does not fire. In 0009 the guard
-- was `WHEN NOT (…)`; with a required key missing (but five keys in total) json_type(…) = 'text' is NULL,
-- NOT NULL is NULL, and the trigger silently let the row through. The guard is now `(…) IS NOT 1`, which is
-- true for both false and NULL. Convention: a trigger's WHEN clause must never be able to be NULL.
DROP TRIGGER `receipts_sealed_valid_insert`;
--> statement-breakpoint
DROP TRIGGER `receipts_sealed_valid_update`;
--> statement-breakpoint
CREATE TRIGGER `receipts_sealed_valid_insert` BEFORE INSERT ON `receipts`
WHEN (CASE WHEN json_valid(NEW.`sealed`) THEN (json_type(NEW.`sealed`) = 'object'
  AND (SELECT count(*) FROM json_each(NEW.`sealed`)) = 5
  AND json_type(NEW.`sealed`, '$.v') = 'integer' AND json_extract(NEW.`sealed`, '$.v') = 1
  AND json_type(NEW.`sealed`, '$.kid') = 'text' AND json_type(NEW.`sealed`, '$.iv') = 'text'
  AND json_type(NEW.`sealed`, '$.tag') = 'text' AND json_type(NEW.`sealed`, '$.ct') = 'text'
  AND json_extract(NEW.`sealed`, '$.kid') IS NEW.`sealed_kid`) ELSE 0 END) IS NOT 1
BEGIN SELECT RAISE(ABORT, 'sealed payload is not a valid envelope for its key id'); END;
--> statement-breakpoint
CREATE TRIGGER `receipts_sealed_valid_update` BEFORE UPDATE ON `receipts`
WHEN (CASE WHEN json_valid(NEW.`sealed`) THEN (json_type(NEW.`sealed`) = 'object'
  AND (SELECT count(*) FROM json_each(NEW.`sealed`)) = 5
  AND json_type(NEW.`sealed`, '$.v') = 'integer' AND json_extract(NEW.`sealed`, '$.v') = 1
  AND json_type(NEW.`sealed`, '$.kid') = 'text' AND json_type(NEW.`sealed`, '$.iv') = 'text'
  AND json_type(NEW.`sealed`, '$.tag') = 'text' AND json_type(NEW.`sealed`, '$.ct') = 'text'
  AND json_extract(NEW.`sealed`, '$.kid') IS NEW.`sealed_kid`) ELSE 0 END) IS NOT 1
BEGIN SELECT RAISE(ABORT, 'sealed payload is not a valid envelope for its key id'); END;
