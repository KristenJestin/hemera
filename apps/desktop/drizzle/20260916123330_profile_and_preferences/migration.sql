CREATE TABLE `app_preferences` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `profile` (
	`id` integer PRIMARY KEY,
	`written_by_version` text NOT NULL,
	`last_opened_at` text NOT NULL,
	CONSTRAINT "profile_is_one_row" CHECK("id" = 1)
);
