CREATE TABLE `mail_send_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sent_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`audience` text NOT NULL,
	`kind` text
);
--> statement-breakpoint
CREATE INDEX `idx_mail_send_events_sent_at` ON `mail_send_events` (`sent_at`);--> statement-breakpoint
ALTER TABLE `candidates` ADD `decision_notify_queued` integer DEFAULT false NOT NULL;