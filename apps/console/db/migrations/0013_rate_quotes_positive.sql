-- Custom migration (review G1b round 1): a price of zero is well-formed but meaningless, and G2 divides by
-- the rate. The CHECKs of 0011 enforce the shape of a plain decimal; this adds positivity. A well-formed
-- plain decimal is positive exactly when it contains a non-zero digit, which GLOB can test. Quotes are
-- insert-only (0012), so a BEFORE INSERT trigger covers every row. bid ≤ ask needs decimal arithmetic and
-- stays in the application (lib/data/rates.ts, compareDecimal). The WHEN clause is never NULL for a row that
-- can be stored: a NULL price fails its NOT NULL constraint anyway.
CREATE TRIGGER `rate_quotes_positive` BEFORE INSERT ON `rate_quotes`
WHEN NEW.`bid` NOT GLOB '*[1-9]*' OR NEW.`ask` NOT GLOB '*[1-9]*' OR NEW.`last` NOT GLOB '*[1-9]*'
BEGIN SELECT RAISE(ABORT, 'rate quote prices must be greater than zero'); END;
