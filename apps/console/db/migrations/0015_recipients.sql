CREATE TABLE `recipients` (
	`org_id` text NOT NULL,
	`id` text NOT NULL,
	`display_name` text NOT NULL,
	`address` text NOT NULL,
	`network` text NOT NULL,
	`kyc_status` text NOT NULL,
	`tax_flag` text NOT NULL,
	`settlement_pref` text NOT NULL,
	`notes` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`org_id`, `id`),
	CONSTRAINT "recipients_id_uuid" CHECK(length("recipients"."id") = 36 and "recipients"."id" glob '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
	CONSTRAINT "recipients_name_len" CHECK(length("recipients"."display_name") between 1 and 200),
	CONSTRAINT "recipients_network" CHECK("recipients"."network" in ('main', 'test', 'regtest')),
	CONSTRAINT "recipients_address" CHECK(length("recipients"."address") between 1 and 1000 and "recipients"."address" = lower("recipients"."address") and (("recipients"."network" = 'main' and "recipients"."address" glob 'u1*') or ("recipients"."network" = 'test' and "recipients"."address" glob 'utest1*') or ("recipients"."network" = 'regtest' and "recipients"."address" glob 'uregtest1*'))),
	CONSTRAINT "recipients_kyc" CHECK("recipients"."kyc_status" in ('unknown', 'verified', 'not_required')),
	CONSTRAINT "recipients_tax" CHECK("recipients"."tax_flag" in ('none', 'us_1099', 'non_us')),
	CONSTRAINT "recipients_settlement" CHECK("recipients"."settlement_pref" in ('zec', 'usdc_sol')),
	CONSTRAINT "recipients_notes_len" CHECK(length("recipients"."notes") <= 1000)
);
--> statement-breakpoint
CREATE INDEX `recipients_address` ON `recipients` (`org_id`,`address`);