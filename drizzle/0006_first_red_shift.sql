CREATE TABLE `org_zoom_configs` (
	`org_id` integer PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`client_id` text NOT NULL,
	`client_secret` text NOT NULL,
	`last_checked_at` text,
	`last_check_status` text,
	`last_check_error` text,
	`updated_by_user_id` integer,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
