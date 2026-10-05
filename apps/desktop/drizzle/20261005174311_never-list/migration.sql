CREATE TABLE `project_never_entries` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`position` integer NOT NULL,
	`entry` text NOT NULL,
	CONSTRAINT `fk_project_never_entries_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `never_by_project` ON `project_never_entries` (`project_id`,`position`);