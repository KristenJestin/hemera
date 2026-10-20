CREATE TABLE `delivery_images` (
	`mission_id` text NOT NULL,
	`repository_id` text NOT NULL,
	`evidence_id` text NOT NULL,
	`position` integer NOT NULL,
	`file` text NOT NULL,
	`alt` text NOT NULL,
	`state` text NOT NULL,
	`forge` text,
	`host` text,
	`number` integer,
	`url` text,
	`message` text,
	`updated_at` text NOT NULL,
	CONSTRAINT `delivery_images_pk` PRIMARY KEY(`mission_id`, `repository_id`, `evidence_id`),
	CONSTRAINT `fk_delivery_images_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_delivery_images_evidence_id_memory_evidence_id_fk` FOREIGN KEY (`evidence_id`) REFERENCES `memory_evidence`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `delivery_pushes` ADD `images_reason` text;--> statement-breakpoint
ALTER TABLE `delivery_pushes` ADD `images_answer` text;--> statement-breakpoint
ALTER TABLE `delivery_pushes` ADD `images_need_id` text;--> statement-breakpoint
ALTER TABLE `memory_evidence` ADD `publishable` integer;