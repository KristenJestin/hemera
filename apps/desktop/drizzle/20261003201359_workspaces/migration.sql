CREATE TABLE `environment_variables` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`workspace_id` text,
	`key` text NOT NULL,
	`value` text NOT NULL,
	CONSTRAINT `fk_environment_variables_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_environment_variables_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `project_preparation_steps` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`repository_id` text,
	`path` text,
	`command_id` text,
	`line` text,
	CONSTRAINT `fk_project_preparation_steps_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_project_preparation_steps_repository_id_project_repositories_id_fk` FOREIGN KEY (`repository_id`) REFERENCES `project_repositories`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `workspace_repositories` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`repository_id` text NOT NULL,
	`path` text NOT NULL,
	`worktree` text NOT NULL,
	`position` integer NOT NULL,
	`base_commit` text NOT NULL,
	`base_ref` text,
	`base_freshness` text,
	CONSTRAINT `fk_workspace_repositories_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE,
	CONSTRAINT `repository_once_in_workspace` UNIQUE(`workspace_id`,`repository_id`)
);
--> statement-breakpoint
CREATE TABLE `workspace_steps` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`base` text,
	`path` text,
	`command_id` text,
	`line` text,
	`state` text NOT NULL,
	`failed_doing` text,
	`failed_output` text,
	CONSTRAINT `fk_workspace_steps_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE,
	CONSTRAINT `step_once_in_workspace` UNIQUE(`workspace_id`,`position`)
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`folder` text NOT NULL,
	`branch` text,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_workspaces_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `workspace_name_once_in_project` UNIQUE(`project_id`,`name`)
);
--> statement-breakpoint
CREATE INDEX `variables_by_scope` ON `environment_variables` (`project_id`,`workspace_id`);