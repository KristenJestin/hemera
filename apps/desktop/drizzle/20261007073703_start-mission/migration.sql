ALTER TABLE `missions` ADD `ticket_reference` text;--> statement-breakpoint
ALTER TABLE `missions` ADD `search_text` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `missions` ADD `origin_id` text REFERENCES missions(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `missions` ADD `idempotency_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `mission_ticket_once` ON `missions` (`project_id`,`ticket_reference`);--> statement-breakpoint
CREATE UNIQUE INDEX `mission_choice_once` ON `missions` (`project_id`,`idempotency_key`);--> statement-breakpoint
UPDATE `missions` SET `search_text` = lower(replace(replace(`key_prefix` || '-' || `key_number` || ' ' || `title` || coalesce(' ' || `idea_sentence`, '') || coalesce(' ' || `idea_ticket`, ''), char(10), ' '), char(9), ' '));