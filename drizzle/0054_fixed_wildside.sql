ALTER TABLE `organizations` ADD `subdomain` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_org_subdomain` ON `organizations` (`subdomain`);