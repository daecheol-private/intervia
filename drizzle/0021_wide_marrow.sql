DROP INDEX `interview_question_sheets_candidate_id_unique`;--> statement-breakpoint
ALTER TABLE `interview_question_sheets` ADD `round` text DEFAULT 'round1' NOT NULL;--> statement-breakpoint
ALTER TABLE `interview_question_sheets` ADD `based_on_culture_fit` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `interview_question_sheets_candidate_round_uq` ON `interview_question_sheets` (`candidate_id`,`round`);