CREATE TABLE `command_runs` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`workspace_id` text,
	`command_id` text,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`line` text NOT NULL,
	`folder` text NOT NULL,
	`asked_line` text,
	`asked_folder` text,
	`started_by` text NOT NULL,
	`session_id` text,
	`state` text NOT NULL,
	`exit_code` integer,
	`url` text,
	`port_conflict` text,
	`output` text NOT NULL,
	`dropped` integer NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	CONSTRAINT `fk_command_runs_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_command_runs_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `project_commands` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`line` text NOT NULL,
	`line_windows` text,
	`line_linux` text,
	`repository_id` text,
	`folder` text,
	`scope` text NOT NULL,
	`portless` integer NOT NULL,
	`portless_name` text,
	`check` integer NOT NULL,
	`at_open` integer NOT NULL,
	`ask_before_running` integer NOT NULL,
	`read_only` integer NOT NULL,
	`write_globs` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_project_commands_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_project_commands_repository_id_project_repositories_id_fk` FOREIGN KEY (`repository_id`) REFERENCES `project_repositories`(`id`) ON DELETE CASCADE,
	CONSTRAINT `command_name_once_in_project` UNIQUE(`project_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `supervised_processes` (
	`id` text PRIMARY KEY,
	`pid` integer NOT NULL,
	`program` text NOT NULL,
	`args` text NOT NULL,
	`owner_kind` text NOT NULL,
	`owner_id` text NOT NULL,
	`engine` text NOT NULL,
	`started_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `runs_by_place` ON `command_runs` (`project_id`,`workspace_id`,`started_at`);