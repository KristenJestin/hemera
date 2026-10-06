CREATE TABLE `mission_spent` (
	`mission_id` text NOT NULL,
	`counter` text NOT NULL,
	`spent` integer NOT NULL,
	CONSTRAINT `mission_spent_pk` PRIMARY KEY(`mission_id`, `counter`),
	CONSTRAINT `fk_mission_spent_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `model_marks` (
	`agent` text NOT NULL,
	`model` text NOT NULL,
	`favourite` integer NOT NULL,
	`hidden` integer NOT NULL,
	CONSTRAINT `model_marks_pk` PRIMARY KEY(`agent`, `model`)
);
--> statement-breakpoint
CREATE TABLE `role_models` (
	`level` text NOT NULL,
	`scope_id` text NOT NULL,
	`role` text NOT NULL,
	`agent` text NOT NULL,
	`model` text,
	`effort` text,
	`updated_at` text NOT NULL,
	CONSTRAINT `role_models_pk` PRIMARY KEY(`level`, `scope_id`, `role`)
);
--> statement-breakpoint
CREATE TABLE `session_needs` (
	`need_id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`reason` text NOT NULL,
	`agent` text NOT NULL,
	`model` text
);
--> statement-breakpoint
CREATE TABLE `session_usage` (
	`session_id` text PRIMARY KEY,
	`owner_kind` text NOT NULL,
	`owner_id` text NOT NULL,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`cost_amount` real,
	`cost_currency` text,
	`measured` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `task_attempts` (
	`task_id` text PRIMARY KEY,
	`mission_id` text,
	`count` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `agent_sessions` ADD `model_level` text;--> statement-breakpoint
ALTER TABLE `missions` ADD `budget_launches` integer;--> statement-breakpoint
ALTER TABLE `missions` ADD `budget_attempts` integer;--> statement-breakpoint
ALTER TABLE `missions` ADD `budget_rounds` integer;--> statement-breakpoint
ALTER TABLE `projects` ADD `sub_agent_cap` integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `budget_launches` integer DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `budget_attempts` integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `budget_rounds` integer DEFAULT 3 NOT NULL;