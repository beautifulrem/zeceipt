CREATE TABLE `payables` (
	`org_id` text NOT NULL,
	`id` text NOT NULL,
	`recipient_id` text NOT NULL,
	`kind` text NOT NULL,
	`usd_cents` integer NOT NULL,
	`reference` text NOT NULL,
	`source_url` text,
	`created_at` text NOT NULL,
	PRIMARY KEY(`org_id`, `id`),
	FOREIGN KEY (`org_id`,`recipient_id`) REFERENCES `recipients`(`org_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payables_id_uuid" CHECK(length("payables"."id") = 36 and "payables"."id" glob '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
	CONSTRAINT "payables_kind" CHECK("payables"."kind" in ('milestone', 'invoice', 'bounty', 'salary')),
	CONSTRAINT "payables_usd_cents" CHECK(typeof("payables"."usd_cents") = 'integer' and "payables"."usd_cents" between 1 and 99999999),
	CONSTRAINT "payables_reference" CHECK(typeof("payables"."reference") = 'text' and length("payables"."reference") between 1 and 100 and "payables"."reference" = trim("payables"."reference")),
	CONSTRAINT "payables_source_url" CHECK("payables"."source_url" is null or (typeof("payables"."source_url") = 'text' and length("payables"."source_url") <= 2000 and ("payables"."source_url" glob 'https://?*' or "payables"."source_url" glob 'http://?*'))),
	CONSTRAINT "payables_created_at" CHECK(typeof("payables"."created_at") = 'text' and length("payables"."created_at") = 24 and "payables"."created_at" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z')
);
--> statement-breakpoint
CREATE INDEX `payables_recipient` ON `payables` (`org_id`,`recipient_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payables_reference_unique` ON `payables` (`org_id`,`reference`);