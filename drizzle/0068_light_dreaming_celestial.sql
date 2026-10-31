CREATE TABLE `phone_otps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`purpose` text NOT NULL,
	`phone` text NOT NULL,
	`code_hash` text NOT NULL,
	`ip` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_phone_otps_phone` ON `phone_otps` (`phone`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_phone_otps_ip` ON `phone_otps` (`ip`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_phone_otps_created` ON `phone_otps` (`created_at`);