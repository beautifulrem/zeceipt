-- Custom migration (review G2b1 round 1): a lock is refused once a submission exists, EXCEPT while that
-- submission is `failed_retryable`, the one state that proves nothing was paid (refused before building, or an
-- attempt that can no longer be mined and was not found; zkool-backend.ts `retry`). Otherwise a batch whose rate
-- guard refused a retry (409 rate_moved) could never be re-locked. `state` is NOT NULL, so the WHEN clause is
-- never NULL (the 0010 convention). Race: a retry that already passed the guard was checked against the lock it
-- saw; a re-lock afterwards applies to the next attempt.
DROP TRIGGER `rate_quotes_lock_frozen`;
--> statement-breakpoint
CREATE TRIGGER `rate_quotes_lock_frozen` BEFORE INSERT ON `rate_quotes`
WHEN NEW.`purpose` = 'lock' AND EXISTS (SELECT 1 FROM `submissions` s WHERE s.`org_id` = NEW.`org_id` AND s.`batch_id` = NEW.`batch_id` AND s.`state` <> 'failed_retryable')
BEGIN SELECT RAISE(ABORT, 'batch is frozen: a submission exists'); END;
