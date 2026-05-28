CREATE TABLE `api_rate_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scope` text NOT NULL,
	`identifier` text NOT NULL,
	`attempted_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `appeal_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`candidate_id` integer NOT NULL,
	`interview_session_id` integer NOT NULL,
	`email` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`ip` text,
	`user_agent` text,
	`reviewed_by_user_id` integer,
	`reviewed_at` text,
	`response` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_user_id` integer,
	`actor_role` text,
	`org_id` integer,
	`action` text NOT NULL,
	`resource_type` text,
	`resource_id` integer,
	`ip` text,
	`user_agent` text,
	`metadata` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `auth_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`identifier` text NOT NULL,
	`kind` text NOT NULL,
	`success` integer NOT NULL,
	`user_agent` text,
	`attempted_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `candidate_attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`candidate_id` integer NOT NULL,
	`kind` text DEFAULT 'other' NOT NULL,
	`file_path` text NOT NULL,
	`original_name` text NOT NULL,
	`mime` text,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`masked_text` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `candidates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer,
	`job_id` integer NOT NULL,
	`uploaded_by_user_id` integer,
	`resume_hash` text,
	`name` text NOT NULL,
	`email` text,
	`phone` text,
	`age` integer,
	`career_years` integer,
	`career_summary` text,
	`resume_file_path` text NOT NULL,
	`resume_text` text NOT NULL,
	`resume_masked_text` text,
	`screening_score` integer,
	`screening_report` text,
	`stage` text DEFAULT 'applied' NOT NULL,
	`outcome` text,
	`outcome_reason` text,
	`decided_at` text,
	`decided_by_user_id` integer,
	`decision_note` text,
	`decision_from_stage` text,
	`interview_email_count` integer DEFAULT 0 NOT NULL,
	`decision_email_count` integer DEFAULT 0 NOT NULL,
	`last_interview_email_sent_at` text,
	`pii_purged_at` text,
	`applicant_consent_confirmed_at` text,
	`applicant_consent_confirmed_by_user_id` integer,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `job_postings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`decided_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`applicant_consent_confirmed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `consent_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`interview_session_id` integer NOT NULL,
	`candidate_id` integer NOT NULL,
	`consent_version` text NOT NULL,
	`consents` text NOT NULL,
	`ip` text,
	`user_agent` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `email_verifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`token` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_verifications_token_unique` ON `email_verifications` (`token`);--> statement-breakpoint
CREATE TABLE `interview_schedules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`candidate_id` integer NOT NULL,
	`job_id` integer NOT NULL,
	`org_id` integer,
	`round` text DEFAULT 'round1' NOT NULL,
	`access_token` text NOT NULL,
	`proposed_slots` text NOT NULL,
	`mode_online` integer DEFAULT true NOT NULL,
	`address` text,
	`address_detail` text,
	`online_meeting_url` text,
	`online_meeting_note` text,
	`meeting_link_sent_at` text,
	`meeting_link_sent_by_user_id` integer,
	`selected_slot` text,
	`counter_slots` text,
	`candidate_note` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`proposed_by_user_id` integer,
	`expires_at` text NOT NULL,
	`responded_at` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `job_postings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`meeting_link_sent_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`proposed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `interview_schedules_access_token_unique` ON `interview_schedules` (`access_token`);--> statement-breakpoint
CREATE TABLE `interview_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`candidate_id` integer NOT NULL,
	`access_token` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`messages` text DEFAULT '[]' NOT NULL,
	`evaluation` text,
	`started_at` text,
	`completed_at` text,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `interview_sessions_access_token_unique` ON `interview_sessions` (`access_token`);--> statement-breakpoint
