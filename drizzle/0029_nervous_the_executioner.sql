CREATE TABLE `org_domain_reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`reviewer_org_id` integer NOT NULL,
	`target_org_id` integer NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`reviewed_by_user_id` integer,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`reviewer_org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `org_domain_reviews_pair_uq` ON `org_domain_reviews` (`reviewer_org_id`,`target_org_id`);