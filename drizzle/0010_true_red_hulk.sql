CREATE TABLE `screening_cache` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`prompt_hash` text NOT NULL,
	`score` integer NOT NULL,
	`report` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `screening_cache_prompt_hash_unique` ON `screening_cache` (`prompt_hash`);--> statement-breakpoint
ALTER TABLE `candidates` ADD `resume_content_hash` text;