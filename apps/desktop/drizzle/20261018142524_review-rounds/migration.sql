CREATE TABLE `round_decisions` (
	`id` text PRIMARY KEY,
	`mission_id` text NOT NULL,
	`round` integer NOT NULL,
	`point` text,
	`feedback_id` text,
	`kind` text NOT NULL,
	`choice` text NOT NULL,
	`alternatives` text NOT NULL,
	`why` text NOT NULL,
	`at` text NOT NULL,
	CONSTRAINT `fk_round_decisions_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `round_points` (
	`mission_id` text NOT NULL,
	`round` integer NOT NULL,
	`id` text NOT NULL,
	`number` integer NOT NULL,
	`text` text NOT NULL,
	`kind` text NOT NULL,
	`delta_requirement` text,
	`delta_change` text,
	`delta_living_version` integer,
	`sources` text NOT NULL,
	`decisions` text NOT NULL,
	`removed` integer NOT NULL,
	`removed_reason` text,
	`session_id` text NOT NULL,
	`written_at` text NOT NULL,
	CONSTRAINT `round_points_pk` PRIMARY KEY(`mission_id`, `id`),
	CONSTRAINT `fk_round_points_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `round_scenarios` (
	`mission_id` text NOT NULL,
	`round` integer NOT NULL,
	`point` text NOT NULL,
	`id` text NOT NULL,
	`number` integer NOT NULL,
	`rank` integer NOT NULL,
	`when` text NOT NULL,
	`then` text NOT NULL,
	`block` text NOT NULL,
	`removed` integer NOT NULL,
	CONSTRAINT `round_scenarios_pk` PRIMARY KEY(`mission_id`, `id`),
	CONSTRAINT `fk_round_scenarios_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `round_tasks` (
	`mission_id` text NOT NULL,
	`round` integer NOT NULL,
	`id` text NOT NULL,
	`number` integer NOT NULL,
	`rank` integer NOT NULL,
	`title` text NOT NULL,
	`result` text NOT NULL,
	`points` text NOT NULL,
	`scenarios` text NOT NULL,
	`targets` text NOT NULL,
	`depends_on` text NOT NULL,
	`removed` integer NOT NULL,
	CONSTRAINT `round_tasks_pk` PRIMARY KEY(`mission_id`, `id`),
	CONSTRAINT `fk_round_tasks_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `questions` ADD `round` integer;--> statement-breakpoint
ALTER TABLE `questions` ADD `kind` text;--> statement-breakpoint
ALTER TABLE `questions` ADD `feedback_id` text;--> statement-breakpoint
ALTER TABLE `review_feedback` ADD `said` text;--> statement-breakpoint
ALTER TABLE `review_feedback` ADD `moved_to` text;--> statement-breakpoint
ALTER TABLE `review_rounds` ADD `ready_why` text;--> statement-breakpoint
CREATE INDEX `round_decisions_of_mission` ON `round_decisions` (`mission_id`,`round`);