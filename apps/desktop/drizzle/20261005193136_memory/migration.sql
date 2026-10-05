CREATE TABLE `memory_evidence` (
	`id` text PRIMARY KEY,
	`mission_id` text NOT NULL,
	`sha256` text NOT NULL,
	`size` integer NOT NULL,
	`media_type` text NOT NULL,
	`name` text NOT NULL,
	`about` text,
	`author_kind` text NOT NULL,
	`author_role` text,
	`author_session` text,
	`added_at` text NOT NULL,
	CONSTRAINT `fk_memory_evidence_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `memory_journal` (
	`sequence` integer PRIMARY KEY,
	`mission_id` text NOT NULL,
	`at` text NOT NULL,
	`kind` text NOT NULL,
	`author_kind` text NOT NULL,
	`author_role` text,
	`author_session` text,
	`text` text NOT NULL,
	`fields` text NOT NULL,
	`refs` text NOT NULL,
	CONSTRAINT `fk_memory_journal_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `memory_next` (
	`mission_id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`epoch` integer NOT NULL,
	`text` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_memory_next_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `memory_notes` (
	`id` text PRIMARY KEY,
	`mission_id` text NOT NULL,
	`number` integer NOT NULL,
	`text` text NOT NULL,
	`topic` text,
	`author_kind` text NOT NULL,
	`author_role` text,
	`author_session` text,
	`replaced_by` integer,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_memory_notes_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `note_number_once` UNIQUE(`mission_id`,`number`)
);
--> statement-breakpoint
CREATE TABLE `memory_now_lines` (
	`mission_id` text NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`epoch` integer NOT NULL,
	`doing` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_memory_now_lines_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `now_line_once` UNIQUE(`mission_id`,`session_id`)
);
--> statement-breakpoint
CREATE TABLE `projection_cursors` (
	`name` text PRIMARY KEY,
	`cursor` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `evidence_by_mission` ON `memory_evidence` (`mission_id`,`added_at`);--> statement-breakpoint
CREATE INDEX `journal_by_mission` ON `memory_journal` (`mission_id`,`sequence`);