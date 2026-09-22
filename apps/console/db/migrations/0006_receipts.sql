CREATE TABLE `receipts` (
	`org_id` text NOT NULL,
	`txid` text NOT NULL,
	`pool` text NOT NULL,
	`output_index` integer NOT NULL,
	`batch_id` text NOT NULL,
	`idx` integer NOT NULL,
	`value_zat` integer NOT NULL,
	`recipient` text NOT NULL,
	`memo_text` text NOT NULL,
	`issued_at` text NOT NULL,
	`verified_at` text NOT NULL,
	`sealed` text NOT NULL,
	`sealed_kid` text NOT NULL,
	PRIMARY KEY(`org_id`, `txid`, `pool`, `output_index`),
	FOREIGN KEY (`org_id`,`batch_id`,`idx`) REFERENCES `batch_items`(`org_id`,`batch_id`,`idx`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "receipts_txid_hex" CHECK(length("receipts"."txid") = 64 and "receipts"."txid" not glob '*[^0-9a-f]*'),
	CONSTRAINT "receipts_pool" CHECK("receipts"."pool" in ('sapling', 'orchard', 'ironwood')),
	CONSTRAINT "receipts_output_index" CHECK(typeof("receipts"."output_index") = 'integer' and "receipts"."output_index" >= 0),
	CONSTRAINT "receipts_value" CHECK(typeof("receipts"."value_zat") = 'integer' and "receipts"."value_zat" between 1 and 2100000000000000),
	CONSTRAINT "receipts_recipient" CHECK(length("receipts"."recipient") between 1 and 1000),
	CONSTRAINT "receipts_sealed" CHECK(length("receipts"."sealed") > 0 and length("receipts"."sealed_kid") between 1 and 64)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `receipts_item_unique` ON `receipts` (`org_id`,`batch_id`,`idx`);