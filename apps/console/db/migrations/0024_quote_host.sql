-- Custom migration (slice N1): each quote records the host it came from, so a proxy or a test double is never presented
-- as Kraken, and a later configuration change cannot relabel old quotes. A plain column add: `rate_quotes` has
-- append-only triggers (0012, 0014) and the audit trigger (0021), which a table rebuild would drop. NULL for quotes
-- recorded before; the value is validated in code (`quoteProblem`), since a CHECK would need a rebuild.
ALTER TABLE `rate_quotes` ADD `source_host` text;
