CREATE TABLE `forge_needs` (
	`need_id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`cli` text NOT NULL,
	`host` text NOT NULL,
	CONSTRAINT `fk_forge_needs_need_id_needs_id_fk` FOREIGN KEY (`need_id`) REFERENCES `needs`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_forge_needs_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `repository_forges` (
	`repository_id` text PRIMARY KEY,
	`forge` text NOT NULL,
	`host` text,
	CONSTRAINT `fk_repository_forges_repository_id_project_repositories_id_fk` FOREIGN KEY (`repository_id`) REFERENCES `project_repositories`(`id`) ON DELETE CASCADE
);
