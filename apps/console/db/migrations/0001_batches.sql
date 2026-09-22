CREATE TABLE `batch_items` (
	`org_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`idx` integer NOT NULL,
	`payable_id` text NOT NULL,
	`label` text NOT NULL,
	`address` text NOT NULL,
	`zat` integer NOT NULL,
	`memo` text NOT NULL,
	PRIMARY KEY(`org_id`, `batch_id`, `idx`),
	FOREIGN KEY (`org_id`,`batch_id`) REFERENCES `batches`(`org_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "batch_items_idx" CHECK("batch_items"."idx" >= 0),
	CONSTRAINT "batch_items_payable_len" CHECK(length("batch_items"."payable_id") between 1 and 200),
	CONSTRAINT "batch_items_label_len" CHECK(length("batch_items"."label") <= 200),
	CONSTRAINT "batch_items_address" CHECK(length("batch_items"."address") between 1 and 1000 and "batch_items"."address" = lower("batch_items"."address")),
	CONSTRAINT "batch_items_zat" CHECK(typeof("batch_items"."zat") = 'integer' and "batch_items"."zat" between 1 and 2100000000000000),
	CONSTRAINT "batch_items_memo_bytes" CHECK(length(cast("batch_items"."memo" as blob)) between 1 and 512)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `batch_items_payable_unique` ON `batch_items` (`org_id`,`batch_id`,`payable_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `batch_items_memo_unique` ON `batch_items` (`org_id`,`batch_id`,`memo`);--> statement-breakpoint
CREATE TABLE `batches` (
	`org_id` text NOT NULL,
	`id` text NOT NULL,
	`network` text NOT NULL,
	`title` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`org_id`, `id`),
	CONSTRAINT "batches_id_uuid" CHECK(length("batches"."id") = 36 and "batches"."id" glob '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
	CONSTRAINT "batches_network" CHECK("batches"."network" in ('main', 'test', 'regtest')),
	CONSTRAINT "batches_title_len" CHECK(length("batches"."title") between 1 and 200)
);
