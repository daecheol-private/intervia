CREATE TABLE `shared_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`candidate_id` integer NOT NULL,
	`org_id` integer,
	`token` text NOT NULL,
	`created_by_user_id` integer,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`view_count` integer DEFAULT 0 NOT NULL,
	`last_viewed_at` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shared_reports_token_unique` ON `shared_reports` (`token`);--> statement-breakpoint
CREATE INDEX `idx_shared_reports_candidate` ON `shared_reports` (`candidate_id`);--> statement-breakpoint
CREATE INDEX `idx_shared_reports_org` ON `shared_reports` (`org_id`);