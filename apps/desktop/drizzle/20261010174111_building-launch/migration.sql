CREATE TABLE `building_launches` (
	`id` text PRIMARY KEY,
	`mission_id` text NOT NULL,
	`check_id` text NOT NULL,
	`choice` text NOT NULL,
	`state` text NOT NULL,
	`workspace_id` text,
	`branch` text,
	`setting` text NOT NULL,
	`settings` text NOT NULL,
	`need_id` text,
	`created_at` text NOT NULL,
	`launched_at` text,
	`started_at` text,
	CONSTRAINT `fk_building_launches_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_building_launches_check_id_prelaunch_checks_id_fk` FOREIGN KEY (`check_id`) REFERENCES `prelaunch_checks`(`id`),
	CONSTRAINT `fk_building_launches_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `mission_validation_settings` (
	`mission_id` text NOT NULL,
	`version` integer NOT NULL,
	`taken_at` text NOT NULL,
	`sections` text NOT NULL,
	CONSTRAINT `mission_validation_settings_pk` PRIMARY KEY(`mission_id`, `version`),
	CONSTRAINT `fk_mission_validation_settings_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `prelaunch_checks` (
	`id` text PRIMARY KEY,
	`mission_id` text NOT NULL,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	`read` text NOT NULL,
	`results` text NOT NULL,
	`agent_state` text NOT NULL,
	`lineage` text,
	`reminded` integer NOT NULL,
	`summary` text,
	`started_at` text NOT NULL,
	`ended_at` text,
	CONSTRAINT `fk_prelaunch_checks_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `building_launch_under_way` ON `building_launches` (`mission_id`) WHERE "building_launches"."state" in ('preparing', 'failed');--> statement-breakpoint
CREATE INDEX `building_launches_of_mission` ON `building_launches` (`mission_id`);--> statement-breakpoint
CREATE INDEX `prelaunch_checks_of_mission` ON `prelaunch_checks` (`mission_id`,`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `prelaunch_check_of_lineage` ON `prelaunch_checks` (`lineage`);