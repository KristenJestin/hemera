CREATE TABLE `build_attempt_files` (
	`attempt_id` text NOT NULL,
	`repository` text NOT NULL,
	`path` text NOT NULL,
	`status` text NOT NULL,
	`added` integer,
	`removed` integer,
	CONSTRAINT `build_attempt_files_pk` PRIMARY KEY(`attempt_id`, `repository`, `path`),
	CONSTRAINT `fk_build_attempt_files_attempt_id_build_attempts_id_fk` FOREIGN KEY (`attempt_id`) REFERENCES `build_attempts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `build_attempt_trees` (
	`attempt_id` text NOT NULL,
	`repository` text NOT NULL,
	`start_tree` text NOT NULL,
	`end_tree` text,
	CONSTRAINT `build_attempt_trees_pk` PRIMARY KEY(`attempt_id`, `repository`),
	CONSTRAINT `fk_build_attempt_trees_attempt_id_build_attempts_id_fk` FOREIGN KEY (`attempt_id`) REFERENCES `build_attempts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `build_attempts` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`scope` text NOT NULL,
	`build_task_id` text,
	`story_id` text,
	`number` integer NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`result` text,
	`told_at` text,
	CONSTRAINT `fk_build_attempts_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_build_attempts_build_task_id_build_tasks_id_fk` FOREIGN KEY (`build_task_id`) REFERENCES `build_tasks`(`id`) ON DELETE CASCADE,
	CONSTRAINT "attempt_scope_is_known" CHECK("scope" IN ('task', 'story', 'build')),
	CONSTRAINT "attempt_result_is_known" CHECK("result" IS NULL OR "result" IN ('green', 'red', 'unverified')),
	CONSTRAINT "attempt_names_its_subject" CHECK(("scope" = 'task') = ("build_task_id" IS NOT NULL) AND ("scope" = 'story') = ("story_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `build_blockers` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`build_task_id` text NOT NULL,
	`reason` text NOT NULL,
	`raised_at` text NOT NULL,
	`dismissed_at` text,
	CONSTRAINT `fk_build_blockers_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_build_blockers_build_task_id_build_tasks_id_fk` FOREIGN KEY (`build_task_id`) REFERENCES `build_tasks`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `build_check_results` (
	`id` text PRIMARY KEY,
	`attempt_id` text NOT NULL,
	`check_id` text,
	`name` text NOT NULL,
	`place` text NOT NULL,
	`line` text NOT NULL,
	`run_id` text,
	`verdict` text NOT NULL,
	`exit_code` integer,
	`value` real,
	`detail` text,
	`output_tail` text DEFAULT '' NOT NULL,
	`ran_at` text NOT NULL,
	CONSTRAINT `fk_build_check_results_attempt_id_build_attempts_id_fk` FOREIGN KEY (`attempt_id`) REFERENCES `build_attempts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_build_check_results_check_id_project_checks_id_fk` FOREIGN KEY (`check_id`) REFERENCES `project_checks`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_build_check_results_run_id_command_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `command_runs`(`id`) ON DELETE SET NULL,
	CONSTRAINT "check_verdict_is_known" CHECK("verdict" IN ('green', 'red', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE `build_tasks` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`task_id` text NOT NULL,
	`label` text NOT NULL,
	`rank` text NOT NULL,
	`state` text NOT NULL,
	`handed_at` text,
	`started_at` text,
	`finished_at` text,
	`ended_at` text,
	`skip_reason` text,
	`skip_unblocks` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_build_tasks_session_id_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `build_task_once_in_session` UNIQUE(`session_id`,`task_id`),
	CONSTRAINT `build_task_label_in_session` UNIQUE(`session_id`,`label`),
	CONSTRAINT "build_task_state_is_known" CHECK("state" IN ('waiting', 'ready', 'in_progress', 'checking', 'done', 'yours', 'blocked', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE `project_checks` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`command_id` text,
	`line` text,
	`where` text NOT NULL,
	`repository` text,
	`when` text NOT NULL,
	`expect_pattern` text,
	`expect_minimum` real,
	`files` text,
	`rank` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_project_checks_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_project_checks_command_id_project_commands_id_fk` FOREIGN KEY (`command_id`) REFERENCES `project_commands`(`id`) ON DELETE CASCADE,
	CONSTRAINT `check_name_in_project` UNIQUE(`project_id`,`name`),
	CONSTRAINT "check_where_is_known" CHECK("where" IN ('root', 'repository', 'changed')),
	CONSTRAINT "check_when_is_known" CHECK("when" IN ('task', 'story', 'end')),
	CONSTRAINT "check_runs_a_command_or_a_line" CHECK(("command_id" IS NULL) <> ("line" IS NULL)),
	CONSTRAINT "check_repository_only_where_asked" CHECK(("where" = 'repository') = ("repository" IS NOT NULL)),
	CONSTRAINT "check_expect_is_whole" CHECK(("expect_pattern" IS NULL) = ("expect_minimum" IS NULL))
);
--> statement-breakpoint
ALTER TABLE `sessions` ADD `build_phase` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `build_paused_at` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `build_detail` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `approach_note` text;--> statement-breakpoint
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
	`choices` text DEFAULT '{}' NOT NULL,
	`workspace_id` text,
	`revision_id` text,
	`mission` text DEFAULT 'free' NOT NULL,
	`spec_id` text,
	`briefed_at` text,
	`created_at` text NOT NULL,
	`last_written_at` text NOT NULL,
	`archived_at` text,
	`version` integer DEFAULT 1 NOT NULL,
	`build_phase` text,
	`build_paused_at` text,
	`build_detail` text,
	`approach_note` text,
	CONSTRAINT `fk_sessions_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_sessions_workspace_id_workspaces_id_fk` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_sessions_spec_id_specs_id_fk` FOREIGN KEY (`spec_id`) REFERENCES `specs`(`id`),
	CONSTRAINT "session_title_source_is_known" CHECK("title_source" IN ('derived', 'user')),
	CONSTRAINT "session_provider_is_known" CHECK("provider" IS NULL OR "provider" IN ('claude', 'codex', 'opencode')),
	CONSTRAINT "session_native_state_is_known" CHECK("native_state" IN ('none', 'attached', 'lost', 'fallback')),
	CONSTRAINT "session_mission_is_known" CHECK("mission" IN ('free', 'define', 'build')),
	CONSTRAINT "session_build_phase_is_known" CHECK("build_phase" IS NULL OR "build_phase" IN ('prepare', 'execute', 'verify', 'accepted', 'stopped'))
);
--> statement-breakpoint
INSERT INTO `__new_sessions`(`id`, `project_id`, `title`, `title_source`, `provider`, `model`, `native_session_id`, `native_state`, `cwd`, `choices`, `workspace_id`, `revision_id`, `mission`, `spec_id`, `briefed_at`, `created_at`, `last_written_at`, `archived_at`, `version`) SELECT `id`, `project_id`, `title`, `title_source`, `provider`, `model`, `native_session_id`, `native_state`, `cwd`, `choices`, `workspace_id`, `revision_id`, `mission`, `spec_id`, `briefed_at`, `created_at`, `last_written_at`, `archived_at`, `version` FROM `sessions`;--> statement-breakpoint
DROP TABLE `sessions`;--> statement-breakpoint
ALTER TABLE `__new_sessions` RENAME TO `sessions`;--> statement-breakpoint
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
	CONSTRAINT "event_entity_is_known" CHECK("entity_kind" IN ('project', 'profile', 'session', 'spec', 'workspace', 'command', 'launch', 'task')),
	CONSTRAINT "event_source_is_known" CHECK("source" IN ('ui', 'system')),
	CONSTRAINT "event_author_is_known" CHECK("author" IN ('human', 'hemera', 'agent', 'mcp', 'system'))
);
--> statement-breakpoint
INSERT INTO `__new_domain_events`(`sequence`, `type`, `entity_kind`, `entity_id`, `source`, `author`, `occurred_at`, `project_id`, `session_id`, `spec_id`, `revision_id`, `phase_id`, `payload`, `seen_at`) SELECT `sequence`, `type`, `entity_kind`, `entity_id`, `source`, `author`, `occurred_at`, `project_id`, `session_id`, `spec_id`, `revision_id`, `phase_id`, `payload`, `seen_at` FROM `domain_events`;--> statement-breakpoint
DROP TABLE `domain_events`;--> statement-breakpoint
ALTER TABLE `__new_domain_events` RENAME TO `domain_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `session_by_project` ON `sessions` (`project_id`,`last_written_at`);--> statement-breakpoint
CREATE INDEX `event_by_project` ON `domain_events` (`project_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `event_by_session` ON `domain_events` (`session_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `event_by_spec` ON `domain_events` (`spec_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `event_unseen` ON `domain_events` (`seen_at`);--> statement-breakpoint
CREATE INDEX `attempt_by_session` ON `build_attempts` (`session_id`,`scope`);--> statement-breakpoint
CREATE UNIQUE INDEX `attempt_number_of_task` ON `build_attempts` (`build_task_id`,`number`) WHERE "build_attempts"."build_task_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `attempt_number_of_story` ON `build_attempts` (`session_id`,`story_id`,`number`) WHERE "build_attempts"."story_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `attempt_number_of_build` ON `build_attempts` (`session_id`,`number`) WHERE "build_attempts"."scope" = 'build';--> statement-breakpoint
CREATE INDEX `blocker_by_session` ON `build_blockers` (`session_id`,`raised_at`);--> statement-breakpoint
CREATE INDEX `check_result_by_attempt` ON `build_check_results` (`attempt_id`,`ran_at`);--> statement-breakpoint
CREATE INDEX `build_task_by_state` ON `build_tasks` (`session_id`,`state`);