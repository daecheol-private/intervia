ALTER TABLE `candidates` ADD `source` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `job_postings` ADD `apply_token` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_job_postings_apply_token` ON `job_postings` (`apply_token`);