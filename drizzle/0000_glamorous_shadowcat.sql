CREATE TABLE `candidates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`resume_file_path` text NOT NULL,
	`resume_text` text NOT NULL,
	`screening_score` integer,
	`screening_report` text,
	`status` text DEFAULT 'uploaded' NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `job_postings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `interview_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`candidate_id` integer NOT NULL,
	`access_token` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`messages` text DEFAULT '[]' NOT NULL,
	`evaluation` text,
	`started_at` text,
	`completed_at` text,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `interview_sessions_access_token_unique` ON `interview_sessions` (`access_token`);--> statement-breakpoint
CREATE TABLE `job_postings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`position` text NOT NULL,
	`level` text NOT NULL,
	`employment_type` text NOT NULL,
	`responsibilities` text NOT NULL,
	`requirements` text NOT NULL,
	`tone` text DEFAULT '중립적인' NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
