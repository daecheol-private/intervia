CREATE TABLE `inquiries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`category` text NOT NULL,
	`message` text NOT NULL,
	`contact_email` text NOT NULL,
	`org_id` integer,
	`user_id` integer,
	`interview_session_id` integer,
	`candidate_id` integer,
	`status` text DEFAULT 'open' NOT NULL,
	`admin_note` text,
	`resolved_by_user_id` integer,
	`resolved_at` text,
	`ip` text,
	`user_agent` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_inquiries_status` ON `inquiries` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_inquiries_org` ON `inquiries` (`org_id`,`created_at`);