CREATE TABLE `building_check_runs` (
	`attempt_id` text NOT NULL,
	`name` text NOT NULL,
	`place` text NOT NULL,
	`run_id` text NOT NULL,
	`command_id` text,
	`started_at` text NOT NULL,
	CONSTRAINT `building_check_runs_pk` PRIMARY KEY(`attempt_id`, `name`, `place`),
	CONSTRAINT `fk_building_check_runs_attempt_id_building_attempts_id_fk` FOREIGN KEY (`attempt_id`) REFERENCES `building_attempts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `project_checks` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`command_id` text,
	`line` text,
	`where` text NOT NULL,
	`repository` text,
	`when` text NOT NULL,
	`expect_pattern` text,
	`expect_minimum` real,
	`files` text,
	`rank` integer NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_project_checks_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_project_checks_command_id_project_commands_id_fk` FOREIGN KEY (`command_id`) REFERENCES `project_commands`(`id`) ON DELETE CASCADE,
	CONSTRAINT `check_name_once_in_project` UNIQUE(`project_id`,`name`)
);
--> statement-breakpoint
ALTER TABLE `building_check_results` ADD `line` text;--> statement-breakpoint
ALTER TABLE `building_check_results` ADD `exit_code` integer;--> statement-breakpoint
ALTER TABLE `building_check_results` ADD `value` real;--> statement-breakpoint
ALTER TABLE `building_check_results` ADD `tree` text;--> statement-breakpoint
ALTER TABLE `building_check_results` ADD `evidence_id` text;