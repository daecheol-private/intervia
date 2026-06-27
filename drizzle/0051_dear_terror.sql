CREATE TABLE `candidate_comment_reads` (
	`user_id` integer NOT NULL,
	`candidate_id` integer NOT NULL,
	`last_read_comment_id` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_comment_reads_pk` ON `candidate_comment_reads` (`user_id`,`candidate_id`);--> statement-breakpoint
CREATE INDEX `idx_comment_reads_candidate` ON `candidate_comment_reads` (`candidate_id`);