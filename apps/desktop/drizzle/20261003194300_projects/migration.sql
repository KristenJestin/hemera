CREATE TABLE `project_repositories` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`path` text NOT NULL,
	`position` integer NOT NULL,
	`included_by_default` integer NOT NULL,
	`remote` text,
	`base_branch` text NOT NULL,
	`last_fetched_at` text,
	CONSTRAINT `fk_project_repositories_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `repository_once_in_project` UNIQUE(`project_id`,`path`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`main_checkout` text NOT NULL,
	`workspaces_root` text,
	`branch_prefix` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer NOT NULL
);
