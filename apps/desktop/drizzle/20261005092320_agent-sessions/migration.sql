CREATE TABLE `agent_sessions` (
	`id` text PRIMARY KEY,
	`provider` text NOT NULL,
	`owner_kind` text NOT NULL,
	`owner_id` text NOT NULL,
	`role` text NOT NULL,
	`folder` text NOT NULL,
	`native_id` text,
	`chosen_model` text,
	`chosen_effort` text,
	`chosen_mode` text,
	`taken_model` text,
	`taken_effort` text,
	`taken_mode` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
