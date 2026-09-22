CREATE TABLE `submission_claims` (
	`org_id` text NOT NULL,
	`nonce` text NOT NULL,
	`attempt` integer NOT NULL,
	`gen` integer NOT NULL,
	`claimed_at_ms` integer NOT NULL,
	PRIMARY KEY(`org_id`, `nonce`, `attempt`, `gen`),
	FOREIGN KEY (`org_id`,`nonce`) REFERENCES `submissions`(`org_id`,`nonce`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "submission_claims_attempt" CHECK("submission_claims"."attempt" >= 2 and "submission_claims"."gen" >= 0)
);
--> statement-breakpoint
CREATE TABLE `submission_txids` (
	`txid` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`nonce` text NOT NULL,
	`attempt` integer NOT NULL,
	FOREIGN KEY (`org_id`,`nonce`) REFERENCES `submissions`(`org_id`,`nonce`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "submission_txids_hex" CHECK(length("submission_txids"."txid") = 64 and "submission_txids"."txid" not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE TABLE `submissions` (
	`org_id` text NOT NULL,
	`nonce` text NOT NULL,
	`batch_id` text NOT NULL,
	`batch_digest` text NOT NULL,
	`state` text NOT NULL,
	`attempts` integer NOT NULL,
	`txid` text,
	`intent_height` integer,
	`expires_by` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`broadcast_at` text,
	`error` text,
	PRIMARY KEY(`org_id`, `nonce`),
	CONSTRAINT "submissions_nonce_len" CHECK(length("submissions"."nonce") between 1 and 200),
	CONSTRAINT "submissions_digest_hex" CHECK(length("submissions"."batch_digest") = 64 and "submissions"."batch_digest" not glob '*[^0-9a-f]*'),
	CONSTRAINT "submissions_state" CHECK("submissions"."state" in ('submitting', 'broadcast', 'failed_retryable', 'unknown_outcome')),
	CONSTRAINT "submissions_attempts" CHECK("submissions"."attempts" >= 1),
	CONSTRAINT "submissions_txid_hex" CHECK("submissions"."txid" is null or (length("submissions"."txid") = 64 and "submissions"."txid" not glob '*[^0-9a-f]*')),
	CONSTRAINT "submissions_broadcast_has_txid" CHECK("submissions"."state" <> 'broadcast' or "submissions"."txid" is not null)
);
