ALTER TABLE `candidates` ADD `identity_reported_at` text;--> statement-breakpoint
ALTER TABLE `candidates` ADD `identity_report_new_candidate_id` integer;--> statement-breakpoint
ALTER TABLE `candidates` ADD `identity_report_of` integer;