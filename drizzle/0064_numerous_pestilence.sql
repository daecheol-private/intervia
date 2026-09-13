CREATE TABLE `notify_phones` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`user_id` integer,
	`email` text,
	`name` text,
	`phone` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`verify_token` text NOT NULL,
	`verify_expires_at` text NOT NULL,
	`verify_sent_at` text,
	`requested_by_user_id` integer,
	`verified_at` text,
	`verified_ip` text,
	`verified_ua` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requested_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notify_phones_verify_token_unique` ON `notify_phones` (`verify_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_notify_phones_user` ON `notify_phones` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_notify_phones_org_email` ON `notify_phones` (`org_id`,`email`);--> statement-breakpoint
ALTER TABLE `interview_schedules` ADD `notify_user_ids` text;