CREATE TABLE `app_preferences` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `domain_events` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT,
	`type` text NOT NULL,
	`entity_kind` text NOT NULL,
	`entity_id` text NOT NULL,
	`source` text NOT NULL,
	`author` text NOT NULL,
	`occurred_at` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `profile` (
	`row` integer PRIMARY KEY,
	`id` text NOT NULL,
	`created_by_version` text NOT NULL,
	`created_at` text NOT NULL,
	`last_opened_by_version` text NOT NULL,
	`last_opened_at` text NOT NULL,
	CONSTRAINT "profile_is_one_row" CHECK("row" = 1)
);
--> statement-breakpoint
CREATE INDEX `event_by_entity` ON `domain_events` (`entity_kind`,`entity_id`,`sequence`);