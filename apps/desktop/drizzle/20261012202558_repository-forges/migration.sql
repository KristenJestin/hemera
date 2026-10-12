CREATE TABLE `repository_forges` (
	`repository_id` text PRIMARY KEY,
	`forge` text NOT NULL,
	`host` text,
	CONSTRAINT `fk_repository_forges_repository_id_project_repositories_id_fk` FOREIGN KEY (`repository_id`) REFERENCES `project_repositories`(`id`) ON DELETE CASCADE
);
