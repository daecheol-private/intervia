CREATE TABLE `coupon_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`token_amount` integer NOT NULL,
	`valid_from` text,
	`valid_until` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by_user_id` integer,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `coupons` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer NOT NULL,
	`code` text NOT NULL,
	`status` text DEFAULT 'unused' NOT NULL,
	`redeemed_by_org_id` integer,
	`redeemed_by_user_id` integer,
	`redeemed_at` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `coupon_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`redeemed_by_org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`redeemed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `coupon_code_uq` ON `coupons` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `coupon_group_org_uq` ON `coupons` (`group_id`,`redeemed_by_org_id`) WHERE "coupons"."redeemed_by_org_id" is not null;--> statement-breakpoint
CREATE INDEX `idx_coupon_group_status` ON `coupons` (`group_id`,`status`);