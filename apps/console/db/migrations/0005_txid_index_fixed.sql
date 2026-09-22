-- Custom migration (slice B1 review round 3): an index entry, once written, never changes. The store only
-- ever inserts index rows (ON CONFLICT DO NOTHING), so any UPDATE of `submission_txids` — moving an entry to
-- another nonce/attempt, or renaming its txid (a deletion in effect) — is refused.
CREATE TRIGGER `submission_txids_fixed` BEFORE UPDATE ON `submission_txids`
BEGIN SELECT RAISE(ABORT, 'the txid index never changes'); END;
