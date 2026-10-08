CREATE TABLE `answers` (
	`mission_id` text NOT NULL,
	`question_id` text NOT NULL,
	`version` integer NOT NULL,
	`option_id` text,
	`text` text,
	`author` text NOT NULL,
	`at` text NOT NULL,
	CONSTRAINT `answers_pk` PRIMARY KEY(`mission_id`, `question_id`, `version`),
	CONSTRAINT `fk_answers_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `planning_inputs` (
	`mission_id` text NOT NULL,
	`id` text NOT NULL,
	`number` integer NOT NULL,
	`kind` text NOT NULL,
	`item` text NOT NULL,
	`item_version` integer,
	`said` text NOT NULL,
	`state` text NOT NULL,
	`received_at` text NOT NULL,
	`delivery_id` text,
	`delivered_at` text,
	`integrated_at` text,
	`where` text,
	`superseded_by` text,
	CONSTRAINT `planning_inputs_pk` PRIMARY KEY(`mission_id`, `id`),
	CONSTRAINT `fk_planning_inputs_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `question_drafts` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT,
	`mission_id` text NOT NULL,
	`question_id` text NOT NULL,
	`text` text NOT NULL,
	`session_id` text NOT NULL,
	`at` text NOT NULL,
	CONSTRAINT `fk_question_drafts_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `questions` (
	`mission_id` text NOT NULL,
	`id` text NOT NULL,
	`number` integer NOT NULL,
	`wave` integer NOT NULL,
	`text` text NOT NULL,
	`why` text NOT NULL,
	`options` text NOT NULL,
	`recommended` text NOT NULL,
	`recommended_reason` text NOT NULL,
	`section` text,
	`from_finding` text,
	`replaces` text,
	`replaced_by` text,
	`state` text NOT NULL,
	`waiting_note` text,
	`retired_reason` text,
	`moot_decision` text,
	`asked_at` text NOT NULL,
	`changed_at` text NOT NULL,
	CONSTRAINT `questions_pk` PRIMARY KEY(`mission_id`, `id`),
	CONSTRAINT `fk_questions_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `waves` (
	`mission_id` text NOT NULL,
	`number` integer NOT NULL,
	`session_id` text NOT NULL,
	`asked_at` text NOT NULL,
	CONSTRAINT `waves_pk` PRIMARY KEY(`mission_id`, `number`),
	CONSTRAINT `fk_waves_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `planning_inputs_by_state` ON `planning_inputs` (`mission_id`,`state`);--> statement-breakpoint
CREATE INDEX `question_drafts_by_question` ON `question_drafts` (`mission_id`,`question_id`);--> statement-breakpoint
CREATE INDEX `questions_by_state` ON `questions` (`state`,`mission_id`);