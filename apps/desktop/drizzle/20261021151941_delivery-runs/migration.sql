CREATE TABLE `delivery_repositories` (
	`mission_id` text NOT NULL,
	`repository_id` text NOT NULL,
	`repository` text NOT NULL,
	`wave` integer NOT NULL,
	`position` integer NOT NULL,
	`bump_only` integer NOT NULL,
	CONSTRAINT `delivery_repositories_pk` PRIMARY KEY(`mission_id`, `repository_id`),
	CONSTRAINT `fk_delivery_repositories_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `delivery_runs` (
	`mission_id` text PRIMARY KEY,
	`waves_version` integer NOT NULL,
	`state` text NOT NULL,
	`started_at` text NOT NULL,
	`stopped_at` text,
	`delivered_at` text,
	`updated_at` text NOT NULL,
	CONSTRAINT `fk_delivery_runs_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `delivery_steps` (
	`mission_id` text NOT NULL,
	`repository_id` text NOT NULL,
	`step_id` text NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`mode` text NOT NULL,
	`action` text NOT NULL,
	`state` text NOT NULL,
	`outcome` text,
	`message` text,
	`reason` text,
	`waiting_for` text,
	`need_id` text,
	`clicked` integer NOT NULL,
	`asked` text,
	`action_id` text,
	`watching` integer NOT NULL,
	`lineage` text,
	`start_tree` text,
	`accepted_tree` text,
	`started_at` text,
	`ended_at` text,
	`updated_at` text NOT NULL,
	CONSTRAINT `delivery_steps_pk` PRIMARY KEY(`mission_id`, `repository_id`, `step_id`),
	CONSTRAINT `fk_delivery_steps_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `mission_ships` ADD `changed` text;--> statement-breakpoint
CREATE INDEX `delivery_steps_by_need` ON `delivery_steps` (`need_id`);--> statement-breakpoint
CREATE INDEX `delivery_steps_by_lineage` ON `delivery_steps` (`lineage`);