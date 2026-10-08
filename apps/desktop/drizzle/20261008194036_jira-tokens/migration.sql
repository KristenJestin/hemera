CREATE TABLE `jira_tokens` (
	`provider_id` text PRIMARY KEY,
	`ciphertext` text NOT NULL,
	`refused_at` text,
	`saved_at` text NOT NULL,
	CONSTRAINT `fk_jira_tokens_provider_id_ticket_providers_id_fk` FOREIGN KEY (`provider_id`) REFERENCES `ticket_providers`(`id`) ON DELETE CASCADE
);
