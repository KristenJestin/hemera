CREATE TABLE `mission_tickets` (
	`mission_id` text PRIMARY KEY,
	`provider_id` text,
	`mode` text NOT NULL,
	`base_version_id` text,
	`last_version_id` text,
	`linked_at` text NOT NULL,
	CONSTRAINT `fk_mission_tickets_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_mission_tickets_provider_id_ticket_providers_id_fk` FOREIGN KEY (`provider_id`) REFERENCES `ticket_providers`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_mission_tickets_base_version_id_ticket_versions_id_fk` FOREIGN KEY (`base_version_id`) REFERENCES `ticket_versions`(`id`),
	CONSTRAINT `fk_mission_tickets_last_version_id_ticket_versions_id_fk` FOREIGN KEY (`last_version_id`) REFERENCES `ticket_versions`(`id`)
);
--> statement-breakpoint
CREATE TABLE `ticket_providers` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`configuration` text NOT NULL,
	`unreachable_since` text,
	`limited_until` text,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_ticket_providers_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `ticket_versions` (
	`id` text PRIMARY KEY,
	`mission_id` text NOT NULL,
	`provider_id` text,
	`provider` text NOT NULL,
	`reference` text NOT NULL,
	`key` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`state` text NOT NULL,
	`wording` text NOT NULL,
	`author` text,
	`labels` text NOT NULL,
	`comments` text NOT NULL,
	`updated_at` text NOT NULL,
	`read_at` text NOT NULL,
	`fingerprint` text NOT NULL,
	CONSTRAINT `fk_ticket_versions_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_ticket_versions_provider_id_ticket_providers_id_fk` FOREIGN KEY (`provider_id`) REFERENCES `ticket_providers`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
ALTER TABLE `projects` ADD `spec_mode` text DEFAULT 'local' NOT NULL;--> statement-breakpoint
CREATE INDEX `ticket_providers_by_project` ON `ticket_providers` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ticket_versions_by_reference` ON `ticket_versions` (`reference`,`read_at`);--> statement-breakpoint
CREATE INDEX `ticket_versions_by_mission` ON `ticket_versions` (`mission_id`);