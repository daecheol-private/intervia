ALTER TABLE `interview_schedules` ADD `candidate_reminder_sent_at` text;--> statement-breakpoint
ALTER TABLE `interview_sessions` ADD `reminder24_sent_at` text;--> statement-breakpoint
ALTER TABLE `interview_sessions` ADD `reminder48_sent_at` text;