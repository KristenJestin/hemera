CREATE TABLE `attempt_writes` (
	`id` text PRIMARY KEY,
	`building_id` text NOT NULL,
	`attempt_id` text NOT NULL,
	`task_id` text NOT NULL,
	`session_id` text NOT NULL,
	`repository` text NOT NULL,
	`path` text NOT NULL,
	`kind` text NOT NULL,
	`run_id` text,
	`action_id` text,
	`fingerprint` text,
	`at` text NOT NULL,
	CONSTRAINT `fk_attempt_writes_building_id_buildings_id_fk` FOREIGN KEY (`building_id`) REFERENCES `buildings`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `building_check_results` (
	`id` text PRIMARY KEY,
	`attempt_id` text NOT NULL,
	`name` text NOT NULL,
	`place` text NOT NULL,
	`verdict` text NOT NULL,
	`detail` text NOT NULL,
	`output_tail` text NOT NULL,
	`run_id` text,
	`at` text NOT NULL,
	CONSTRAINT `fk_building_check_results_attempt_id_building_attempts_id_fk` FOREIGN KEY (`attempt_id`) REFERENCES `building_attempts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `building_conflicts` (
	`id` text PRIMARY KEY,
	`building_id` text NOT NULL,
	`repository` text NOT NULL,
	`path` text NOT NULL,
	`run_id` text NOT NULL,
	`command` text NOT NULL,
	`by_task` text NOT NULL,
	`held_by` text NOT NULL,
	`at` text NOT NULL,
	CONSTRAINT `fk_building_conflicts_building_id_buildings_id_fk` FOREIGN KEY (`building_id`) REFERENCES `buildings`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `building_unattributed` (
	`building_id` text NOT NULL,
	`repository` text NOT NULL,
	`path` text NOT NULL,
	`attempt_id` text,
	`seen_at` text NOT NULL,
	CONSTRAINT `building_unattributed_pk` PRIMARY KEY(`building_id`, `repository`, `path`),
	CONSTRAINT `fk_building_unattributed_building_id_buildings_id_fk` FOREIGN KEY (`building_id`) REFERENCES `buildings`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `building_attempts` ADD `scope` text DEFAULT 'task' NOT NULL;--> statement-breakpoint
ALTER TABLE `building_attempts` ADD `subject` text;--> statement-breakpoint
ALTER TABLE `building_attempts` ADD `verdict` text;--> statement-breakpoint
ALTER TABLE `building_attempts` ADD `counted` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `building_attempts` ADD `files` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `building_decisions` ADD `proposer` text;--> statement-breakpoint
ALTER TABLE `building_decisions` ADD `scope` text;--> statement-breakpoint
ALTER TABLE `building_decisions` ADD `subject` text;--> statement-breakpoint
CREATE INDEX `attempt_writes_of_attempt` ON `attempt_writes` (`attempt_id`);--> statement-breakpoint
CREATE INDEX `attempt_writes_of_building` ON `attempt_writes` (`building_id`,`repository`,`path`);--> statement-breakpoint
CREATE INDEX `building_check_results_of_attempt` ON `building_check_results` (`attempt_id`);--> statement-breakpoint
CREATE INDEX `building_conflicts_of_building` ON `building_conflicts` (`building_id`);