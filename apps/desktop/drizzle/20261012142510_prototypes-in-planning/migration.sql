ALTER TABLE `freezes` ADD `prototypes` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `helpers` ADD `verdict` text;--> statement-breakpoint
ALTER TABLE `helpers` ADD `verdict_note` text;--> statement-breakpoint
ALTER TABLE `helpers` ADD `judged_at` text;