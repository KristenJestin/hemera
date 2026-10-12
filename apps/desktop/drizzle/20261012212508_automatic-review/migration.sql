CREATE TABLE `review_changed_after` (
	`building_id` text NOT NULL,
	`repository` text NOT NULL,
	`path` text NOT NULL,
	`status` text NOT NULL,
	`added` integer,
	`removed` integer,
	`written_by` text,
	CONSTRAINT `review_changed_after_pk` PRIMARY KEY(`building_id`, `repository`, `path`),
	CONSTRAINT `fk_review_changed_after_building_id_buildings_id_fk` FOREIGN KEY (`building_id`) REFERENCES `buildings`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `review_findings` (
	`id` text PRIMARY KEY,
	`pass_id` text NOT NULL,
	`building_id` text NOT NULL,
	`mission_id` text NOT NULL,
	`number` integer NOT NULL,
	`reviewer` text NOT NULL,
	`severity` text NOT NULL,
	`requirement` text,
	`scenario` text,
	`repository` text,
	`path` text,
	`line` integer,
	`text` text NOT NULL,
	`contradicts_spec` integer NOT NULL,
	`evidence` text,
	`fate` text,
	`need_id` text,
	`answer` text,
	`task_id` text,
	CONSTRAINT `fk_review_findings_pass_id_review_passes_id_fk` FOREIGN KEY (`pass_id`) REFERENCES `review_passes`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_review_findings_building_id_buildings_id_fk` FOREIGN KEY (`building_id`) REFERENCES `buildings`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `review_passes` (
	`id` text PRIMARY KEY,
	`mission_id` text NOT NULL,
	`building_id` text NOT NULL,
	`checkpoint_id` text NOT NULL,
	`reviewer` text NOT NULL,
	`lineage` text NOT NULL,
	`state` text NOT NULL,
	`reminded_session` text,
	`failure` text,
	`started_at` text NOT NULL,
	`ended_at` text,
	CONSTRAINT `fk_review_passes_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_review_passes_building_id_buildings_id_fk` FOREIGN KEY (`building_id`) REFERENCES `buildings`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `buildings` ADD `review_checkpoint_id` text;--> statement-breakpoint
ALTER TABLE `buildings` ADD `builder_turned_at` text;--> statement-breakpoint
CREATE INDEX `review_findings_of_building` ON `review_findings` (`building_id`,`number`);--> statement-breakpoint
CREATE INDEX `review_passes_of_building` ON `review_passes` (`building_id`,`reviewer`);--> statement-breakpoint
CREATE UNIQUE INDEX `review_pass_of_lineage` ON `review_passes` (`lineage`);