CREATE TABLE `acceptance_criteria` (
	`id` text PRIMARY KEY,
	`story_id` text NOT NULL,
	`body` text NOT NULL,
	`rank` text NOT NULL,
	CONSTRAINT `fk_acceptance_criteria_story_id_user_stories_id_fk` FOREIGN KEY (`story_id`) REFERENCES `user_stories`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `spec_edit_buffers` (
	`spec_id` text NOT NULL,
	`name` text NOT NULL,
	`body` text NOT NULL,
	`base_version` integer NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `spec_edit_buffers_pk` PRIMARY KEY(`spec_id`, `name`),
	CONSTRAINT `fk_spec_edit_buffers_spec_id_specs_id_fk` FOREIGN KEY (`spec_id`) REFERENCES `specs`(`id`) ON DELETE CASCADE,
	CONSTRAINT "buffer_name_is_known" CHECK("name" IN ('problem', 'expected_outcome', 'scope', 'verification', 'plan', 'behaviour', 'reproduction', 'invariants'))
);
--> statement-breakpoint
CREATE TABLE `spec_phases` (
	`id` text PRIMARY KEY,
	`revision_id` text NOT NULL,
	`phase` text NOT NULL,
	`state` text NOT NULL,
	`summary` text,
	`assumptions` text DEFAULT '[]' NOT NULL,
	`basis` text DEFAULT '{}' NOT NULL,
	`protocol_version` integer NOT NULL,
	`declared_at` text,
	CONSTRAINT `fk_spec_phases_revision_id_spec_revisions_id_fk` FOREIGN KEY (`revision_id`) REFERENCES `spec_revisions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `phase_once_in_revision` UNIQUE(`revision_id`,`phase`),
	CONSTRAINT "phase_is_known" CHECK("phase" IN ('shape', 'plan', 'decompose', 'prototype')),
	CONSTRAINT "phase_state_is_known" CHECK("state" IN ('pending', 'open', 'finished', 'stale', 'unavailable'))
);
--> statement-breakpoint
CREATE TABLE `spec_questions` (
	`id` text PRIMARY KEY,
	`revision_id` text NOT NULL,
	`body` text NOT NULL,
	`blocking` integer NOT NULL,
	`phase` text,
	`raised_by` text NOT NULL,
	`options` text DEFAULT '[]' NOT NULL,
	`answer_option_id` text,
	`answer_text` text,
	`resolved_at` text,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_spec_questions_revision_id_spec_revisions_id_fk` FOREIGN KEY (`revision_id`) REFERENCES `spec_revisions`(`id`) ON DELETE CASCADE,
	CONSTRAINT "question_phase_is_known" CHECK("phase" IS NULL OR "phase" IN ('shape', 'plan', 'decompose', 'prototype')),
	CONSTRAINT "question_raised_by_is_known" CHECK("raised_by" IN ('human', 'agent'))
);
--> statement-breakpoint
CREATE TABLE `spec_revisions` (
	`id` text PRIMARY KEY,
	`spec_id` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`change_summary` text,
	`change_reason` text,
	`created_by` text NOT NULL,
	`attested_content_version` integer,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_spec_revisions_spec_id_specs_id_fk` FOREIGN KEY (`spec_id`) REFERENCES `specs`(`id`) ON DELETE CASCADE,
	CONSTRAINT `revision_number_in_spec` UNIQUE(`spec_id`,`number`),
	CONSTRAINT "revision_type_is_known" CHECK("type" IN ('feature', 'bug', 'maintenance')),
	CONSTRAINT "revision_created_by_is_known" CHECK("created_by" IN ('human', 'agent'))
);
--> statement-breakpoint
CREATE TABLE `spec_sections` (
	`id` text PRIMARY KEY,
	`revision_id` text NOT NULL,
	`name` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`author` text NOT NULL,
	`session_id` text,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_spec_sections_revision_id_spec_revisions_id_fk` FOREIGN KEY (`revision_id`) REFERENCES `spec_revisions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `section_once_in_revision` UNIQUE(`revision_id`,`name`),
	CONSTRAINT "section_name_is_known" CHECK("name" IN ('problem', 'expected_outcome', 'scope', 'verification', 'plan', 'behaviour', 'reproduction', 'invariants')),
	CONSTRAINT "section_author_is_known" CHECK("author" IN ('human', 'agent'))
);
--> statement-breakpoint
CREATE TABLE `spec_tasks` (
	`id` text PRIMARY KEY,
	`task_set_id` text NOT NULL,
	`title` text NOT NULL,
	`result` text NOT NULL,
	`type` text NOT NULL,
	`executor` text NOT NULL,
	`criteria` text NOT NULL,
	`rank` text NOT NULL,
	CONSTRAINT `fk_spec_tasks_task_set_id_task_sets_id_fk` FOREIGN KEY (`task_set_id`) REFERENCES `task_sets`(`id`) ON DELETE CASCADE,
	CONSTRAINT "task_executor_is_known" CHECK("executor" IN ('agent', 'human'))
);
--> statement-breakpoint
CREATE TABLE `specs` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`key` text NOT NULL,
	`slug` text NOT NULL,
	`status` text NOT NULL,
	`priority` text,
	`workspace_id` text,
	`current_revision_id` text NOT NULL,
	`writer_session_id` text,
	`content_version` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_specs_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_specs_writer_session_id_sessions_id_fk` FOREIGN KEY (`writer_session_id`) REFERENCES `sessions`(`id`),
	CONSTRAINT `spec_key_in_project` UNIQUE(`project_id`,`key`),
	CONSTRAINT "spec_status_is_known" CHECK("status" IN ('draft', 'ready', 'in_progress', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE `task_dependencies` (
	`task_id` text NOT NULL,
	`depends_on_id` text NOT NULL,
	CONSTRAINT `task_dependencies_pk` PRIMARY KEY(`task_id`, `depends_on_id`),
	CONSTRAINT `fk_task_dependencies_task_id_spec_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `spec_tasks`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_task_dependencies_depends_on_id_spec_tasks_id_fk` FOREIGN KEY (`depends_on_id`) REFERENCES `spec_tasks`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `task_sets` (
	`id` text PRIMARY KEY,
	`revision_id` text NOT NULL,
	`kind` text NOT NULL,
	CONSTRAINT `fk_task_sets_revision_id_spec_revisions_id_fk` FOREIGN KEY (`revision_id`) REFERENCES `spec_revisions`(`id`) ON DELETE CASCADE,
	CONSTRAINT "task_set_kind_is_known" CHECK("kind" IN ('contract'))
);
--> statement-breakpoint
CREATE TABLE `task_stories` (
	`task_id` text NOT NULL,
	`story_id` text NOT NULL,
	CONSTRAINT `task_stories_pk` PRIMARY KEY(`task_id`, `story_id`),
	CONSTRAINT `fk_task_stories_task_id_spec_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `spec_tasks`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_task_stories_story_id_user_stories_id_fk` FOREIGN KEY (`story_id`) REFERENCES `user_stories`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `user_stories` (
	`id` text PRIMARY KEY,
	`revision_id` text NOT NULL,
	`title` text NOT NULL,
	`narrative` text NOT NULL,
	`priority` text,
	`rank` text NOT NULL,
	CONSTRAINT `fk_user_stories_revision_id_spec_revisions_id_fk` FOREIGN KEY (`revision_id`) REFERENCES `spec_revisions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `projects` ADD `spec_prefix` text DEFAULT 'SPEC' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `next_spec_number` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `mission` text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `spec_id` text REFERENCES specs(id);--> statement-breakpoint
ALTER TABLE `sessions` ADD `briefed_at` text;--> statement-breakpoint
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
	`mission` text DEFAULT 'free' NOT NULL,
	`spec_id` text,
	`briefed_at` text,
	`created_at` text NOT NULL,
	`last_written_at` text NOT NULL,
	`archived_at` text,
	`version` integer DEFAULT 1 NOT NULL,
	CONSTRAINT `fk_sessions_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_sessions_spec_id_specs_id_fk` FOREIGN KEY (`spec_id`) REFERENCES `specs`(`id`),
	CONSTRAINT "session_title_source_is_known" CHECK("title_source" IN ('derived', 'user')),
	CONSTRAINT "session_provider_is_known" CHECK("provider" IS NULL OR "provider" IN ('claude', 'codex', 'opencode')),
	CONSTRAINT "session_native_state_is_known" CHECK("native_state" IN ('none', 'attached', 'lost', 'fallback')),
	CONSTRAINT "session_mission_is_known" CHECK("mission" IN ('free', 'define', 'build'))
);
--> statement-breakpoint
INSERT INTO `__new_sessions`(`id`, `project_id`, `title`, `title_source`, `provider`, `model`, `native_session_id`, `native_state`, `cwd`, `created_at`, `last_written_at`, `archived_at`, `version`) SELECT `id`, `project_id`, `title`, `title_source`, `provider`, `model`, `native_session_id`, `native_state`, `cwd`, `created_at`, `last_written_at`, `archived_at`, `version` FROM `sessions`;--> statement-breakpoint
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
	CONSTRAINT "event_entity_is_known" CHECK("entity_kind" IN ('project', 'profile', 'session', 'spec')),
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
	CONSTRAINT "entry_kind_is_known" CHECK("kind" IN ('message', 'thought', 'tool_call', 'diff', 'terminal', 'plan', 'permission_request', 'permission_decision', 'usage', 'turn', 'note', 'hemera_tool_call', 'command_run', 'context_delivery', 'mission_brief', 'spec_question', 'spec_answer', 'spec_proposal')),
	CONSTRAINT "entry_origin_is_known" CHECK("origin" IN ('live', 'replay'))
);
--> statement-breakpoint
INSERT INTO `__new_session_entries`(`id`, `session_id`, `seq`, `role`, `kind`, `body`, `payload`, `origin`, `correlation_id`, `turn_id`, `state`, `created_at`) SELECT `id`, `session_id`, `seq`, `role`, `kind`, `body`, `payload`, `origin`, `correlation_id`, `turn_id`, `state`, `created_at` FROM `session_entries`;--> statement-breakpoint
DROP TABLE `session_entries`;--> statement-breakpoint
ALTER TABLE `__new_session_entries` RENAME TO `session_entries`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `session_by_project` ON `sessions` (`project_id`,`last_written_at`);--> statement-breakpoint
CREATE INDEX `event_by_project` ON `domain_events` (`project_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `event_by_session` ON `domain_events` (`session_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `event_unseen` ON `domain_events` (`seen_at`);--> statement-breakpoint
CREATE INDEX `entry_by_correlation` ON `session_entries` (`session_id`,`correlation_id`);--> statement-breakpoint
CREATE INDEX `entry_by_turn` ON `session_entries` (`session_id`,`turn_id`);--> statement-breakpoint
CREATE INDEX `spec_by_project` ON `specs` (`project_id`);