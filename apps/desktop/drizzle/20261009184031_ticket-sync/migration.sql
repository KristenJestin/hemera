CREATE TABLE `proposed_answers` (
	`id` text PRIMARY KEY,
	`mission_id` text NOT NULL,
	`question_id` text NOT NULL,
	`comment_id` text NOT NULL,
	`comment_author` text,
	`comment_body` text NOT NULL,
	`text` text NOT NULL,
	`state` text NOT NULL,
	`session_id` text NOT NULL,
	`proposed_at` text NOT NULL,
	`decided_at` text,
	`reason` text,
	CONSTRAINT `fk_proposed_answers_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `ticket_event_runs` (
	`id` text PRIMARY KEY,
	`mission_id` text NOT NULL,
	`lineage` text NOT NULL,
	`state` text NOT NULL,
	`reminded` integer NOT NULL,
	`failure` text,
	`asked_at` text NOT NULL,
	`started_at` text,
	`ended_at` text,
	CONSTRAINT `fk_ticket_event_runs_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `ticket_events` (
	`id` text PRIMARY KEY,
	`mission_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`reference` text NOT NULL,
	`key` text NOT NULL,
	`kind` text NOT NULL,
	`comment_id` text,
	`before_version_id` text,
	`after_version_id` text NOT NULL,
	`difference` text NOT NULL,
	`stage` text NOT NULL,
	`detected_at` text NOT NULL,
	`state` text NOT NULL,
	`input_id` text,
	`run_id` text,
	`summary` text,
	`matters` text,
	`why` text,
	`analysed_at` text,
	`seen_at` text,
	CONSTRAINT `fk_ticket_events_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_ticket_events_before_version_id_ticket_versions_id_fk` FOREIGN KEY (`before_version_id`) REFERENCES `ticket_versions`(`id`),
	CONSTRAINT `fk_ticket_events_after_version_id_ticket_versions_id_fk` FOREIGN KEY (`after_version_id`) REFERENCES `ticket_versions`(`id`),
	CONSTRAINT `fk_ticket_events_run_id_ticket_event_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `ticket_event_runs`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
ALTER TABLE `mission_tickets` ADD `missing_since` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `ticket_sync_minutes` integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `tickets_checked_at` text;--> statement-breakpoint
CREATE INDEX `proposed_answers_of_question` ON `proposed_answers` (`mission_id`,`question_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ticket_event_run_of_lineage` ON `ticket_event_runs` (`lineage`);--> statement-breakpoint
CREATE UNIQUE INDEX `ticket_event_order` ON `ticket_events` (`mission_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `ticket_events_of_run` ON `ticket_events` (`run_id`);