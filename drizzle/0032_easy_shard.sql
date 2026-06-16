CREATE TABLE `interview_transcript_segments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recorded_interview_id` integer NOT NULL,
	`seq` integer NOT NULL,
	`speaker_label` text,
	`role` text,
	`start_ms` integer,
	`end_ms` integer,
	`text` text NOT NULL,
	`low_confidence` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`recorded_interview_id`) REFERENCES `recorded_interviews`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_transcript_segments_ri_seq` ON `interview_transcript_segments` (`recorded_interview_id`,`seq`);--> statement-breakpoint
CREATE TABLE `recorded_interviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer,
	`job_id` integer NOT NULL,
	`candidate_id` integer NOT NULL,
	`round` text DEFAULT 'round1' NOT NULL,
	`mode` text DEFAULT 'upload' NOT NULL,
	`status` text DEFAULT 'processing' NOT NULL,
	`created_by_user_id` integer,
	`duration_seconds` integer DEFAULT 0 NOT NULL,
	`report` text,
	`report_confirmed_at` text,
	`report_confirmed_by_user_id` integer,
	`error` text,
	`started_at` text,
	`completed_at` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `job_postings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`report_confirmed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_recorded_interviews_candidate` ON `recorded_interviews` (`candidate_id`);--> statement-breakpoint
CREATE INDEX `idx_recorded_interviews_job` ON `recorded_interviews` (`job_id`);--> statement-breakpoint
CREATE INDEX `idx_recorded_interviews_org` ON `recorded_interviews` (`org_id`);