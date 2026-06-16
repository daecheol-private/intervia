ALTER TABLE `recorded_interviews` ADD `consent_confirmed_at` text;--> statement-breakpoint
ALTER TABLE `recorded_interviews` ADD `consent_confirmed_by_user_id` integer REFERENCES users(id);