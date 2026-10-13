CREATE TABLE `proof_runs` (
	`id` text PRIMARY KEY,
	`mission_id` text NOT NULL,
	`building_id` text NOT NULL,
	`scenario` text NOT NULL,
	`phase` text NOT NULL,
	`line` text NOT NULL,
	`test_path` text,
	`test_sha256` text,
	`exit_code` integer,
	`classification` text NOT NULL,
	`failing_test` text,
	`assertion` text,
	`key_line_matched` integer,
	`output_tail` text NOT NULL,
	`evidence_id` text,
	`test_evidence_id` text,
	`run_id` text,
	`trees` text NOT NULL,
	`at` text NOT NULL,
	CONSTRAINT `fk_proof_runs_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_proof_runs_building_id_buildings_id_fk` FOREIGN KEY (`building_id`) REFERENCES `buildings`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `repository_trees` (
	`mission_id` text NOT NULL,
	`repository` text NOT NULL,
	`tree` text NOT NULL,
	`taken_at` text NOT NULL,
	CONSTRAINT `repository_trees_pk` PRIMARY KEY(`mission_id`, `repository`),
	CONSTRAINT `fk_repository_trees_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `scenario_proofs` (
	`building_id` text NOT NULL,
	`scenario` text NOT NULL,
	`requirement` text NOT NULL,
	`rank` integer NOT NULL,
	`mode` text NOT NULL,
	`state` text NOT NULL,
	`red_run_id` text,
	`green_run_id` text,
	`held_run_id` text,
	`need_id` text,
	`judged_by` text,
	`judged_at` text,
	`note` text,
	`trees` text,
	`updated_at` text NOT NULL,
	CONSTRAINT `scenario_proofs_pk` PRIMARY KEY(`building_id`, `scenario`),
	CONSTRAINT `fk_scenario_proofs_building_id_buildings_id_fk` FOREIGN KEY (`building_id`) REFERENCES `buildings`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `writes_before_red` (
	`id` text PRIMARY KEY,
	`building_id` text NOT NULL,
	`repository` text NOT NULL,
	`path` text NOT NULL,
	`task_id` text,
	`session_id` text NOT NULL,
	`scenarios` text NOT NULL,
	`at` text NOT NULL,
	CONSTRAINT `fk_writes_before_red_building_id_buildings_id_fk` FOREIGN KEY (`building_id`) REFERENCES `buildings`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `proof_runs_of_scenario` ON `proof_runs` (`building_id`,`scenario`);--> statement-breakpoint
CREATE INDEX `writes_before_red_of_building` ON `writes_before_red` (`building_id`);