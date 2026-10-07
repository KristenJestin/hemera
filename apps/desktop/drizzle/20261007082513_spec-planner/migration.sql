CREATE TABLE `spec_changes` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT,
	`mission_id` text NOT NULL,
	`version` integer NOT NULL,
	`item` text NOT NULL,
	`before` text,
	`after` text,
	`session_id` text NOT NULL,
	`at` text NOT NULL,
	CONSTRAINT `fk_spec_changes_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `spec_reads` (
	`mission_id` text PRIMARY KEY,
	`version` integer NOT NULL,
	`read_at` text NOT NULL,
	CONSTRAINT `fk_spec_reads_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `spec_requirements` (
	`mission_id` text NOT NULL,
	`id` text NOT NULL,
	`rank` integer NOT NULL,
	`domain` text NOT NULL,
	`delta` text NOT NULL,
	`living_ref` text,
	`living_version` integer,
	`text` text NOT NULL,
	`version` integer NOT NULL,
	`removed` integer DEFAULT false NOT NULL,
	`next_scenario` integer DEFAULT 1 NOT NULL,
	`session_id` text NOT NULL,
	`written_at` text NOT NULL,
	CONSTRAINT `spec_requirements_pk` PRIMARY KEY(`mission_id`, `id`),
	CONSTRAINT `fk_spec_requirements_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `spec_scenarios` (
	`mission_id` text NOT NULL,
	`requirement_id` text NOT NULL,
	`id` text NOT NULL,
	`when_text` text NOT NULL,
	`then_text` text NOT NULL,
	`rank` integer NOT NULL,
	`version` integer NOT NULL,
	`removed` integer DEFAULT false NOT NULL,
	CONSTRAINT `spec_scenarios_pk` PRIMARY KEY(`mission_id`, `id`),
	CONSTRAINT `fk_spec_scenarios_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `spec_sections` (
	`mission_id` text NOT NULL,
	`name` text NOT NULL,
	`body` text NOT NULL,
	`version` integer NOT NULL,
	`session_id` text NOT NULL,
	`written_at` text NOT NULL,
	CONSTRAINT `spec_sections_pk` PRIMARY KEY(`mission_id`, `name`),
	CONSTRAINT `fk_spec_sections_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `spec_visions` (
	`id` text PRIMARY KEY,
	`mission_id` text NOT NULL,
	`text` text NOT NULL,
	`at` text NOT NULL,
	CONSTRAINT `fk_spec_visions_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `specs` (
	`mission_id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`language` text NOT NULL,
	`declared_complete_version` integer,
	`frozen` integer DEFAULT false NOT NULL,
	`frozen_at` text,
	`next_requirement` integer DEFAULT 1 NOT NULL,
	`described_at` text,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_specs_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `missions` ADD `triage_kind` text;--> statement-breakpoint
ALTER TABLE `missions` ADD `triage_ref` text;--> statement-breakpoint
ALTER TABLE `missions` ADD `triage_text` text;--> statement-breakpoint
ALTER TABLE `missions` ADD `triage_state` text;--> statement-breakpoint
ALTER TABLE `missions` ADD `triaged_at` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `spec_language` text DEFAULT 'en' NOT NULL;--> statement-breakpoint
CREATE INDEX `spec_changes_by_mission` ON `spec_changes` (`mission_id`,`version`);--> statement-breakpoint
CREATE INDEX `spec_visions_by_mission` ON `spec_visions` (`mission_id`,`at`);