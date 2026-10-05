CREATE TABLE `mission_marks` (
	`id` text PRIMARY KEY,
	`mission_id` text NOT NULL,
	`identity` text NOT NULL,
	`mark` text NOT NULL,
	`set_at` text NOT NULL,
	CONSTRAINT `fk_mission_marks_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `mark_once_on_mission` UNIQUE(`mission_id`,`identity`)
);
--> statement-breakpoint
CREATE TABLE `mission_stops` (
	`mission_id` text NOT NULL,
	`stopper` text NOT NULL,
	`failed_reason` text,
	CONSTRAINT `fk_mission_stops_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `stop_once` UNIQUE(`mission_id`,`stopper`)
);
--> statement-breakpoint
CREATE TABLE `missions` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`key_prefix` text NOT NULL,
	`key_number` integer NOT NULL,
	`title` text NOT NULL,
	`idea_sentence` text,
	`idea_ticket` text,
	`type` text NOT NULL,
	`ticket_provider` text,
	`ticket_key` text,
	`ticket_url` text,
	`stage` text NOT NULL,
	`round` integer NOT NULL,
	`cleanup` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_missions_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `mission_key_once` UNIQUE(`key_prefix`,`key_number`)
);
--> statement-breakpoint
CREATE TABLE `need_deliveries` (
	`need_id` text PRIMARY KEY,
	`delivered_at` text,
	CONSTRAINT `fk_need_deliveries_need_id_needs_id_fk` FOREIGN KEY (`need_id`) REFERENCES `needs`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `needs` (
	`id` text PRIMARY KEY,
	`owner_kind` text NOT NULL,
	`project_id` text,
	`mission_id` text,
	`task_id` text,
	`kind` text NOT NULL,
	`fields` text NOT NULL,
	`service` text NOT NULL,
	`requested_by` text,
	`state` text NOT NULL,
	`answer` text,
	`answer_key` text,
	`ended_reason` text,
	`created_at` text NOT NULL,
	`ended_at` text,
	CONSTRAINT `fk_needs_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_needs_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `command_runs` ADD `mission_id` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `key_prefix` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `next_mission` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX `missions_by_project` ON `missions` (`project_id`,`key_number`);--> statement-breakpoint
CREATE INDEX `needs_by_state` ON `needs` (`state`,`created_at`);--> statement-breakpoint
CREATE INDEX `needs_by_mission` ON `needs` (`mission_id`,`state`);--> statement-breakpoint
CREATE UNIQUE INDEX `key_prefix_once` ON `projects` (`key_prefix`);