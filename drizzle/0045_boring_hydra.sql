ALTER TABLE `candidates` ADD `updated_at` text;--> statement-breakpoint
UPDATE `candidates` SET `updated_at` = `created_at` WHERE `updated_at` IS NULL;--> statement-breakpoint
CREATE INDEX `idx_candidates_job_updated` ON `candidates` (`job_id`,`updated_at`);--> statement-breakpoint
ALTER TABLE `interview_sessions` ADD `updated_at` text;--> statement-breakpoint
UPDATE `interview_sessions` SET `updated_at` = `created_at` WHERE `updated_at` IS NULL;--> statement-breakpoint
CREATE INDEX `idx_interview_sessions_candidate_updated` ON `interview_sessions` (`candidate_id`,`updated_at`);--> statement-breakpoint
ALTER TABLE `screening_jobs` ADD `updated_at` text;--> statement-breakpoint
UPDATE `screening_jobs` SET `updated_at` = `created_at` WHERE `updated_at` IS NULL;--> statement-breakpoint
CREATE INDEX `idx_screening_jobs_candidate_updated` ON `screening_jobs` (`candidate_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_interview_schedules_job_updated` ON `interview_schedules` (`job_id`,`updated_at`);
