ALTER TABLE `interview_question_sheets` ADD `status` text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE `interview_question_sheets` ADD `gen_error` text;