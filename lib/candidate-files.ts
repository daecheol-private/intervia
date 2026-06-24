/**
 * 후보자 관련 파일(메인 이력서 + 첨부) 일괄 삭제.
 *
 * 호출 시점:
 *   - 후보자 단건/일괄 삭제
 *   - 결정(합·불·withdrawn) 시 PIPA 보유기간 정책 (purgeOnDecision 에서 별도 처리)
 *
 * 동작: 각 파일 best-effort 삭제. 한 파일 실패해도 다른 파일은 계속 시도.
 * 같은 경로(메인 이력서가 attachments 에도 등재된 케이스) 는 dedup.
 */
import { db } from "./db";
import { candidates, candidateAttachments } from "./schema";
import { eq, inArray } from "drizzle-orm";
import { deleteFile } from "./storage";

export async function deleteCandidateFiles(
  candidateIds: number[]
): Promise<{ deletedFiles: number; errors: number }> {
  if (candidateIds.length === 0) return { deletedFiles: 0, errors: 0 };

  // 메인 이력서 경로 + 증명사진 경로
  const resumeRows = await db
    .select({
      id: candidates.id,
      filePath: candidates.resumeFilePath,
      photoPath: candidates.photoFilePath,
    })
    .from(candidates)
    .where(inArray(candidates.id, candidateIds));

  // 첨부 파일 경로
  const attRows = await db
    .select({ id: candidateAttachments.id, filePath: candidateAttachments.filePath })
    .from(candidateAttachments)
    .where(inArray(candidateAttachments.candidateId, candidateIds));

  // 중복 제거 — 같은 파일 두 번 삭제 시도 방지
  const paths = new Set<string>();
  for (const r of resumeRows) {
    if (r.filePath) paths.add(r.filePath);
    if (r.photoPath) paths.add(r.photoPath);
  }
  for (const r of attRows) {
    if (r.filePath) paths.add(r.filePath);
  }

  let deletedFiles = 0;
  let errors = 0;
  await Promise.all(
    [...paths].map(async (p) => {
      try {
        await deleteFile(p);
        deletedFiles++;
      } catch (e) {
        errors++;
        console.error(`[candidate-files] delete failed for ${p}:`, e);
      }
    })
  );

  return { deletedFiles, errors };
}

/** 단일 후보자용 wrapper. */
export async function deleteFilesForCandidate(
  candidateId: number
): Promise<{ deletedFiles: number; errors: number }> {
  return deleteCandidateFiles([candidateId]);
}

/** 한 후보자의 첨부만 모두 폐기 (이력서는 별도 처리). 결정 시 purgeOnDecision 에서 활용 가능. */
export async function deleteAttachmentsForCandidate(
  candidateId: number
): Promise<number> {
  const rows = await db
    .select({ id: candidateAttachments.id, filePath: candidateAttachments.filePath })
    .from(candidateAttachments)
    .where(eq(candidateAttachments.candidateId, candidateId));
  let n = 0;
  for (const r of rows) {
    if (r.filePath) {
      try {
        await deleteFile(r.filePath);
        n++;
      } catch (e) {
        console.error(`[candidate-files] attachment delete failed:`, e);
      }
    }
  }
  return n;
}
