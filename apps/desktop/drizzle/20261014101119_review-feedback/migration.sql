CREATE TABLE `review_checkpoints` (
	`mission_id` text NOT NULL,
	`round` integer NOT NULL,
	`checkpoint_id` text NOT NULL,
	CONSTRAINT `review_checkpoints_pk` PRIMARY KEY(`mission_id`, `round`),
	CONSTRAINT `fk_review_checkpoints_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_review_checkpoints_checkpoint_id_checkpoints_id_fk` FOREIGN KEY (`checkpoint_id`) REFERENCES `checkpoints`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `review_feedback` (
	`id` text PRIMARY KEY,
	`mission_id` text NOT NULL,
	`round` integer NOT NULL,
	`author_kind` text NOT NULL,
	`author_login` text,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	`body` text NOT NULL,
	`version` integer NOT NULL,
	`anchor_kind` text,
	`anchor_repository` text,
	`anchor_path` text,
	`anchor_side` text,
	`anchor_start` integer,
	`anchor_end` integer,
	`anchor_tree` text,
	`anchor_fingerprint` text,
	`anchor_sha256` text,
	`anchor_size` integer,
	`anchor_withheld` text,
	`anchor_item` text,
	`follows_up` text,
	`source` text,
	`answer` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_review_feedback_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `review_feedback_images` (
	`feedback_id` text NOT NULL,
	`position` integer NOT NULL,
	`evidence_id` text NOT NULL,
	CONSTRAINT `review_feedback_images_pk` PRIMARY KEY(`feedback_id`, `position`),
	CONSTRAINT `fk_review_feedback_images_feedback_id_review_feedback_id_fk` FOREIGN KEY (`feedback_id`) REFERENCES `review_feedback`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_review_feedback_images_evidence_id_memory_evidence_id_fk` FOREIGN KEY (`evidence_id`) REFERENCES `memory_evidence`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `review_feedback_versions` (
	`feedback_id` text NOT NULL,
	`version` integer NOT NULL,
	`body` text NOT NULL,
	`written_at` text NOT NULL,
	CONSTRAINT `review_feedback_versions_pk` PRIMARY KEY(`feedback_id`, `version`),
	CONSTRAINT `fk_review_feedback_versions_feedback_id_review_feedback_id_fk` FOREIGN KEY (`feedback_id`) REFERENCES `review_feedback`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `review_rounds` (
	`mission_id` text NOT NULL,
	`number` integer NOT NULL,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	`moved_at` text NOT NULL,
	CONSTRAINT `review_rounds_pk` PRIMARY KEY(`mission_id`, `number`),
	CONSTRAINT `fk_review_rounds_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `review_feedback_of_mission` ON `review_feedback` (`mission_id`,`round`);--> statement-breakpoint
CREATE UNIQUE INDEX `review_feedback_source` ON `review_feedback` (`source`);