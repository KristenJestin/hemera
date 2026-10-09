CREATE TABLE `ticket_writes` (
	`id` text PRIMARY KEY,
	`mission_id` text NOT NULL,
	`provider_id` text,
	`reference` text NOT NULL,
	`key` text NOT NULL,
	`spec_version` integer NOT NULL,
	`target` text NOT NULL,
	`text` text NOT NULL,
	`fingerprint` text NOT NULL,
	`state` text NOT NULL,
	`error` text,
	`events_seen` integer NOT NULL,
	`expected_version_id` text,
	`conflict_version_id` text,
	`need_id` text,
	`resolution` text,
	`retried` integer NOT NULL,
	`queued_at` text NOT NULL,
	`started_at` text,
	`ended_at` text,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_ticket_writes_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_ticket_writes_provider_id_ticket_providers_id_fk` FOREIGN KEY (`provider_id`) REFERENCES `ticket_providers`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_ticket_writes_expected_version_id_ticket_versions_id_fk` FOREIGN KEY (`expected_version_id`) REFERENCES `ticket_versions`(`id`),
	CONSTRAINT `fk_ticket_writes_conflict_version_id_ticket_versions_id_fk` FOREIGN KEY (`conflict_version_id`) REFERENCES `ticket_versions`(`id`)
);
--> statement-breakpoint
CREATE INDEX `ticket_writes_of_mission` ON `ticket_writes` (`mission_id`);