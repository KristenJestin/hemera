CREATE TABLE `building_activity` (
	`building_id` text NOT NULL,
	`started_at` text NOT NULL,
	`seen_at` text NOT NULL,
	CONSTRAINT `building_activity_pk` PRIMARY KEY(`building_id`, `started_at`),
	CONSTRAINT `fk_building_activity_building_id_buildings_id_fk` FOREIGN KEY (`building_id`) REFERENCES `buildings`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `building_attempts` (
	`id` text PRIMARY KEY,
	`building_id` text NOT NULL,
	`task_id` text,
	`number` integer NOT NULL,
	`runner` text NOT NULL,
	`epoch` integer NOT NULL,
	`starts` text NOT NULL,
	`ends` text,
	`started_at` text NOT NULL,
	`ended_at` text,
	`outcome` text,
	`summary` text,
	`outside` text NOT NULL,
	CONSTRAINT `fk_building_attempts_building_id_buildings_id_fk` FOREIGN KEY (`building_id`) REFERENCES `buildings`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `building_claims` (
	`building_id` text NOT NULL,
	`task_id` text NOT NULL,
	`repository` text NOT NULL,
	`path` text NOT NULL,
	`runner` text NOT NULL,
	CONSTRAINT `building_claims_pk` PRIMARY KEY(`building_id`, `repository`, `path`),
	CONSTRAINT `fk_building_claims_building_id_buildings_id_fk` FOREIGN KEY (`building_id`) REFERENCES `buildings`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `building_decisions` (
	`id` text PRIMARY KEY,
	`building_id` text NOT NULL,
	`need_id` text NOT NULL,
	`kind` text NOT NULL,
	`tasks` text NOT NULL,
	`question` text NOT NULL,
	`options` text NOT NULL,
	`recommended` text,
	`amendment` text,
	`state` text NOT NULL,
	`answer` text,
	`applied` integer DEFAULT false NOT NULL,
	`requested_by` text NOT NULL,
	`requested_at` text NOT NULL,
	`answered_at` text,
	CONSTRAINT `fk_building_decisions_building_id_buildings_id_fk` FOREIGN KEY (`building_id`) REFERENCES `buildings`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `building_tasks` (
	`building_id` text NOT NULL,
	`id` text NOT NULL,
	`rank` integer NOT NULL,
	`origin` text NOT NULL,
	`decision_id` text,
	`title` text NOT NULL,
	`result` text NOT NULL,
	`requirements` text NOT NULL,
	`scenarios` text NOT NULL,
	`targets` text NOT NULL,
	`depends_on` text NOT NULL,
	`state` text NOT NULL,
	`verified` integer,
	`runner` text,
	`epoch` integer,
	`blocked_by` text,
	`skipped_reason` text,
	`replaced_by` text NOT NULL,
	`held_back` text,
	`changes` text NOT NULL,
	CONSTRAINT `building_tasks_pk` PRIMARY KEY(`building_id`, `id`),
	CONSTRAINT `fk_building_tasks_building_id_buildings_id_fk` FOREIGN KEY (`building_id`) REFERENCES `buildings`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `buildings` (
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
	`summary` text,
	CONSTRAINT `fk_buildings_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_buildings_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `building_attempts_of_task` ON `building_attempts` (`building_id`,`task_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `building_decision_of_need` ON `building_decisions` (`need_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `building_active_of_mission` ON `buildings` (`mission_id`) WHERE "buildings"."state" = 'active';