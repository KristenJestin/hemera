CREATE TABLE `mission_recommendations` (
	`mission_id` text PRIMARY KEY,
	`agent` text NOT NULL,
	`model` text NOT NULL,
	`effort` text,
	`reason` text NOT NULL,
	`checked` integer NOT NULL,
	`session_id` text NOT NULL,
	`at` text NOT NULL,
	CONSTRAINT `fk_mission_recommendations_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `spec_proofs` (
	`mission_id` text NOT NULL,
	`scenario_id` text NOT NULL,
	`version` integer NOT NULL,
	`block` text NOT NULL,
	`from_probe` text,
	`session_id` text NOT NULL,
	`written_at` text NOT NULL,
	CONSTRAINT `spec_proofs_pk` PRIMARY KEY(`mission_id`, `scenario_id`),
	CONSTRAINT `fk_spec_proofs_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `spec_tasks` (
	`mission_id` text NOT NULL,
	`id` text NOT NULL,
	`number` integer NOT NULL,
	`rank` integer NOT NULL,
	`title` text NOT NULL,
	`result` text NOT NULL,
	`requirements` text NOT NULL,
	`scenarios` text NOT NULL,
	`targets` text NOT NULL,
	`depends_on` text NOT NULL,
	`removed` integer DEFAULT false NOT NULL,
	`session_id` text NOT NULL,
	`written_at` text NOT NULL,
	CONSTRAINT `spec_tasks_pk` PRIMARY KEY(`mission_id`, `id`),
	CONSTRAINT `fk_spec_tasks_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
