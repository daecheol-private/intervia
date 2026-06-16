import { db } from "./db";
import {
  candidates,
  candidateAttachments,
  interviewTranscriptSegments,
  recordedInterviews,
} from "./schema";
import { and, eq, inArray, lt, sql, isNotNull } from "drizzle-orm";
import { deleteFile } from "./storage";
import { deleteAttachmentsForCandidate } from "./candidate-files";

const DEFAULT_PURGE_DAYS = 30;

/**
 * 평가 완료된 후보자의 마스킹 텍스트 + 원본 파일 자동 삭제.
 *
 * 조건:
 *  - status in (screened, interviewed, failed)
 *  - created_at < now - N일
 *  - resume_masked_text 또는 resume_file_path 가 남아있음
 *  - outcome != 'hired' (합격자는 입사 절차상 보존)
 *
 * 평가 결과(screeningReport, evaluation, 점수)는 그대로 보존.
 * — 최소보유 원칙(본문·파일 조기 파기): 식별 가능성 제거가 목적, 평가 메타 폐기 아님.
 * — 원본(resume_text)은 업로드 시점에 이미 저장 안 함.
 */
export async function purgeExpiredOriginals(
  daysOverride?: number
): Promise<{
  purgedCount: number;
  failedFiles: number;
  purgedTranscriptInterviews: number;
}> {
  const days = daysOverride ?? Number(process.env.PURGE_AFTER_DAYS ?? DEFAULT_PURGE_DAYS);
  const cutoff = sql`datetime('now', ${`-${days} days`})`;

  // 폐기 대상: 마스킹 텍스트가 있고 (=업로드 후 마스킹 끝남) 일정 기간 경과한 후보.
  // 큐 진행 중이어도 마스킹 텍스트가 LLM 입력으로 충분하므로 원본은 안전하게 제거 가능.
  const targets = await db
    .select({
      id: candidates.id,
      filePath: candidates.resumeFilePath,
    })
    .from(candidates)
    .where(
      and(
        lt(candidates.createdAt, cutoff),
        isNotNull(candidates.resumeMaskedText),
        // 합격자는 입사 절차상 보존 — purge 제외
        sql`(${candidates.outcome} IS NULL OR ${candidates.outcome} != 'hired')`
      )
    );

  let failedFiles = 0;
  for (const t of targets) {
    if (t.filePath) {
      try {
        await deleteFile(t.filePath);
      } catch (e) {
        console.error(`purge: file delete failed (cid=${t.id})`, e);
        failedFiles++;
      }
    }
    // 첨부(포트폴리오·자소서 등) 원본 파일·행도 폐기 — 메인 이력서만 지우면 첨부 PII 가
    // 공고 종결(+7/+14일) 전까지 남아 "+30일 원본 폐기" 최소보유 원칙이 깨진다.
    await deleteAttachmentsForCandidate(t.id).catch(() => {});
    await db
      .delete(candidateAttachments)
      .where(eq(candidateAttachments.candidateId, t.id));
    await db
      .update(candidates)
      .set({ resumeText: "", resumeMaskedText: null, resumeFilePath: "" })
      .where(eq(candidates.id, t.id));
  }

  // 대면 면접 전사도 +N일 경과 시 폐기 (음성 발화 = PII). 평가 리포트(recorded_interviews.report)는 보존.
  // 합격자(outcome='hired')는 입사 절차상 제외 — 이력서 폐기 정책과 동일 기준.
  const oldRis = await db
    .select({ id: recordedInterviews.id })
    .from(recordedInterviews)
    .innerJoin(candidates, eq(candidates.id, recordedInterviews.candidateId))
    .where(
      and(
        lt(candidates.createdAt, cutoff),
        sql`(${candidates.outcome} IS NULL OR ${candidates.outcome} != 'hired')`
      )
    );
  const riIds = oldRis.map((r) => r.id);
  if (riIds.length > 0) {
    await db
      .delete(interviewTranscriptSegments)
      .where(inArray(interviewTranscriptSegments.recordedInterviewId, riIds));
  }

  return {
    purgedCount: targets.length,
    failedFiles,
    purgedTranscriptInterviews: riIds.length,
  };
}
