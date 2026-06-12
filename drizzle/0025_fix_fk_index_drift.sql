-- 드리프트 복구 (2026-06-13). 운영 Turso 는 초기 테이블이 db:push 로 선생성된 이력이 있어
-- 스키마(lib/schema.ts)와 실제 DB 의 FK ON DELETE 절·인덱스가 어긋나 있다:
--   1. interview_sessions.created_by_user_id → users: ON DELETE 절 누락(NO ACTION)
--      → 멤버 계정/법인 삭제가 FK 제약 위반으로 500 (0017 의 ADD COLUMN 에 ON DELETE 누락)
--   2. interview_schedules.meeting_link_sent_by_user_id → users: 운영에 FK 자체가 없음
--   3. job_postings.applicant_consent_confirmed_by_user_id → users: 운영에 FK 자체가 없음
--   4. interview_schedules / org_invites / password_resets 토큰 unique 인덱스 운영 누락
--   5. organizations.idx_org_email_domain 이 운영에선 아직 UNIQUE (스키마는 비unique — 같은 도메인 복수 법인 허용)
-- SQLite 는 FK 절 변경에 ALTER 를 지원하지 않으므로 1~3 은 테이블 재생성으로 해결한다.
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
-- FK 가드: 이 연결에서 foreign_keys=OFF 가 실제 적용되지 않았다면 아래 INSERT 가
-- FK 위반으로 실패해 마이그레이션이 여기서 중단된다. (FK ON 상태로 아래 DROP TABLE 에
-- 도달하면 자식 테이블 ON DELETE CASCADE 가 발동해 candidates 등이 연쇄 삭제되므로 필수.)
CREATE TABLE `__fk_off_guard` (`user_id` integer REFERENCES `users`(`id`));
--> statement-breakpoint
INSERT INTO `__fk_off_guard` (`user_id`) VALUES (-1);
--> statement-breakpoint
DROP TABLE `__fk_off_guard`;
--> statement-breakpoint
CREATE TABLE `__new_interview_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`candidate_id` integer NOT NULL,
	`created_by_user_id` integer,
	`access_token` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`messages` text DEFAULT '[]' NOT NULL,
	`evaluation` text,
	`personality_responses` text,
	`personality_profile` text,
	`started_at` text,
	`completed_at` text,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_interview_sessions` (`id`,`candidate_id`,`created_by_user_id`,`access_token`,`status`,`messages`,`evaluation`,`personality_responses`,`personality_profile`,`started_at`,`completed_at`,`expires_at`,`created_at`)
SELECT `id`,`candidate_id`,`created_by_user_id`,`access_token`,`status`,`messages`,`evaluation`,`personality_responses`,`personality_profile`,`started_at`,`completed_at`,`expires_at`,`created_at` FROM `interview_sessions`;
--> statement-breakpoint
DROP TABLE `interview_sessions`;
--> statement-breakpoint
ALTER TABLE `__new_interview_sessions` RENAME TO `interview_sessions`;
--> statement-breakpoint
CREATE UNIQUE INDEX `interview_sessions_access_token_unique` ON `interview_sessions` (`access_token`);
--> statement-breakpoint
CREATE INDEX `idx_interview_sessions_candidate` ON `interview_sessions` (`candidate_id`);
--> statement-breakpoint
CREATE INDEX `idx_interview_sessions_status_expires` ON `interview_sessions` (`status`,`expires_at`);
--> statement-breakpoint
CREATE TABLE `__new_interview_schedules` (
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
	`interviewer_reminder_sent_at` text,
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
INSERT INTO `__new_interview_schedules` (`id`,`candidate_id`,`job_id`,`org_id`,`round`,`access_token`,`proposed_slots`,`mode_online`,`address`,`address_detail`,`online_meeting_url`,`online_meeting_note`,`meeting_link_sent_at`,`meeting_link_sent_by_user_id`,`interviewer_reminder_sent_at`,`selected_slot`,`counter_slots`,`candidate_note`,`status`,`proposed_by_user_id`,`expires_at`,`responded_at`,`created_at`,`updated_at`)
SELECT `id`,`candidate_id`,`job_id`,`org_id`,`round`,`access_token`,`proposed_slots`,`mode_online`,`address`,`address_detail`,`online_meeting_url`,`online_meeting_note`,`meeting_link_sent_at`,`meeting_link_sent_by_user_id`,`interviewer_reminder_sent_at`,`selected_slot`,`counter_slots`,`candidate_note`,`status`,`proposed_by_user_id`,`expires_at`,`responded_at`,`created_at`,`updated_at` FROM `interview_schedules`;
--> statement-breakpoint
DROP TABLE `interview_schedules`;
--> statement-breakpoint
ALTER TABLE `__new_interview_schedules` RENAME TO `interview_schedules`;
--> statement-breakpoint
CREATE UNIQUE INDEX `interview_schedules_access_token_unique` ON `interview_schedules` (`access_token`);
--> statement-breakpoint
CREATE INDEX `idx_interview_schedules_candidate` ON `interview_schedules` (`candidate_id`);
--> statement-breakpoint
CREATE INDEX `idx_interview_schedules_job` ON `interview_schedules` (`job_id`);
--> statement-breakpoint
CREATE INDEX `idx_interview_schedules_status_expires` ON `interview_schedules` (`status`,`expires_at`);
--> statement-breakpoint
CREATE TABLE `__new_job_postings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`org_id` integer,
	`title` text NOT NULL,
	`position` text NOT NULL,
	`level` text NOT NULL,
	`employment_type` text NOT NULL,
	`responsibilities` text NOT NULL,
	`requirements` text NOT NULL,
	`requirement_checklist` text DEFAULT '' NOT NULL,
	`ideal_profile` text DEFAULT '' NOT NULL,
	`trait_profile` text,
	`evaluation_focus` text DEFAULT '' NOT NULL,
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
INSERT INTO `__new_job_postings` (`id`,`org_id`,`title`,`position`,`level`,`employment_type`,`responsibilities`,`requirements`,`requirement_checklist`,`ideal_profile`,`trait_profile`,`evaluation_focus`,`tone`,`interview_duration_minutes`,`password_hash`,`created_by_user_id`,`applicant_consent_confirmed_at`,`applicant_consent_confirmed_by_user_id`,`status`,`published_at`,`closes_at`,`closed_at`,`extension_count`,`created_at`)
SELECT `id`,`org_id`,`title`,`position`,`level`,`employment_type`,`responsibilities`,`requirements`,`requirement_checklist`,`ideal_profile`,`trait_profile`,`evaluation_focus`,`tone`,`interview_duration_minutes`,`password_hash`,`created_by_user_id`,`applicant_consent_confirmed_at`,`applicant_consent_confirmed_by_user_id`,`status`,`published_at`,`closes_at`,`closed_at`,`extension_count`,`created_at` FROM `job_postings`;
--> statement-breakpoint
DROP TABLE `job_postings`;
--> statement-breakpoint
ALTER TABLE `__new_job_postings` RENAME TO `job_postings`;
--> statement-breakpoint
CREATE INDEX `idx_job_postings_org` ON `job_postings` (`org_id`);
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_org_email_domain`;
--> statement-breakpoint
CREATE INDEX `idx_org_email_domain` ON `organizations` (`email_domain`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `org_invites_token_unique` ON `org_invites` (`token`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `password_resets_token_unique` ON `password_resets` (`token`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
