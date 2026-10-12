CREATE TABLE `helpers` (
	`id` text PRIMARY KEY,
	`mission_id` text NOT NULL,
	`number` integer NOT NULL,
	`parent_lineage` text NOT NULL,
	`lineage` text NOT NULL,
	`depth` integer NOT NULL,
	`definition` text,
	`task_id` text,
	`writes` integer NOT NULL,
	`place` text NOT NULL,
	`folder` text NOT NULL,
	`tools` text,
	`brief` text NOT NULL,
	`state` text NOT NULL,
	`stuck` integer NOT NULL,
	`result` text,
	`failure` text,
	`started_at` text NOT NULL,
	`ended_at` text,
	CONSTRAINT `fk_helpers_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `helper_number_in_mission` UNIQUE(`mission_id`,`number`)
);
--> statement-breakpoint
CREATE TABLE `queued_results` (
	`helper_id` text PRIMARY KEY,
	`mission_id` text NOT NULL,
	`parent_lineage` text NOT NULL,
	`body` text NOT NULL,
	`queued_at` text NOT NULL,
	`delivered_at` text,
	CONSTRAINT `fk_queued_results_helper_id_helpers_id_fk` FOREIGN KEY (`helper_id`) REFERENCES `helpers`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_queued_results_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `helper_of_lineage` ON `helpers` (`lineage`);