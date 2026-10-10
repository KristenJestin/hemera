CREATE TABLE `checkpoint_files` (
	`checkpoint_id` text NOT NULL,
	`repository` text NOT NULL,
	`position` integer NOT NULL,
	`path` text NOT NULL,
	`old_path` text,
	`status` text NOT NULL,
	`added` integer,
	`removed` integer,
	`untracked` integer NOT NULL,
	`before_sha256` text,
	`before_size` integer,
	`before_withheld` text,
	`after_sha256` text,
	`after_size` integer,
	`after_withheld` text,
	CONSTRAINT `checkpoint_files_pk` PRIMARY KEY(`checkpoint_id`, `repository`, `path`),
	CONSTRAINT `fk_checkpoint_files_checkpoint_id_checkpoints_id_fk` FOREIGN KEY (`checkpoint_id`) REFERENCES `checkpoints`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `checkpoint_repositories` (
	`checkpoint_id` text NOT NULL,
	`repository` text NOT NULL,
	`position` integer NOT NULL,
	`head` text,
	`tree` text NOT NULL,
	`base` text,
	`merge_base` text,
	CONSTRAINT `checkpoint_repositories_pk` PRIMARY KEY(`checkpoint_id`, `repository`),
	CONSTRAINT `fk_checkpoint_repositories_checkpoint_id_checkpoints_id_fk` FOREIGN KEY (`checkpoint_id`) REFERENCES `checkpoints`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `checkpoints` (
	`id` text PRIMARY KEY,
	`mission_id` text NOT NULL,
	`kind` text NOT NULL,
	`taken_at` text NOT NULL,
	CONSTRAINT `fk_checkpoints_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `file_contents` (
	`sha256` text PRIMARY KEY,
	`bytes` blob NOT NULL,
	`size` integer NOT NULL,
	`masked` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `snapshot_changes` (
	`mission_id` text NOT NULL,
	`repository` text NOT NULL,
	`from_tree` text NOT NULL,
	`to_tree` text NOT NULL,
	`position` integer NOT NULL,
	`path` text NOT NULL,
	`old_path` text,
	`status` text NOT NULL,
	`added` integer,
	`removed` integer,
	CONSTRAINT `snapshot_changes_pk` PRIMARY KEY(`mission_id`, `repository`, `from_tree`, `to_tree`, `path`),
	CONSTRAINT `fk_snapshot_changes_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `snapshot_files` (
	`mission_id` text NOT NULL,
	`repository` text NOT NULL,
	`tree` text NOT NULL,
	`path` text NOT NULL,
	`sha256` text NOT NULL,
	`size` integer NOT NULL,
	`withheld` text,
	CONSTRAINT `snapshot_files_pk` PRIMARY KEY(`mission_id`, `repository`, `tree`, `path`),
	CONSTRAINT `fk_snapshot_files_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `checkpoints_of_mission` ON `checkpoints` (`mission_id`);