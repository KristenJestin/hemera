ALTER TABLE `session_entries` ADD `kind` text DEFAULT 'message' NOT NULL;--> statement-breakpoint
ALTER TABLE `session_entries` ADD `payload` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `session_entries` ADD `correlation_id` text;--> statement-breakpoint
ALTER TABLE `session_entries` ADD `turn_id` text;--> statement-breakpoint
ALTER TABLE `session_entries` ADD `state` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `provider` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `model` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `native_session_id` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `native_state` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `cwd` text;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_session_entries` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`seq` integer NOT NULL,
	`role` text NOT NULL,
	`kind` text DEFAULT 'message' NOT NULL,
	`body` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`correlation_id` text,
	`turn_id` text,
	`state` text,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_session_entries_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `entry_once_in_session` UNIQUE(`session_id`,`seq`),
	CONSTRAINT "entry_role_is_known" CHECK("role" IN ('user', 'agent', 'hemera')),
	CONSTRAINT "entry_kind_is_known" CHECK("kind" IN ('message', 'thought', 'tool_call', 'diff', 'terminal', 'plan', 'permission_request', 'permission_decision', 'usage', 'turn', 'note'))
);
--> statement-breakpoint
INSERT INTO `__new_session_entries`(`id`, `session_id`, `seq`, `role`, `body`, `created_at`) SELECT `id`, `session_id`, `seq`, `role`, `body`, `created_at` FROM `session_entries`;--> statement-breakpoint
DROP TABLE `session_entries`;--> statement-breakpoint
ALTER TABLE `__new_session_entries` RENAME TO `session_entries`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sessions` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`title_source` text NOT NULL,
	`provider` text,
	`model` text,
	`native_session_id` text,
	`native_state` text DEFAULT 'none' NOT NULL,
	`cwd` text,
	`created_at` text NOT NULL,
	`last_written_at` text NOT NULL,
	`archived_at` text,
	`version` integer DEFAULT 1 NOT NULL,
	CONSTRAINT `fk_sessions_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT "session_title_source_is_known" CHECK("title_source" IN ('derived', 'user')),
	CONSTRAINT "session_provider_is_known" CHECK("provider" IS NULL OR "provider" IN ('claude', 'codex', 'opencode')),
	CONSTRAINT "session_native_state_is_known" CHECK("native_state" IN ('none', 'attached', 'lost', 'fallback'))
);
--> statement-breakpoint
INSERT INTO `__new_sessions`(`id`, `project_id`, `title`, `title_source`, `created_at`, `last_written_at`, `archived_at`, `version`) SELECT `id`, `project_id`, `title`, `title_source`, `created_at`, `last_written_at`, `archived_at`, `version` FROM `sessions`;--> statement-breakpoint
DROP TABLE `sessions`;--> statement-breakpoint
ALTER TABLE `__new_sessions` RENAME TO `sessions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `entry_by_correlation` ON `session_entries` (`session_id`,`correlation_id`);--> statement-breakpoint
CREATE INDEX `entry_by_turn` ON `session_entries` (`session_id`,`turn_id`);--> statement-breakpoint
CREATE INDEX `session_by_project` ON `sessions` (`project_id`,`last_written_at`);