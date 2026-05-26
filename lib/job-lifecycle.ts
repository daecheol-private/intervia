/**
 * 공고 라이프사이클 — 게시 / 종결 / 연장 / 자동 폐기.
 *
 * 정책 (사용자 결정 2026-05-26):
 *  - 공고 기본 기간 1개월 (30일)
 *  - 1개월(30일) 단위 연장. 연장 시점 (현재 candidates 수) × resume_upload 단가 차감
 *  - 종결 +7일 → 이력서·포트폴리오 PDF 파일 폐기
 *  - 종결 +14일 → candidates PII 폐기 (job_postings 행은 보존)
 *  - 종결된 공고: 신규 이력서 업로드 불가
 *  - 이메일 발송 한도: 면접링크 10회, 결정통보 10회 (후보자당)
 */
import { db } from "./db";
import {
  jobPostings,
  candidates,
  candidateAttachments,
  appealLogs,
  consentLogs,
  tokenWallets,
  tokenLedger,
} from "./schema";
import { and, count, eq, lt, sql } from "drizzle-orm";
import { deleteFile } from "./storage";
import { getBalance, getPricing } from "./tokens";

export const DEFAULT_JOB_DURATION_DAYS = 30;
export const EXTENSION_DAYS = 30;
export const PDF_PURGE_DAYS_AFTER_CLOSE = 7;
export const PII_PURGE_DAYS_AFTER_CLOSE = 14;

/** 연장 버튼 노출 시점 — 종결 D-14 이내일 때만. */
export const EXTEND_VISIBLE_WITHIN_DAYS = 14;

export const MAX_INTERVIEW_EMAILS_PER_CANDIDATE = 10;
export const MAX_DECISION_EMAILS_PER_CANDIDATE = 10;

/** 신규 공고 게시 시 사용할 종결 예정일 (ISO). */
export function defaultClosesAt(from = new Date()): string {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + DEFAULT_JOB_DURATION_DAYS);
  return d.toISOString();
}

/** 연장 후 종결 예정일. 현재 closes_at 기준으로 +30일. */
export function extendClosesAt(currentClosesAt: string): string {
  const d = new Date(currentClosesAt);
  d.setUTCDate(d.getUTCDate() + EXTENSION_DAYS);
  return d.toISOString();
}

/**
 * 공고 1개월 연장. 토큰 = 현재 후보자 수 × resume_upload 단가.
 * 후보자 0명이면 무료.
 */
export async function extendJob(args: {
  jobId: number;
  orgId: number;
  userId: number;
  monthsDefault?: 1;
}): Promise<
  | {
      ok: true;
      newClosesAt: string;
      candidateCount: number;
      perResume: number;
      totalCost: number;
      extensionCount: number;
    }
  | { ok: false; code: string; message: string }
