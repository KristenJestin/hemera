CREATE TABLE `documenter_passes` (
	`id` text PRIMARY KEY,
	`building_id` text NOT NULL,
	`mission_id` text NOT NULL,
	`number` integer NOT NULL,
	`mode` text NOT NULL,
	`files` text NOT NULL,
	`state` text NOT NULL,
	`lineage` text NOT NULL,
	`attempt_id` text NOT NULL,
	`reminded` integer DEFAULT false NOT NULL,
	`changed` text,
	`no_change_reason` text,
	`evidence_id` text,
	`failure` text,
	`started_at` text NOT NULL,
	`ended_at` text,
	CONSTRAINT `fk_documenter_passes_building_id_buildings_id_fk` FOREIGN KEY (`building_id`) REFERENCES `buildings`(`id`) ON DELETE CASCADE,
	CONSTRAINT `documenter_pass_number_in_building` UNIQUE(`building_id`,`number`)
);
--> statement-breakpoint
CREATE TABLE `project_doc_recipes` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`repository` text,
	`path` text NOT NULL,
	`purpose` text NOT NULL,
	`applies` text NOT NULL,
	`words` text NOT NULL,
	`rank` integer NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_project_doc_recipes_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_attempt_writes` (
	`id` text PRIMARY KEY,
	`building_id` text NOT NULL,
	`attempt_id` text NOT NULL,
	`task_id` text,
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
INSERT INTO `__new_attempt_writes`(`id`, `building_id`, `attempt_id`, `task_id`, `session_id`, `repository`, `path`, `kind`, `run_id`, `action_id`, `fingerprint`, `at`) SELECT `id`, `building_id`, `attempt_id`, `task_id`, `session_id`, `repository`, `path`, `kind`, `run_id`, `action_id`, `fingerprint`, `at` FROM `attempt_writes`;--> statement-breakpoint
DROP TABLE `attempt_writes`;--> statement-breakpoint
ALTER TABLE `__new_attempt_writes` RENAME TO `attempt_writes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `attempt_writes_of_attempt` ON `attempt_writes` (`attempt_id`);--> statement-breakpoint
CREATE INDEX `attempt_writes_of_building` ON `attempt_writes` (`building_id`,`repository`,`path`);--> statement-breakpoint
CREATE UNIQUE INDEX `documenter_pass_of_lineage` ON `documenter_passes` (`lineage`);