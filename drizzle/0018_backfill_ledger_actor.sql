-- 과거 resume_upload 차감 내역의 "누가" 백필 — screening_jobs.enqueued_by_user_id 로 역추적.
-- (interview 차감은 구 세션에 발급자 기록이 없어 백필 불가, job_post 는 처음부터 기록됨)
UPDATE token_ledger
SET created_by_user_id = (
  SELECT enqueued_by_user_id FROM screening_jobs WHERE id = token_ledger.ref_id
)
WHERE reason = 'resume_upload'
  AND ref_type = 'screening_job'
  AND created_by_user_id IS NULL;