> {
  const [job] = await db
    .select()
    .from(jobPostings)
    .where(eq(jobPostings.id, args.jobId));
  if (!job) return { ok: false, code: "not_found", message: "공고 없음" };

  // 가드: 종결 14일 이내일 때만 연장 허용 (너무 이르게 연장하면 이력서 0건 상태 악용)
  if (job.status === "active" && job.closesAt) {
    const dLeft = Math.ceil(
      (new Date(job.closesAt).getTime() - Date.now()) / 86_400_000
    );
    if (dLeft > EXTEND_VISIBLE_WITHIN_DAYS) {
      return {
        ok: false,
        code: "too_early",
        message: `종결 ${EXTEND_VISIBLE_WITHIN_DAYS}일 전부터 연장 가능합니다. (현재 D-${dLeft})`,
      };
    }
  }

  const [{ n }] = await db
    .select({ n: count(candidates.id) })
    .from(candidates)
    .where(eq(candidates.jobId, args.jobId));
  const candidateCount = Number(n ?? 0);
  const perResume = await getPricing("resume_upload");
  const totalCost = candidateCount * perResume;

  // 가드: 이력서 0건이면 연장 불필요·악용 방지 (미리 연장해두고 이력서 받으면 보관료 회피)
  if (candidateCount === 0) {
    return {
      ok: false,
      code: "no_candidates",
      message: "등록된 이력서가 없어 연장할 필요가 없습니다. 이력서 등록 후 다시 시도해 주세요.",
    };
  }

  const nextExtCount = job.extensionCount + 1;
  if (totalCost > 0) {
    const balanceBefore = await getBalance(args.orgId);
    if (balanceBefore < totalCost)
      return {
        ok: false,
        code: "insufficient_tokens",
        message: `잔액 부족 — 필요 ${totalCost} 토큰 (현재 ${balanceBefore})`,
      };
    // 직접 wallet 업데이트 + ledger 기록. job_extend 는 tokens.ts 단가 테이블에 없으므로
    // chargeFeature 우회. extensionCount 를 ref 에 포함시켜 중복 차감 방지.
    const newBalance = balanceBefore - totalCost;
    await db
      .update(tokenWallets)
      .set({ balance: newBalance, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(tokenWallets.orgId, args.orgId));
    await db.insert(tokenLedger).values({
      orgId: args.orgId,
      delta: -totalCost,
      reason: "job_extend",
      refType: "job_extension",
      refId: args.jobId,
      balanceAfter: newBalance,
      createdByUserId: args.userId,
      memo: `공고 #${args.jobId} ${EXTENSION_DAYS}일 연장 #${nextExtCount} (${candidateCount}명 × ${perResume})`,
    });
  }

  const newClosesAt = extendClosesAt(
    job.closesAt ?? new Date().toISOString()
  );
  await db
    .update(jobPostings)
    .set({
      closesAt: newClosesAt,
      status: "active",
      closedAt: null,
      extensionCount: nextExtCount,
    })
    .where(eq(jobPostings.id, args.jobId));

  return {
    ok: true,
    newClosesAt,
    candidateCount,
    perResume,
    totalCost,
    extensionCount: nextExtCount,
  };
}

/** 만료된 active 공고를 closed 로 전환. */
export async function closeExpiredJobs(): Promise<number> {
  const rows = await db
    .select({ id: jobPostings.id })
    .from(jobPostings)
    .where(
      and(
        eq(jobPostings.status, "active"),
        lt(jobPostings.closesAt, sql`CURRENT_TIMESTAMP`)
      )
    );
  if (rows.length === 0) return 0;
  await db
    .update(jobPostings)
    .set({ status: "closed", closedAt: sql`CURRENT_TIMESTAMP` })
    .where(
      and(
        eq(jobPostings.status, "active"),
        lt(jobPostings.closesAt, sql`CURRENT_TIMESTAMP`)
      )
    );
  return rows.length;
}

/** 종결 +7일 경과 공고의 candidates PDF + attachments 파일을 삭제. */
export async function purgePdfsAfterClose(): Promise<{
  purgedFiles: number;
  failedFiles: number;
  affectedCandidates: number;
}> {
  const cutoff = sql`datetime('now', '-${sql.raw(String(PDF_PURGE_DAYS_AFTER_CLOSE))} days')`;
  const targets = await db
    .select({ id: candidates.id, filePath: candidates.resumeFilePath })
    .from(candidates)
    .innerJoin(jobPostings, eq(jobPostings.id, candidates.jobId))
    .where(
      and(
        eq(jobPostings.status, "closed"),
        lt(jobPostings.closedAt, cutoff)
      )
    );
  let purgedFiles = 0;
  let failedFiles = 0;
  const candidateIds: number[] = [];
  for (const t of targets) {
    candidateIds.push(t.id);
    if (t.filePath) {
      try {
        await deleteFile(t.filePath);
        purgedFiles++;
      } catch (e) {
        console.error(`purgePdfs: file delete failed (cid=${t.id})`, e);
        failedFiles++;
      }
    }
    const atts = await db
      .select({ id: candidateAttachments.id, filePath: candidateAttachments.filePath })
      .from(candidateAttachments)
      .where(eq(candidateAttachments.candidateId, t.id));
    for (const a of atts) {
      if (a.filePath) {
        try {
          await deleteFile(a.filePath);
          purgedFiles++;
        } catch (e) {
          console.error(`purgePdfs: attachment delete failed (aid=${a.id})`, e);
          failedFiles++;
        }
      }
    }
    await db
      .delete(candidateAttachments)
      .where(eq(candidateAttachments.candidateId, t.id));
    await db
      .update(candidates)
      .set({
        resumeFilePath: "",
        resumeText: "",
        resumeMaskedText: null,
      })
      .where(eq(candidates.id, t.id));
  }
  return {
    purgedFiles,
    failedFiles,
    affectedCandidates: candidateIds.length,
  };
}

/**
 * 종결 +14일 경과 공고의 candidates 통째 삭제.
 * job_postings 행은 보존 (이력). appeal/consent 로그는 PII 마스킹 후 유지 (감사·법적 추적용).
 *
 * 익명화 + score 보존은 의미 없음 — 후보자 특정 불가능한 점수는 통계 가치 X.
 * 결정 시점 ~ +14일은 운영 마무리 안전 버퍼, 그 뒤엔 완전 소거.
 */
export async function purgePiiAfterClose(): Promise<{
  deletedCandidates: number;
}> {
  const cutoff = sql`datetime('now', '-${sql.raw(String(PII_PURGE_DAYS_AFTER_CLOSE))} days')`;
  const targets = await db
    .select({ id: candidates.id })
    .from(candidates)
    .innerJoin(jobPostings, eq(jobPostings.id, candidates.jobId))
    .where(
      and(
        eq(jobPostings.status, "closed"),
        lt(jobPostings.closedAt, cutoff)
      )
    );

  for (const t of targets) {
    // appeal / consent — PII 마스킹 후 유지 (감사·법적 추적용. candidate_id 는 dangling FK가 되지만 의도된 동작)
    await db
      .update(appealLogs)
      .set({ email: "[purged]", ip: null, userAgent: null })
      .where(eq(appealLogs.candidateId, t.id));
    await db
      .update(consentLogs)
      .set({ ip: null, userAgent: null })
      .where(eq(consentLogs.candidateId, t.id));
    // candidates 행 삭제 → cascade 로 interview_sessions / interviewer_notes /
    // interviewer_assignments / candidate_attachments / screening_jobs 모두 정리
    await db.delete(candidates).where(eq(candidates.id, t.id));
  }

  return { deletedCandidates: targets.length };
}

/** 한 사이클 — close → purge pdf → purge pii. */
export async function runLifecycleSweep(): Promise<{
  closed: number;
  pdfPurge: Awaited<ReturnType<typeof purgePdfsAfterClose>>;
  piiPurge: Awaited<ReturnType<typeof purgePiiAfterClose>>;
}> {
  const closed = await closeExpiredJobs();
  const pdfPurge = await purgePdfsAfterClose();
  const piiPurge = await purgePiiAfterClose();
  return { closed, pdfPurge, piiPurge };
}
