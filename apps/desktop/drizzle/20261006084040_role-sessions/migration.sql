CREATE TABLE `runner_leases` (
	`work_item` text PRIMARY KEY,
	`lineage` text NOT NULL,
	`session_id` text NOT NULL,
	`epoch` integer NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session_deliveries` (
	`id` text PRIMARY KEY,
	`owner_kind` text NOT NULL,
	`owner_id` text NOT NULL,
	`target_lineage` text,
	`target_role` text,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`urgency` text NOT NULL,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	`sent_at` text,
	`sent_to` text
);
--> statement-breakpoint
CREATE TABLE `session_threads` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`session_id` text NOT NULL,
	`at` text NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD `lineage` text;--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD `parent_id` text;--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD `depth` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD `epoch` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD `state` text DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD `state_reason` text;--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD `ended_at` text;--> statement-breakpoint
CREATE INDEX `deliveries_by_target` ON `session_deliveries` (`owner_kind`,`owner_id`,`state`,`created_at`);--> statement-breakpoint
CREATE INDEX `threads_by_session` ON `session_threads` (`session_id`,`id`);