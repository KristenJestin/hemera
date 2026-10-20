PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_buildings` (
	`id` text PRIMARY KEY,
	`mission_id` text NOT NULL,
	`label` text NOT NULL,
	`round` integer,
	`workspace_id` text,
	`bases` text NOT NULL,
	`phase` text NOT NULL,
	`state` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`tasks_done_at` text,
	`end_called_at` text,
	`summary` text,
	`review_checkpoint_id` text,
	`builder_turned_at` text,
	CONSTRAINT `fk_buildings_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_buildings_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_buildings_review_checkpoint_id_checkpoints_id_fk` FOREIGN KEY (`review_checkpoint_id`) REFERENCES `checkpoints`(`id`)
);
--> statement-breakpoint
INSERT INTO `__new_buildings`(`id`, `mission_id`, `label`, `round`, `workspace_id`, `bases`, `phase`, `state`, `started_at`, `ended_at`, `tasks_done_at`, `end_called_at`, `summary`, `review_checkpoint_id`, `builder_turned_at`) SELECT `id`, `mission_id`, `label`, `round`, `workspace_id`, `bases`, `phase`, `state`, `started_at`, `ended_at`, `tasks_done_at`, `end_called_at`, `summary`, `review_checkpoint_id`, `builder_turned_at` FROM `buildings`;--> statement-breakpoint
DROP TABLE `buildings`;--> statement-breakpoint
ALTER TABLE `__new_buildings` RENAME TO `buildings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_review_passes` (
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
	CONSTRAINT `fk_review_passes_building_id_buildings_id_fk` FOREIGN KEY (`building_id`) REFERENCES `buildings`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_review_passes_checkpoint_id_checkpoints_id_fk` FOREIGN KEY (`checkpoint_id`) REFERENCES `checkpoints`(`id`)
);
--> statement-breakpoint
INSERT INTO `__new_review_passes`(`id`, `mission_id`, `building_id`, `checkpoint_id`, `reviewer`, `lineage`, `state`, `reminded_session`, `failure`, `started_at`, `ended_at`) SELECT `id`, `mission_id`, `building_id`, `checkpoint_id`, `reviewer`, `lineage`, `state`, `reminded_session`, `failure`, `started_at`, `ended_at` FROM `review_passes`;--> statement-breakpoint
DROP TABLE `review_passes`;--> statement-breakpoint
ALTER TABLE `__new_review_passes` RENAME TO `review_passes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `building_active_of_mission` ON `buildings` (`mission_id`) WHERE "buildings"."state" = 'active';--> statement-breakpoint
CREATE INDEX `review_passes_of_building` ON `review_passes` (`building_id`,`reviewer`);--> statement-breakpoint
CREATE UNIQUE INDEX `review_pass_of_lineage` ON `review_passes` (`lineage`);