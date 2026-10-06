CREATE TABLE `setup_cards` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`session_id` text NOT NULL,
	`batch` text NOT NULL,
	`position` integer NOT NULL,
	`change` text NOT NULL,
	`title` text NOT NULL,
	`details` text NOT NULL,
	`state` text NOT NULL,
	`refusal` text,
	`created_at` text NOT NULL,
	`decided_at` text,
	CONSTRAINT `fk_setup_cards_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `setup_cards_by_project` ON `setup_cards` (`project_id`,`created_at`,`position`);