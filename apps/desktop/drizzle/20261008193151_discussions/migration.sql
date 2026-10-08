CREATE TABLE `discussion_messages` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT,
	`discussion_id` text NOT NULL,
	`author` text NOT NULL,
	`text` text NOT NULL,
	`proposal` integer DEFAULT false NOT NULL,
	`at` text NOT NULL,
	`delivery_id` text,
	CONSTRAINT `fk_discussion_messages_discussion_id_discussions_id_fk` FOREIGN KEY (`discussion_id`) REFERENCES `discussions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `discussions` (
	`id` text PRIMARY KEY,
	`mission_id` text NOT NULL,
	`number` integer NOT NULL,
	`item_kind` text NOT NULL,
	`item_id` text NOT NULL,
	`state` text NOT NULL,
	`outcome` text,
	`decision` text,
	`proposal` text,
	`proposed_at` text,
	`closed_by` text,
	`closed_at` text,
	`opened_at` text NOT NULL,
	CONSTRAINT `fk_discussions_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `discussion_messages_by_discussion` ON `discussion_messages` (`discussion_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `discussion_number_once` ON `discussions` (`mission_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `one_open_discussion_per_item` ON `discussions` (`mission_id`,`item_kind`,`item_id`) WHERE "discussions"."state" = 'open';