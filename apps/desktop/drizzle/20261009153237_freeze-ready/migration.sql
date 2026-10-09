CREATE TABLE `freeze_files` (
	`freeze_id` text NOT NULL,
	`repository` text NOT NULL,
	`path` text NOT NULL,
	`status` text NOT NULL,
	`sha256` text,
	`withheld` text,
	CONSTRAINT `freeze_files_pk` PRIMARY KEY(`freeze_id`, `repository`, `path`),
	CONSTRAINT `fk_freeze_files_freeze_id_freezes_id_fk` FOREIGN KEY (`freeze_id`) REFERENCES `freezes`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `freezes` (
	`id` text PRIMARY KEY,
	`mission_id` text NOT NULL,
	`cycle` integer NOT NULL,
	`spec_version` integer NOT NULL,
	`bases` text NOT NULL,
	`frozen_at` text NOT NULL,
	CONSTRAINT `fk_freezes_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `mission_dependencies` (
	`id` text PRIMARY KEY,
	`mission_id` text NOT NULL,
	`depends_on` text NOT NULL,
	`reason` text NOT NULL,
	`state` text NOT NULL,
	`proposed_at` text NOT NULL,
	`decided_at` text,
	`done_at` text,
	CONSTRAINT `fk_mission_dependencies_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_mission_dependencies_depends_on_missions_id_fk` FOREIGN KEY (`depends_on`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `snapshot_contents` (
	`sha256` text PRIMARY KEY,
	`content` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `spec_relies_on` (
	`mission_id` text NOT NULL,
	`requirement_id` text NOT NULL,
	`depends_on` text NOT NULL,
	`their_requirement` text NOT NULL,
	`their_version` integer NOT NULL,
	CONSTRAINT `spec_relies_on_pk` PRIMARY KEY(`mission_id`, `requirement_id`, `depends_on`, `their_requirement`),
	CONSTRAINT `fk_spec_relies_on_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_spec_relies_on_depends_on_missions_id_fk` FOREIGN KEY (`depends_on`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `freeze_once_per_cycle` ON `freezes` (`mission_id`,`cycle`);--> statement-breakpoint
CREATE UNIQUE INDEX `dependency_once` ON `mission_dependencies` (`mission_id`,`depends_on`);--> statement-breakpoint
CREATE INDEX `dependencies_on_mission` ON `mission_dependencies` (`depends_on`);