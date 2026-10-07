CREATE TABLE `exclusive_resource_commands` (
	`resource_id` text NOT NULL,
	`command_id` text NOT NULL,
	`role` text NOT NULL,
	CONSTRAINT `exclusive_resource_commands_pk` PRIMARY KEY(`resource_id`, `command_id`),
	CONSTRAINT `fk_exclusive_resource_commands_resource_id_exclusive_resources_id_fk` FOREIGN KEY (`resource_id`) REFERENCES `exclusive_resources`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_exclusive_resource_commands_command_id_project_commands_id_fk` FOREIGN KEY (`command_id`) REFERENCES `project_commands`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `exclusive_resources` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`key` text NOT NULL,
	`description` text NOT NULL,
	`reset_command_id` text,
	CONSTRAINT `fk_exclusive_resources_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_exclusive_resources_reset_command_id_project_commands_id_fk` FOREIGN KEY (`reset_command_id`) REFERENCES `project_commands`(`id`) ON DELETE SET NULL,
	CONSTRAINT `resource_once_in_project` UNIQUE(`project_id`,`key`)
);
--> statement-breakpoint
CREATE TABLE `resource_claims` (
	`id` text PRIMARY KEY,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`mission_id` text NOT NULL,
	`project_id` text NOT NULL,
	`workspace_id` text,
	`lasts` text NOT NULL,
	`round` integer,
	`state` text NOT NULL,
	`readiness` text,
	`action_id` text,
	`need_id` text,
	`blocked_by` text,
	`requested_at` text NOT NULL,
	`acquired_at` text,
	CONSTRAINT `fk_resource_claims_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_resource_claims_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_resource_claims_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE SET NULL,
	CONSTRAINT `claim_once_per_mission` UNIQUE(`key`,`mission_id`)
);
--> statement-breakpoint
CREATE INDEX `resource_commands_by_command` ON `exclusive_resource_commands` (`command_id`);--> statement-breakpoint
CREATE INDEX `resources_by_key` ON `exclusive_resources` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `one_holder_per_resource` ON `resource_claims` (`key`) WHERE "resource_claims"."state" = 'held';