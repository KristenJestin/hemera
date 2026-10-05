CREATE TABLE `effectful_actions` (
	`id` text PRIMARY KEY,
	`kind` text NOT NULL,
	`owner_kind` text NOT NULL,
	`owner_id` text NOT NULL,
	`task_id` text,
	`details` text NOT NULL,
	`state` text NOT NULL,
	`outcome` text,
	`started_at` text NOT NULL,
	`ended_at` text,
	`handled_at` text
);
--> statement-breakpoint
CREATE TABLE `session_files` (
	`session_id` text NOT NULL,
	`path` text NOT NULL,
	`fingerprint` text NOT NULL,
	`recorded_at` text NOT NULL,
	CONSTRAINT `file_once_in_session` UNIQUE(`session_id`,`path`)
);
--> statement-breakpoint
CREATE TABLE `tool_calls` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`project_id` text,
	`mission_id` text,
	`tool` text NOT NULL,
	`gate_class` text,
	`verdict` text,
	`verdict_by` text,
	`outcome` text NOT NULL,
	`reason` text,
	`call_key` text,
	`duration_ms` integer NOT NULL,
	`called_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `actions_by_state` ON `effectful_actions` (`state`,`started_at`);--> statement-breakpoint
CREATE INDEX `calls_by_session` ON `tool_calls` (`session_id`,`called_at`);