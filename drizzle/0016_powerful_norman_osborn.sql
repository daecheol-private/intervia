CREATE TABLE `marketing_recipients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`unsubscribe_token` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_sent_at` text,
	`unsubscribed_at` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `marketing_recipients_email_uq` ON `marketing_recipients` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `marketing_recipients_token_uq` ON `marketing_recipients` (`unsubscribe_token`);