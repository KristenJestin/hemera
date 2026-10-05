CREATE TABLE `mission_grants` (
	`id` text PRIMARY KEY,
	`mission_id` text NOT NULL,
	`key` text NOT NULL,
	`identity` text NOT NULL,
	`action` text NOT NULL,
	`given_by` text NOT NULL,
	`given_at` text NOT NULL,
	`uses` integer NOT NULL,
	`state` text NOT NULL,
	`ended_reason` text,
	`ended_at` text,
	CONSTRAINT `fk_mission_grants_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `permission_requests` (
	`id` text PRIMARY KEY,
	`owner_kind` text NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text NOT NULL,
	`mission_id` text,
	`task_id` text,
	`number` integer NOT NULL,
	`call_key` text,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`tool` text NOT NULL,
	`call` text NOT NULL,
	`guard` text NOT NULL,
	`identity` text NOT NULL,
	`described` text NOT NULL,
	`hemera_reason` text NOT NULL,
	`agent_reason` text NOT NULL,
	`sensitive` integer NOT NULL,
	`need_id` text NOT NULL,
	`state` text NOT NULL,
	`choice` text,
	`grant_id` text,
	`result` text,
	`result_text` text,
	`created_at` text NOT NULL,
	`answered_at` text,
	`ended_at` text,
	`handed_over_at` text,
	CONSTRAINT `fk_permission_requests_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_permission_requests_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `request_number_once` UNIQUE(`owner_kind`,`owner_id`,`number`),
	CONSTRAINT `request_key_once` UNIQUE(`owner_kind`,`owner_id`,`call_key`)
);
--> statement-breakpoint
CREATE TABLE `queued_deliveries` (
	`request_id` text PRIMARY KEY,
	`owner_kind` text NOT NULL,
	`owner_id` text NOT NULL,
	`task_id` text,
	`number` integer NOT NULL,
	`text` text NOT NULL,
	`queued_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `grants_by_mission` ON `mission_grants` (`mission_id`,`key`,`state`);--> statement-breakpoint
CREATE INDEX `requests_by_state` ON `permission_requests` (`state`);--> statement-breakpoint
CREATE INDEX `requests_by_need` ON `permission_requests` (`need_id`);--> statement-breakpoint
CREATE INDEX `queued_by_owner` ON `queued_deliveries` (`owner_kind`,`owner_id`,`queued_at`);