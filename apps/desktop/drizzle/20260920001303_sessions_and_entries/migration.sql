CREATE TABLE `session_entries` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`seq` integer NOT NULL,
	`role` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_session_entries_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `entry_once_in_session` UNIQUE(`session_id`,`seq`),
	CONSTRAINT "entry_role_is_known" CHECK("role" IN ('user'))
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`title_source` text NOT NULL,
	`created_at` text NOT NULL,
	`last_written_at` text NOT NULL,
	`archived_at` text,
	`version` integer DEFAULT 1 NOT NULL,
	CONSTRAINT `fk_sessions_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT "session_title_source_is_known" CHECK("title_source" IN ('derived', 'user'))
);
--> statement-breakpoint
CREATE INDEX `session_by_project` ON `sessions` (`project_id`,`last_written_at`);