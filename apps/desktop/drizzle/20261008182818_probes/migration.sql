CREATE TABLE `probe_contents` (
	`sha256` text PRIMARY KEY,
	`content` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `probe_files` (
	`probe_id` text NOT NULL,
	`repository` text NOT NULL,
	`path` text NOT NULL,
	`status` text NOT NULL,
	`sha256` text NOT NULL,
	`patch` text,
	`withheld` text,
	CONSTRAINT `probe_files_pk` PRIMARY KEY(`probe_id`, `repository`, `path`),
	CONSTRAINT `fk_probe_files_probe_id_probes_id_fk` FOREIGN KEY (`probe_id`) REFERENCES `probes`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `probes` (
	`id` text PRIMARY KEY,
	`mission_id` text NOT NULL,
	`number` integer NOT NULL,
	`scenario` text,
	`question` text NOT NULL,
	`brief` text NOT NULL,
	`state` text NOT NULL,
	`stuck` integer NOT NULL,
	`folder` text NOT NULL,
	`workspace_id` text,
	`bases` text,
	`lineage` text NOT NULL,
	`parent_lineage` text NOT NULL,
	`reminded` integer NOT NULL,
	`outcome` text,
	`answer` text,
	`report` text,
	`failure` text,
	`started_at` text NOT NULL,
	`ended_at` text,
	`wipe_attempts` integer NOT NULL,
	`wipe_error` text,
	CONSTRAINT `fk_probes_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_probes_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE SET NULL,
	CONSTRAINT `probe_number_in_mission` UNIQUE(`mission_id`,`number`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `probe_of_lineage` ON `probes` (`lineage`);