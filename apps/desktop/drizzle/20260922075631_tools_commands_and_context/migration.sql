CREATE TABLE `command_runs` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`command_id` text,
	`name` text NOT NULL,
	`line` text NOT NULL,
	`kind` text NOT NULL,
	`cwd` text NOT NULL,
	`state` text NOT NULL,
	`pid` integer,
	`url` text,
	`exit_code` integer,
	`output` text DEFAULT '' NOT NULL,
	`output_bytes` integer DEFAULT 0 NOT NULL,
	`truncated` integer DEFAULT 0 NOT NULL,
	`started_by` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	CONSTRAINT `fk_command_runs_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_command_runs_command_id_project_commands_id_fk` FOREIGN KEY (`command_id`) REFERENCES `project_commands`(`id`) ON DELETE SET NULL,
	CONSTRAINT "run_state_is_known" CHECK("state" IN ('running', 'exited', 'failed', 'stopped')),
	CONSTRAINT "run_starter_is_known" CHECK("started_by" IN ('agent', 'user'))
);
--> statement-breakpoint
CREATE TABLE `context_deliveries` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`kind` text NOT NULL,
	`path` text NOT NULL,
	`fingerprint` text NOT NULL,
	`delivered_at` text NOT NULL,
	CONSTRAINT `fk_context_deliveries_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE,
	CONSTRAINT "delivery_kind_is_known" CHECK("kind" IN ('base', 'native', 'provided', 'instructions'))
);
--> statement-breakpoint
CREATE TABLE `project_commands` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`line` text NOT NULL,
	`kind` text NOT NULL,
	`folder` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_project_commands_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `command_name_in_project` UNIQUE(`project_id`,`name`),
	CONSTRAINT "command_kind_is_known" CHECK("kind" IN ('app', 'check', 'utility'))
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_session_entries` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`seq` integer NOT NULL,
	`role` text NOT NULL,
	`kind` text DEFAULT 'message' NOT NULL,
	`body` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`origin` text DEFAULT 'live' NOT NULL,
	`correlation_id` text,
	`turn_id` text,
	`state` text,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_session_entries_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `entry_once_in_session` UNIQUE(`session_id`,`seq`),
	CONSTRAINT "entry_role_is_known" CHECK("role" IN ('user', 'agent', 'hemera')),
	CONSTRAINT "entry_kind_is_known" CHECK("kind" IN ('message', 'thought', 'tool_call', 'diff', 'terminal', 'plan', 'permission_request', 'permission_decision', 'usage', 'turn', 'note', 'hemera_tool_call', 'command_run', 'context_delivery')),
	CONSTRAINT "entry_origin_is_known" CHECK("origin" IN ('live', 'replay'))
);
--> statement-breakpoint
INSERT INTO `__new_session_entries`(`id`, `session_id`, `seq`, `role`, `kind`, `body`, `payload`, `origin`, `correlation_id`, `turn_id`, `state`, `created_at`) SELECT `id`, `session_id`, `seq`, `role`, `kind`, `body`, `payload`, `origin`, `correlation_id`, `turn_id`, `state`, `created_at` FROM `session_entries`;--> statement-breakpoint
DROP TABLE `session_entries`;--> statement-breakpoint
ALTER TABLE `__new_session_entries` RENAME TO `session_entries`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `entry_by_correlation` ON `session_entries` (`session_id`,`correlation_id`);--> statement-breakpoint
CREATE INDEX `entry_by_turn` ON `session_entries` (`session_id`,`turn_id`);--> statement-breakpoint
CREATE INDEX `run_by_session` ON `command_runs` (`session_id`,`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `delivery_once_per_change` ON `context_deliveries` (`session_id`,`kind`,`path`,`fingerprint`) WHERE "context_deliveries"."kind" <> 'instructions';