CREATE TABLE `base_moves` (
	`id` text PRIMARY KEY,
	`mission_id` text NOT NULL,
	`building_id` text NOT NULL,
	`repository` text NOT NULL,
	`from_commit` text NOT NULL,
	`to_commit` text NOT NULL,
	`files` text NOT NULL,
	`targeted` text NOT NULL,
	`at` text NOT NULL,
	CONSTRAINT `fk_base_moves_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_base_moves_building_id_buildings_id_fk` FOREIGN KEY (`building_id`) REFERENCES `buildings`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `dismissed_services` (
	`mission_id` text NOT NULL,
	`run_id` text NOT NULL,
	`at` text NOT NULL,
	CONSTRAINT `dismissed_services_pk` PRIMARY KEY(`mission_id`, `run_id`),
	CONSTRAINT `fk_dismissed_services_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `outside_changes` (
	`id` text PRIMARY KEY,
	`mission_id` text NOT NULL,
	`building_id` text NOT NULL,
	`repository` text NOT NULL,
	`path` text NOT NULL,
	`old_path` text,
	`status` text NOT NULL,
	`detected_at` text NOT NULL,
	`expected_tree` text NOT NULL,
	`found_tree` text NOT NULL,
	`before_sha` text,
	`after_sha` text,
	`withheld` text,
	`overwritten_by` text,
	`overwritten_run` text,
	`overwritten_session` text,
	`overwritten_task` text,
	`overwritten_at` text,
	CONSTRAINT `fk_outside_changes_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_outside_changes_building_id_buildings_id_fk` FOREIGN KEY (`building_id`) REFERENCES `buildings`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `outside_watches` (
	`building_id` text NOT NULL,
	`repository` text NOT NULL,
	`expected_tree` text NOT NULL,
	`compared_at` text NOT NULL,
	CONSTRAINT `outside_watches_pk` PRIMARY KEY(`building_id`, `repository`),
	CONSTRAINT `fk_outside_watches_building_id_buildings_id_fk` FOREIGN KEY (`building_id`) REFERENCES `buildings`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `building_unattributed` ADD `reconciled` text;--> statement-breakpoint
CREATE INDEX `base_moves_of_building` ON `base_moves` (`building_id`,`repository`);--> statement-breakpoint
CREATE INDEX `outside_changes_of_mission` ON `outside_changes` (`mission_id`);--> statement-breakpoint
CREATE INDEX `outside_changes_of_file` ON `outside_changes` (`building_id`,`repository`,`path`);