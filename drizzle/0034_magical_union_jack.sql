ALTER TABLE `recorded_interviews` ADD `audio_blob_key` text;--> statement-breakpoint
ALTER TABLE `recorded_interviews` ADD `audio_mime` text;--> statement-breakpoint
ALTER TABLE `recorded_interviews` ADD `attempts` integer DEFAULT 0 NOT NULL;