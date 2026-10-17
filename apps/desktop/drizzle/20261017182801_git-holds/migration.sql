CREATE TABLE `git_holds` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`need_id` text,
	`everywhere` integer NOT NULL,
	`commons` text NOT NULL,
	`checkouts` text NOT NULL,
	`changes` text NOT NULL,
	`answer` text NOT NULL,
	CONSTRAINT `fk_git_holds_need_id_needs_id_fk` FOREIGN KEY (`need_id`) REFERENCES `needs`(`id`) ON DELETE SET NULL
);
