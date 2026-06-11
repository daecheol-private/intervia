CREATE INDEX `idx_consent_logs_session` ON `consent_logs` (`interview_session_id`);--> statement-breakpoint
CREATE INDEX `idx_interview_schedules_status_expires` ON `interview_schedules` (`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_interview_sessions_status_expires` ON `interview_sessions` (`status`,`expires_at`);