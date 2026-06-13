ALTER TABLE `users` ADD `setup_guide_dismissed_at` text;--> statement-breakpoint
-- 가이드 숨김을 법인 단위(organizations) → 개인 단위(users)로 이관.
-- 기존에 org 단위로 이미 숨긴 법인의 멤버 전원에게 개인 숨김 시각을 backfill 하여,
-- 정책 전환 후 위젯이 해당 법인 구성원들에게 다시 노출되지 않게 한다. (비파괴적 UPDATE)
UPDATE `users` SET `setup_guide_dismissed_at` = (
  SELECT `setup_guide_dismissed_at` FROM `organizations`
  WHERE `organizations`.`id` = `users`.`org_id`
)
WHERE `setup_guide_dismissed_at` IS NULL
  AND `org_id` IN (
    SELECT `id` FROM `organizations` WHERE `setup_guide_dismissed_at` IS NOT NULL
  );
