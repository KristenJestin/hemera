CREATE TABLE `mission_ships` (
	`mission_id` text PRIMARY KEY,
	`checkpoint_id` text NOT NULL,
	`trees` text NOT NULL,
	`versions` text NOT NULL,
	`confirmation` text NOT NULL,
	`shipped_at` text NOT NULL,
	`delivered_at` text,
	CONSTRAINT `fk_mission_ships_mission_id_missions_id_fk` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE
);
