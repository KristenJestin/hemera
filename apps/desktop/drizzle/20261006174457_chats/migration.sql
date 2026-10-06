CREATE TABLE `chat_entries` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT,
	`chat_id` text NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`tool` text,
	`outcome` text,
	`request` integer,
	`at` text NOT NULL,
	CONSTRAINT `fk_chat_entries_chat_id_chats_id_fk` FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `chats` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`renamed` integer NOT NULL,
	`agent` text NOT NULL,
	`model` text,
	`effort` text,
	`lineage` text,
	`created_at` text NOT NULL,
	`last_activity_at` text NOT NULL,
	CONSTRAINT `fk_chats_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_live_session_per_lineage` ON `agent_sessions` (`lineage`) WHERE "agent_sessions"."state" in ('starting', 'working', 'idle', 'stuck');--> statement-breakpoint
CREATE INDEX `chat_entries_by_chat` ON `chat_entries` (`chat_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `chats_by_project` ON `chats` (`project_id`,`last_activity_at`);