CREATE TABLE `interviewer_assignments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`candidate_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`assigned_by_user_id` integer,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assigned_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `interviewer_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`candidate_id` integer NOT NULL,
	`author_user_id` integer NOT NULL,
	`interview_session_id` integer,
	`scores` text,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `job_interviewers` (
	`job_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`assigned_by_user_id` integer,
	`assigned_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `job_postings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assigned_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_job_interviewers_pk` ON `job_interviewers` (`job_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `job_postings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer,
	`title` text NOT NULL,
	`position` text NOT NULL,
	`level` text NOT NULL,
	`employment_type` text NOT NULL,
	`responsibilities` text NOT NULL,
	`requirements` text NOT NULL,
	`ideal_profile` text DEFAULT '' NOT NULL,
	`tone` text DEFAULT '중립적인' NOT NULL,
	`interview_duration_minutes` integer DEFAULT 20 NOT NULL,
	`password_hash` text,
	`created_by_user_id` integer,
	`applicant_consent_confirmed_at` text,
	`applicant_consent_confirmed_by_user_id` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`published_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`closes_at` text NOT NULL,
	`closed_at` text,
	`extension_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`applicant_consent_confirmed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`href` text NOT NULL,
	`payload` text,
	`read_at` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `org_invites` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token` text NOT NULL,
	`org_id` integer NOT NULL,
	`email` text NOT NULL,
	`job_id` integer,
	`invited_by_user_id` integer,
	`expires_at` text NOT NULL,
	`used_at` text,
	`used_by_user_id` integer,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `job_postings`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`invited_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`used_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `org_invites_token_unique` ON `org_invites` (`token`);--> statement-breakpoint
CREATE TABLE `org_join_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_by_user_id` integer,
	`decided_at` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`decided_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `org_smtp_configs` (
	`org_id` integer PRIMARY KEY NOT NULL,
	`host` text NOT NULL,
	`port` integer DEFAULT 465 NOT NULL,
	`secure` integer DEFAULT true NOT NULL,
	`auth_user` text NOT NULL,
	`auth_pass` text NOT NULL,
	`from_email` text NOT NULL,
	`from_name` text,
	`last_checked_at` text,
	`last_check_status` text,
	`last_check_error` text,
	`updated_by_user_id` integer,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`biz_registration_no` text,
	`email_domain` text,
	`office_address` text,
	`office_address_detail` text,
	`suspended_at` text,
	`suspended_reason` text,
	`verification_status` text DEFAULT 'pending_review' NOT NULL,
	`verified_at` text,
	`verified_by_user_id` integer,
	`verification_note` text,
	`created_by_user_id` integer,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_org_email_domain` ON `organizations` (`email_domain`);--> statement-breakpoint
CREATE TABLE `password_resets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`token` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`requested_ip` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `password_resets_token_unique` ON `password_resets` (`token`);--> statement-breakpoint
CREATE TABLE `payment_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`amount_krw` integer NOT NULL,
	`tokens` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`provider` text,
	`provider_ref` text,
	`created_by_user_id` integer,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `screening_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`candidate_id` integer NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`not_before` text,
	`locked_at` text,
	`locked_by` text,
	`last_error` text,
	`enqueued_by_user_id` integer,
	`started_at` text,
	`completed_at` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`enqueued_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`ip` text,
	`user_agent` text,
	`last_seen_at` text,
	`expires_at` text NOT NULL,
	`step_up_verified_at` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `token_ledger` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer NOT NULL,
	`delta` integer NOT NULL,
	`reason` text NOT NULL,
	`ref_type` text,
	`ref_id` integer,
	`balance_after` integer NOT NULL,
	`created_by_user_id` integer,
	`memo` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `token_pricing` (
	`feature_key` text PRIMARY KEY NOT NULL,
	`cost` integer NOT NULL,
	`updated_by_user_id` integer,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `token_wallets` (
	`org_id` integer PRIMARY KEY NOT NULL,
	`balance` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_candidate_favorites` (
	`user_id` integer NOT NULL,
	`candidate_id` integer NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_user_candidate_favorites_pk` ON `user_candidate_favorites` (`user_id`,`candidate_id`);--> statement-breakpoint
CREATE TABLE `user_job_favorites` (
	`user_id` integer NOT NULL,
	`job_id` integer NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `job_postings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_user_job_favorites_pk` ON `user_job_favorites` (`user_id`,`job_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`name` text NOT NULL,
	`is_admin` integer DEFAULT false NOT NULL,
	`org_id` integer,
	`role` text DEFAULT 'member' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`email_verified_at` text,
	`terms_accepted_at` text,
	`terms_version` text,
	`terms_accepted_ip` text,
	`terms_accepted_ua` text,
	`privacy_accepted_at` text,
	`privacy_version` text,
	`privacy_accepted_ip` text,
	`privacy_accepted_ua` text,
	`totp_secret` text,
	`totp_enabled_at` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);