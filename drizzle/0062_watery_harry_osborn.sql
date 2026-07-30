CREATE TABLE `org_addresses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`address` text NOT NULL,
	`address_detail` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_org_addresses_org` ON `org_addresses` (`org_id`);--> statement-breakpoint
INSERT INTO `org_addresses` (`org_id`, `address`, `address_detail`) SELECT `id`, `office_address`, `office_address_detail` FROM `organizations` WHERE `office_address` IS NOT NULL AND trim(`office_address`) <> '';