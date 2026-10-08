CREATE TABLE `living_domains` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`rank` integer NOT NULL,
	`name` text NOT NULL,
	`summary` text NOT NULL,
	`uncertainty` text NOT NULL,
	`state` text NOT NULL,
	`validated_at` text,
	`removed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_living_domains_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `living_history` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT,
	`requirement_id` text NOT NULL,
	`what` text NOT NULL,
	`version_before` integer,
	`version_after` integer NOT NULL,
	`text_before` text,
	`text_after` text,
	`scenarios_before` text,
	`scenarios_after` text,
	`reason` text,
	`by_kind` text NOT NULL,
	`by_mission_id` text,
	`by_round` integer,
	`at` text NOT NULL,
	CONSTRAINT `fk_living_history_requirement_id_living_requirements_id_fk` FOREIGN KEY (`requirement_id`) REFERENCES `living_requirements`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `living_requirements` (
	`id` text PRIMARY KEY,
	`seq` integer NOT NULL UNIQUE,
	`project_id` text NOT NULL,
	`domain_id` text NOT NULL,
	`text` text NOT NULL,
	`scenarios` text NOT NULL,
	`origin_mission_id` text,
	`origin_round` integer,
	`state` text NOT NULL,
	`uncertainty` text NOT NULL,
	`version` integer NOT NULL,
	`removed` integer DEFAULT false NOT NULL,
	`pending_kind` text,
	`pending_version` integer,
	`pending_text` text,
	`pending_scenarios` text,
	`pending_uncertainty` text,
	`pending_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_living_requirements_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_living_requirements_domain_id_living_domains_id_fk` FOREIGN KEY (`domain_id`) REFERENCES `living_domains`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `living_runs` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`domain_id` text,
	`lineage` text NOT NULL UNIQUE,
	`state` text NOT NULL,
	`state_reason` text,
	`commits` text NOT NULL,
	`summary` text,
	`started_at` text NOT NULL,
	`ended_at` text,
	CONSTRAINT `fk_living_runs_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_living_runs_domain_id_living_domains_id_fk` FOREIGN KEY (`domain_id`) REFERENCES `living_domains`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
ALTER TABLE `missions` ADD `triage_based_on_proposed` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `living_domains_by_project` ON `living_domains` (`project_id`,`rank`);--> statement-breakpoint
CREATE INDEX `living_history_by_requirement` ON `living_history` (`requirement_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `living_requirements_by_domain` ON `living_requirements` (`domain_id`,`seq`);--> statement-breakpoint
CREATE INDEX `living_runs_by_project` ON `living_runs` (`project_id`,`started_at`);