// The payable rules' constants (slices H3 and H4), in a module with no imports so the browser bundle can use them
// (the page's form converts dollars against the cap). `lib/data/payables.ts` imports the database and re-exports these.

export const PAYABLE_KINDS = ["milestone", "invoice", "bounty", "salary"] as const;
export type PayableKind = (typeof PAYABLE_KINDS)[number];
/** Stripe's USD cap: 8 digits of cents, $999,999.99 (R78). */
export const USD_CENTS_MAX = 99_999_999;
/** Bill.com's `invoiceNumber` bound (R78); at most 400 UTF-8 bytes, inside the 512-byte memo. */
export const REFERENCE_MAX = 100;
export const SOURCE_URL_MAX = 2000;
