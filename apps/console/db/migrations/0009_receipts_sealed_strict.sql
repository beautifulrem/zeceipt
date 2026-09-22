-- Custom migration (slice B2 review round 2): make the envelope check agree with the JavaScript parser.
-- json_valid accepts duplicate keys; SQLite's json_extract reads the FIRST occurrence while JSON.parse keeps
-- the LAST, so '{"kid":"k1", …, "kid":"k2"}' looked like k1 to the retirement guard and k2 to `open`.
-- Exactly five entries with the five required keys rules out duplicates; `v` must be the integer 1 (json
-- true also extracts as 1) and `kid` must be text. SQLite does not guarantee short-circuit AND, so the JSON
-- functions are guarded by CASE WHEN json_valid(...) (on invalid JSON they would raise a generic error).
DROP TRIGGER `receipts_sealed_valid_insert`;
--> statement-breakpoint
DROP TRIGGER `receipts_sealed_valid_update`;
--> statement-breakpoint
CREATE TRIGGER `receipts_sealed_valid_insert` BEFORE INSERT ON `receipts`
WHEN NOT (CASE WHEN json_valid(NEW.`sealed`) THEN (json_type(NEW.`sealed`) = 'object'
  AND (SELECT count(*) FROM json_each(NEW.`sealed`)) = 5
  AND json_type(NEW.`sealed`, '$.v') = 'integer' AND json_extract(NEW.`sealed`, '$.v') = 1
  AND json_type(NEW.`sealed`, '$.kid') = 'text' AND json_type(NEW.`sealed`, '$.iv') = 'text'
  AND json_type(NEW.`sealed`, '$.tag') = 'text' AND json_type(NEW.`sealed`, '$.ct') = 'text'
  AND json_extract(NEW.`sealed`, '$.kid') IS NEW.`sealed_kid`) ELSE 0 END)
BEGIN SELECT RAISE(ABORT, 'sealed payload is not a valid envelope for its key id'); END;
--> statement-breakpoint
CREATE TRIGGER `receipts_sealed_valid_update` BEFORE UPDATE ON `receipts`
WHEN NOT (CASE WHEN json_valid(NEW.`sealed`) THEN (json_type(NEW.`sealed`) = 'object'
  AND (SELECT count(*) FROM json_each(NEW.`sealed`)) = 5
  AND json_type(NEW.`sealed`, '$.v') = 'integer' AND json_extract(NEW.`sealed`, '$.v') = 1
  AND json_type(NEW.`sealed`, '$.kid') = 'text' AND json_type(NEW.`sealed`, '$.iv') = 'text'
  AND json_type(NEW.`sealed`, '$.tag') = 'text' AND json_type(NEW.`sealed`, '$.ct') = 'text'
  AND json_extract(NEW.`sealed`, '$.kid') IS NEW.`sealed_kid`) ELSE 0 END)
BEGIN SELECT RAISE(ABORT, 'sealed payload is not a valid envelope for its key id'); END;
