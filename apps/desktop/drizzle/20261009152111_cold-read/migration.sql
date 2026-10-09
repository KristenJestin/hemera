CREATE TABLE `cold_read_findings` (
	`mission_id` text NOT NULL,
	`id` text NOT NULL,
	`cold_read_id` text NOT NULL,
	`number` integer NOT NULL,
	`severity` text NOT NULL,
	`where` text NOT NULL,
	`text` text NOT NULL,
	`question` text,
	`tasks_only` integer NOT NULL,
	`fate` text NOT NULL,
	`question_id` text,
	`fixed_what` text,
	`input_id` text,
	`changed_at` text NOT NULL,
	CONSTRAINT `cold_read_findings_pk` PRIMARY KEY(`mission_id`, `id`),
	CONSTRAINT `fk_cold_read_findings_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_cold_read_findings_cold_read_id_cold_reads_id_fk` FOREIGN KEY (`cold_read_id`) REFERENCES `cold_reads`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `cold_reads` (
	`id` text PRIMARY KEY,
	`mission_id` text NOT NULL,
	`number` integer NOT NULL,
	`cycle` integer NOT NULL,
	`spec_version` integer NOT NULL,
	`snapshot` text NOT NULL,
	`requested_by` text NOT NULL,
	`state` text NOT NULL,
	`stuck` integer NOT NULL,
	`lineage` text NOT NULL,
	`reminded` integer NOT NULL,
	`failure` text,
	`delivery_id` text,
	`asked_at` text NOT NULL,
	`started_at` text,
	`ended_at` text,
	CONSTRAINT `fk_cold_reads_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `cold_read_number_in_mission` UNIQUE(`mission_id`,`number`)
);
--> statement-breakpoint
ALTER TABLE `missions` ADD `planning_cycle` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX `cold_read_findings_of_pass` ON `cold_read_findings` (`cold_read_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `cold_read_of_lineage` ON `cold_reads` (`lineage`);