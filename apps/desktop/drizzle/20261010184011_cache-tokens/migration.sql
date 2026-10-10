ALTER TABLE `session_usage` ADD `cached_read_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `session_usage` ADD `cached_write_tokens` integer DEFAULT 0 NOT NULL;