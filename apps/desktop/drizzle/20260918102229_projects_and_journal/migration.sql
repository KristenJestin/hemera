CREATE TABLE `domain_events` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT,
	`type` text NOT NULL,
	`entity_kind` text NOT NULL,
	`entity_id` text NOT NULL,
	`source` text NOT NULL,
	`author` text NOT NULL,
	`occurred_at` text NOT NULL,
	`project_id` text,
	`session_id` text,
	`spec_id` text,
	`revision_id` text,
	`phase_id` text,
	`payload` text NOT NULL,
	`seen_at` text,
	CONSTRAINT "event_entity_is_known" CHECK("entity_kind" IN ('project', 'profile', 'session')),
	CONSTRAINT "event_source_is_known" CHECK("source" IN ('ui', 'system')),
	CONSTRAINT "event_author_is_known" CHECK("author" IN ('human', 'hemera', 'agent', 'mcp', 'system'))
);
--> statement-breakpoint
CREATE TABLE `project_repositories` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`relative_path` text NOT NULL,
	`rank` text NOT NULL,
	CONSTRAINT `fk_project_repositories_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `repository_once_in_project` UNIQUE(`project_id`,`relative_path`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`tone` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	`version` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "project_tone_is_known" CHECK("tone" IN ('primary', 'info', 'success', 'warning', 'neutral'))
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_workspaces_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `workspace_name_in_project` UNIQUE(`project_id`,`name`)
);
--> statement-breakpoint
CREATE INDEX `event_by_project` ON `domain_events` (`project_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `event_by_session` ON `domain_events` (`session_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `event_unseen` ON `domain_events` (`seen_at`);