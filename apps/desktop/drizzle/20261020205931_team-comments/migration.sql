CREATE TABLE `team_comment_pushes` (
	`mission_id` text NOT NULL,
	`repository` text NOT NULL,
	`commit` text NOT NULL,
	`tree` text NOT NULL,
	CONSTRAINT `team_comment_pushes_pk` PRIMARY KEY(`mission_id`, `repository`, `commit`),
	CONSTRAINT `fk_team_comment_pushes_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `team_comment_runs` (
	`id` text PRIMARY KEY,
	`mission_id` text NOT NULL,
	`lineage` text NOT NULL,
	`state` text NOT NULL,
	`reminded` integer NOT NULL,
	`failure` text,
	`asked_at` text NOT NULL,
	`started_at` text,
	`ended_at` text,
	CONSTRAINT `fk_team_comment_runs_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `team_comment_versions` (
	`comment_id` text NOT NULL,
	`version` integer NOT NULL,
	`body` text NOT NULL,
	`written_at` text NOT NULL,
	CONSTRAINT `team_comment_versions_pk` PRIMARY KEY(`comment_id`, `version`),
	CONSTRAINT `fk_team_comment_versions_comment_id_team_comments_id_fk` FOREIGN KEY (`comment_id`) REFERENCES `team_comments`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `team_comments` (
	`id` text PRIMARY KEY,
	`mission_id` text NOT NULL,
	`repository_id` text NOT NULL,
	`repository` text NOT NULL,
	`forge` text NOT NULL,
	`host` text NOT NULL,
	`slug` text NOT NULL,
	`number` integer NOT NULL,
	`comment_id` text NOT NULL,
	`kind` text NOT NULL,
	`review` text,
	`thread` text,
	`author` text NOT NULL,
	`author_id` text,
	`mine` integer NOT NULL,
	`body` text NOT NULL,
	`version` integer NOT NULL,
	`revision` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`url` text,
	`anchor_path` text,
	`anchor_side` text,
	`anchor_start` integer,
	`anchor_end` integer,
	`anchor_commit` text,
	`anchor_tree` text,
	`anchor_fingerprint` text,
	`anchor_sha256` text,
	`anchor_size` integer,
	`anchor_withheld` text,
	`forge_resolved` integer NOT NULL,
	`removed_on_forge` integer NOT NULL,
	`state` text NOT NULL,
	`arrived_in` text NOT NULL,
	`reading` text,
	`reply` text,
	`my_take` text,
	`feedback_id` text,
	`integrated_version` integer,
	`run_id` text,
	`received_at` text NOT NULL,
	CONSTRAINT `fk_team_comments_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_comment_run_of_lineage` ON `team_comment_runs` (`lineage`);--> statement-breakpoint
CREATE UNIQUE INDEX `team_comment_identity` ON `team_comments` (`mission_id`,`forge`,`host`,`slug`,`number`,`comment_id`);--> statement-breakpoint
CREATE INDEX `team_comments_of_run` ON `team_comments` (`run_id`);