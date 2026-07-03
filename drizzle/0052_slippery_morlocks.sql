ALTER TABLE `audit_logs` ADD `job_id` integer;--> statement-breakpoint
CREATE INDEX `idx_audit_logs_job` ON `audit_logs` (`job_id`,`created_at`);--> statement-breakpoint
UPDATE `audit_logs` SET `job_id` = `resource_id` WHERE `resource_type` = 'job' AND `job_id` IS NULL;--> statement-breakpoint
UPDATE `audit_logs` SET `job_id` = (SELECT c.`job_id` FROM `candidates` c WHERE c.`id` = `audit_logs`.`resource_id`) WHERE `resource_type` = 'candidate' AND `job_id` IS NULL;--> statement-breakpoint
UPDATE `audit_logs` SET `job_id` = (SELECT s.`job_id` FROM `interview_schedules` s WHERE s.`id` = `audit_logs`.`resource_id`) WHERE `resource_type` = 'interview_schedule' AND `job_id` IS NULL;--> statement-breakpoint
UPDATE `audit_logs` SET `job_id` = (SELECT c.`job_id` FROM `interview_sessions` iv JOIN `candidates` c ON c.`id` = iv.`candidate_id` WHERE iv.`id` = `audit_logs`.`resource_id`) WHERE `resource_type` = 'interview_session' AND `job_id` IS NULL;
