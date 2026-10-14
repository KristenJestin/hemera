CREATE TABLE `delivery_rule_copies` (
	`mission_id` text NOT NULL,
	`section` text NOT NULL,
	`version` integer NOT NULL,
	`copied_at` text NOT NULL,
	`document` text NOT NULL,
	CONSTRAINT `delivery_rule_copies_pk` PRIMARY KEY(`mission_id`, `section`),
	CONSTRAINT `fk_delivery_rule_copies_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `delivery_rules` (
	`project_id` text PRIMARY KEY,
	`version` integer NOT NULL,
	`saved_at` text NOT NULL,
	`document` text NOT NULL,
	CONSTRAINT `fk_delivery_rules_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE
);
