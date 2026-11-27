CREATE TABLE `history_cache` (
	`symbol` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`payload` text NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `history_locks` (
	`symbol` text PRIMARY KEY NOT NULL,
	`lease` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `history_provider` (
	`id` text PRIMARY KEY NOT NULL,
	`retry_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `history_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`requested_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `history_requests_at` ON `history_requests` (`requested_at`);