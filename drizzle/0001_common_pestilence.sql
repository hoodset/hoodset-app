CREATE TABLE `vault_catalogue` (
	`address` text PRIMARY KEY NOT NULL,
	`listed_at` integer NOT NULL,
	`snapshot` text NOT NULL,
	`checked_at` integer NOT NULL,
	`checked_block` integer NOT NULL
);
