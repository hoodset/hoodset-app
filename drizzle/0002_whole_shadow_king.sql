CREATE TABLE `agent_accounts` (
	`account` text PRIMARY KEY NOT NULL,
	`credits` integer DEFAULT 0 NOT NULL,
	`spent` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agent_challenges` (
	`nonce` text PRIMARY KEY NOT NULL,
	`account` text NOT NULL,
	`action` text NOT NULL,
	`payload` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agent_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`account` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	`paid_hash` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_invoices_paid_hash_unique` ON `agent_invoices` (`paid_hash`);--> statement-breakpoint
CREATE INDEX `agent_invoices_account` ON `agent_invoices` (`account`);--> statement-breakpoint
CREATE TABLE `agent_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`account` text NOT NULL,
	`hash` text NOT NULL,
	`prefix` text NOT NULL,
	`label` text NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_keys_hash_unique` ON `agent_keys` (`hash`);--> statement-breakpoint
CREATE INDEX `agent_keys_account` ON `agent_keys` (`account`);--> statement-breakpoint
CREATE TABLE `agent_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`window` integer NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agent_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`address` text NOT NULL,
	`at` integer NOT NULL,
	`block` integer NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_observations_vault` ON `agent_observations` (`address`,`at`);--> statement-breakpoint
CREATE TABLE `agent_payments` (
	`hash` text PRIMARY KEY NOT NULL,
	`invoice` text NOT NULL,
	`account` text NOT NULL,
	`amount` text NOT NULL,
	`credits` integer NOT NULL,
	`block` integer NOT NULL,
	`block_hash` text NOT NULL,
	`paid_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_payments_invoice_unique` ON `agent_payments` (`invoice`);--> statement-breakpoint
CREATE TABLE `agent_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`key_id` text NOT NULL,
	`account` text NOT NULL,
	`fingerprint` text NOT NULL,
	`tool` text NOT NULL,
	`status` text NOT NULL,
	`result` text,
	`created_at` integer NOT NULL,
	`lease_until` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_requests_account` ON `agent_requests` (`account`,`created_at`);