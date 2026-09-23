CREATE TABLE `environment_variables` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`workspace_id` text,
	`key` text NOT NULL,
	`value` text NOT NULL,
	CONSTRAINT `fk_environment_variables_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_environment_variables_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `project_preparation_steps` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`path` text,
	`scope` text DEFAULT 'root' NOT NULL,
	`command_id` text,
	`rank` text NOT NULL,
	CONSTRAINT `fk_project_preparation_steps_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_project_preparation_steps_command_id_project_commands_id_fk` FOREIGN KEY (`command_id`) REFERENCES `project_commands`(`id`) ON DELETE SET NULL,
	CONSTRAINT "recipe_kind_is_known" CHECK("kind" IN ('copy', 'link', 'run')),
	CONSTRAINT "recipe_scope_is_known" CHECK("scope" IN ('root', 'repositories'))
);
--> statement-breakpoint
CREATE TABLE `workspace_repositories` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`relative_path` text NOT NULL,
	`branch` text NOT NULL,
	`base` text NOT NULL,
	CONSTRAINT `fk_workspace_repositories_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE,
	CONSTRAINT `worktree_once_in_workspace` UNIQUE(`workspace_id`,`relative_path`)
);
--> statement-breakpoint
CREATE TABLE `workspace_steps` (
	`id` text PRIMARY KEY,
	`workspace_id` text NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`target` text NOT NULL,
	`scope` text,
	`command_id` text,
	`state` text NOT NULL,
	`message` text,
	`run_id` text,
	CONSTRAINT `fk_workspace_steps_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_workspace_steps_command_id_project_commands_id_fk` FOREIGN KEY (`command_id`) REFERENCES `project_commands`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_workspace_steps_run_id_command_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `command_runs`(`id`) ON DELETE SET NULL,
	CONSTRAINT `step_once_in_workspace` UNIQUE(`workspace_id`,`position`),
	CONSTRAINT "step_kind_is_known" CHECK("kind" IN ('worktree', 'copy', 'link', 'run')),
	CONSTRAINT "step_scope_is_known" CHECK("scope" IS NULL OR "scope" IN ('root', 'repositories')),
	CONSTRAINT "step_state_is_known" CHECK("state" IN ('pending', 'running', 'done', 'failed', 'skipped'))
);
--> statement-breakpoint
ALTER TABLE `command_runs` RENAME COLUMN `kind` TO `type`;--> statement-breakpoint
UPDATE `command_runs` SET `type` = CASE `type` WHEN 'app' THEN 'serve' WHEN 'check' THEN 'test' WHEN 'utility' THEN 'script' ELSE `type` END;--> statement-breakpoint
ALTER TABLE `project_commands` RENAME COLUMN `kind` TO `type`;--> statement-breakpoint
ALTER TABLE `command_runs` ADD `workspace_id` text REFERENCES workspaces(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `command_runs` ADD `environment` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `command_runs` ADD `ready_at` text;--> statement-breakpoint
ALTER TABLE `command_runs` ADD `port_conflict` text;--> statement-breakpoint
ALTER TABLE `project_commands` ADD `line_windows` text;--> statement-breakpoint
ALTER TABLE `project_commands` ADD `line_linux` text;--> statement-breakpoint
ALTER TABLE `project_commands` ADD `scope` text DEFAULT 'workspace' NOT NULL;--> statement-breakpoint
ALTER TABLE `project_commands` ADD `portless` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `project_repositories` ADD `included_by_default` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `workspaces_root` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `branch_prefix` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `workspace_id` text REFERENCES workspaces(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `spec_id` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `state` text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `cleaned_at` text;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_project_commands` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`line` text NOT NULL,
	`type` text NOT NULL,
	`folder` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`line_windows` text,
	`line_linux` text,
	`scope` text DEFAULT 'workspace' NOT NULL,
	`portless` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `fk_project_commands_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `command_name_in_project` UNIQUE(`project_id`,`name`),
	CONSTRAINT "command_type_is_known" CHECK("type" IN ('serve', 'test', 'lint', 'build', 'configure', 'debug', 'script')),
	CONSTRAINT "command_scope_is_known" CHECK("scope" IN ('workspace', 'project'))
);
--> statement-breakpoint
INSERT INTO `__new_project_commands`(`id`, `project_id`, `name`, `line`, `type`, `folder`, `created_at`, `updated_at`) SELECT `id`, `project_id`, `name`, `line`, CASE `type` WHEN 'app' THEN 'serve' WHEN 'check' THEN 'test' WHEN 'utility' THEN 'script' ELSE `type` END, `folder`, `created_at`, `updated_at` FROM `project_commands`;--> statement-breakpoint
DROP TABLE `project_commands`;--> statement-breakpoint
ALTER TABLE `__new_project_commands` RENAME TO `project_commands`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_workspaces` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`created_at` text NOT NULL,
	`spec_id` text,
	`state` text DEFAULT 'ready' NOT NULL,
	`cleaned_at` text,
	CONSTRAINT `fk_workspaces_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `workspace_name_in_project` UNIQUE(`project_id`,`name`),
	CONSTRAINT "workspace_state_is_known" CHECK("state" IN ('preparing', 'ready', 'failed', 'cleaned'))
);
--> statement-breakpoint
INSERT INTO `__new_workspaces`(`id`, `project_id`, `name`, `path`, `created_at`) SELECT `id`, `project_id`, `name`, `path`, `created_at` FROM `workspaces`;--> statement-breakpoint
DROP TABLE `workspaces`;--> statement-breakpoint
ALTER TABLE `__new_workspaces` RENAME TO `workspaces`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_domain_events` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT,
	`type` text NOT NULL,
	`entity_kind` text NOT NULL,
	`entity_id` text NOT NULL,
	`source` text NOT NULL,
	`author` text NOT NULL,
	`occurred_at` text NOT NULL,
	`project_id` text,
	`session_id` text,
	`spec_id` text,
	`revision_id` text,
	`phase_id` text,
	`payload` text NOT NULL,
	`seen_at` text,
	CONSTRAINT "event_entity_is_known" CHECK("entity_kind" IN ('project', 'profile', 'session', 'workspace', 'command', 'launch')),
	CONSTRAINT "event_source_is_known" CHECK("source" IN ('ui', 'system')),
	CONSTRAINT "event_author_is_known" CHECK("author" IN ('human', 'hemera', 'agent', 'mcp', 'system'))
);
--> statement-breakpoint
INSERT INTO `__new_domain_events`(`sequence`, `type`, `entity_kind`, `entity_id`, `source`, `author`, `occurred_at`, `project_id`, `session_id`, `spec_id`, `revision_id`, `phase_id`, `payload`, `seen_at`) SELECT `sequence`, `type`, `entity_kind`, `entity_id`, `source`, `author`, `occurred_at`, `project_id`, `session_id`, `spec_id`, `revision_id`, `phase_id`, `payload`, `seen_at` FROM `domain_events`;--> statement-breakpoint
DROP TABLE `domain_events`;--> statement-breakpoint
ALTER TABLE `__new_domain_events` RENAME TO `domain_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
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
	CONSTRAINT "entry_kind_is_known" CHECK("kind" IN ('message', 'thought', 'tool_call', 'diff', 'terminal', 'plan', 'permission_request', 'permission_decision', 'usage', 'turn', 'note', 'hemera_tool_call', 'command_run', 'context_delivery', 'command_proposal')),
	CONSTRAINT "entry_origin_is_known" CHECK("origin" IN ('live', 'replay'))
);
--> statement-breakpoint
INSERT INTO `__new_session_entries`(`id`, `session_id`, `seq`, `role`, `kind`, `body`, `payload`, `origin`, `correlation_id`, `turn_id`, `state`, `created_at`) SELECT `id`, `session_id`, `seq`, `role`, `kind`, `body`, `payload`, `origin`, `correlation_id`, `turn_id`, `state`, `created_at` FROM `session_entries`;--> statement-breakpoint
DROP TABLE `session_entries`;--> statement-breakpoint
ALTER TABLE `__new_session_entries` RENAME TO `session_entries`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_once_per_spec` ON `workspaces` (`spec_id`) WHERE "workspaces"."spec_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `event_by_project` ON `domain_events` (`project_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `event_by_session` ON `domain_events` (`session_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `event_unseen` ON `domain_events` (`seen_at`);--> statement-breakpoint
CREATE INDEX `entry_by_correlation` ON `session_entries` (`session_id`,`correlation_id`);--> statement-breakpoint
CREATE INDEX `entry_by_turn` ON `session_entries` (`session_id`,`turn_id`);--> statement-breakpoint
CREATE INDEX `run_by_workspace` ON `command_runs` (`workspace_id`,`state`);--> statement-breakpoint
CREATE UNIQUE INDEX `variable_once_in_project` ON `environment_variables` (`project_id`,`key`) WHERE "environment_variables"."workspace_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `variable_once_in_workspace` ON `environment_variables` (`workspace_id`,`key`) WHERE "environment_variables"."workspace_id" IS NOT NULL;