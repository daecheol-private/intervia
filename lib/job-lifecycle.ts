/**
 * 공고 라이프사이클 — 게시 / 종결 / 연장 / 자동 폐기.
 *
 * 정책 (사용자 결정 2026-05-26):
 *  - 공고 기본 기간 1개월 (30일)
 *  - 1개월(30일) 단위 연장. 연장 시점 (보관 중 이력서 수) × resume_upload 단가 차감
 *    (불합격·지원취소 이력서는 결정 즉시 파일이 폐기되어 보관비용이 없으므로 과금 제외)
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
  interviewSessions as sessions,
  interviewSchedules as schedules,
  organizations,
  inquiries,
  notifications,
} from "./schema";
import { and, count, eq, lt, sql } from "drizzle-orm";
import { deleteFile } from "./storage";
import { deleteCandidateFiles } from "./candidate-files";
import { createNotification } from "./notifications";
import { getBalance, getPricing, writeLedgerIdempotent } from "./tokens";
import { buildDecisionEmail, purgeOnDecision, resolveCandidateEmailLang } from "./candidate-stage";
import { sendMail } from "./mailer";
import { redactCandidateAuditPii } from "./audit";
import { after } from "next/server";

export const DEFAULT_JOB_DURATION_DAYS = 30;
export const EXTENSION_DAYS = 30;
export const PDF_PURGE_DAYS_AFTER_CLOSE = 7;
export const PII_PURGE_DAYS_AFTER_CLOSE = 14;
/**
 * 만료(closesAt 지남) 후에도 HR 이 연장·종결 결정을 미루면
 * 이 일수 후에 공고 자체를 자동 삭제 (cascade 로 후보자 포함).
 */
export const UNRESOLVED_EXPIRED_DELETE_DAYS = 14;
/** 정식 전환 안 된 임시 공고(isDraft)를 생성 후 이 일수 경과 시 자동 폐기. */
export const DRAFT_TTL_DAYS = 7;
/** 임시 공고 폐기 전 생성자에게 리마인드를 보내기 시작하는 경과 일수(폐기 D-2 무렵). */
export const DRAFT_REMINDER_AFTER_DAYS = 5;

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
 * 연장 과금 대상 이력서 수 — 파일이 아직 보관 중인 이력서만 카운트.
 * 불합격·지원취소는 결정 즉시 파일이 폐기되므로(purgeOnDecision) 보관비용이 없어 과금 제외.
 * 과금 대상 = outcome 이 NULL(진행 중) 또는 'hired'(합격) 인 후보.
 */
export async function countBillableCandidates(jobId: number): Promise<{
  billable: number;
  total: number;
}> {
  const [agg] = await db
    .select({
      total: count(),
      billable: sql<number>`SUM(CASE WHEN ${candidates.outcome} IS NULL OR ${candidates.outcome} NOT IN ('rejected','withdrawn') THEN 1 ELSE 0 END)`,
    })
    .from(candidates)
    .where(eq(candidates.jobId, jobId));
  return {
    billable: Number(agg?.billable ?? 0),
    total: Number(agg?.total ?? 0),
  };
}

/**
 * 공고 1개월 연장. 토큰 = 보관 중 이력서 수 × resume_upload 단가.
 * (불합격·지원취소 이력서는 파일이 폐기되어 보관비용이 없으므로 과금 제외)
 * 보관 중 이력서 0건이면 연장 불가(불필요).
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

  const { billable: candidateCount } = await countBillableCandidates(args.jobId);
  const perResume = await getPricing("resume_upload");
  const totalCost = candidateCount * perResume;

  // 가드: 보관 중 이력서 0건이면 연장 불필요·악용 방지 (미리 연장해두고 이력서 받으면 보관료 회피).
  // 불합격·지원취소만 있는 공고도 파일이 이미 폐기되어 보관비용이 없으므로 여기에 해당.
  if (candidateCount === 0) {
    return {
      ok: false,
      code: "no_candidates",
      message:
        "보관 중인 이력서가 없어 연장이 불필요합니다. (불합격·지원취소 이력서는 이미 폐기되어 보관비용이 없습니다)",
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
    // H1 — 원자적 차감 + 멱등. 기존엔 SELECT 한 balanceBefore 로 절대값을 덮어써서
    // (a) 동시 연장 따닥, (b) 연장과 다른 차감(서류평가 후차감 등)의 동시성에서
    // 한쪽 차감이 증발해 원장-지갑이 불일치할 수 있었다. writeLedgerIdempotent 로 일원화:
    // wallet 은 `balance + delta` 원자 증분, ledger 는 INSERT-first 멱등.
    // refType 에 연장 회차를 포함해 다회 연장은 각각 별 거래로 과금하고,
    // 같은 회차 동시 따닥은 token_ledger_idem_uq 가 이중 차감을 차단한다.
    await writeLedgerIdempotent({
      orgId: args.orgId,
      delta: -totalCost,
      reason: "job_extend",
      refType: `job_extension:${nextExtCount}`,
      refId: args.jobId,
      userId: args.userId,
      memo: `공고 #${args.jobId} ${EXTENSION_DAYS}일 연장 #${nextExtCount} (보관 이력서 ${candidateCount}명 × ${perResume})`,
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

/**
 * 자동 종결 정책 변경 (2026-05-28):
 * closesAt 도래해도 자동으로 status='closed' 로 전환하지 않는다.
 * 만료된 active 공고는 그대로 둔다 — HR 이 공고 상세 진입 시 모달로
 * "연장 / 종결" 을 직접 선택. 종결은 closeJob() 으로만 일어남.
 *
 * 이 함수는 호환을 위해 남겨두되 항상 0 반환.
 */
export async function closeExpiredJobs(): Promise<number> {
  return 0;
}

/**
 * 공고가 만료됐는지 — closesAt 이 지났고 아직 active 인 상태.
 * 이 상태에선 HR 추가 행위는 차단되고, 후보자의 진행(AI 면접 응시 등) 은 계속 허용.
 */
export function isJobExpired(job: {
  status: "active" | "closed";
  closesAt: string | null;
}): boolean {
  if (job.status !== "active") return false;
  if (!job.closesAt) return false;
  return new Date(job.closesAt).getTime() < Date.now();
}

/**
 * 종결 사전 체크 — "지원자 대기 중" 상태이면서 링크가 아직 유효한 후보자가 있으면 차단.
 * 차단 사유:
 *   - AI 면접 발급됨(status=pending|in_progress) + expiresAt > now
 *   - 1차 면접 스케쥴 제시(status=pending|counter_proposed) + expiresAt > now
 *
 * 차단 후보가 없으면 종결 가능. 진행 중인 일반 후보(서류평가, ai_evaluated 등)는
 * 종결 시 일괄 불합격 처리되므로 차단 사유는 아님.
 */
export async function checkCloseable(jobId: number): Promise<{
  ok: boolean;
  blockers: Array<{
    candidateId: number;
    candidateName: string;
    reason: "ai_interview_pending" | "schedule_pending";
    expiresAt: string;
  }>;
  pendingDecisionCount: number;
}> {
  // expiresAt 는 toISOString()(T 포맷)로 저장 — CURRENT_TIMESTAMP(공백 포맷)와 비교하면
  // 만료 당일 세션이 시각과 무관하게 "유효"로 잡혀 HR 의 공고 종결을 부당하게 막는다(GOTCHAS §0-0).
  // 같은 ISO 포맷의 now 와 비교해 사전순=시간순을 보장.
  const now = new Date().toISOString();

  // AI 면접 링크 — pending/in_progress + 유효
  const aiBlockers = await db
    .select({
      candidateId: candidates.id,
      candidateName: candidates.name,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(candidates, eq(candidates.id, sessions.candidateId))
    .where(
      and(
        eq(candidates.jobId, jobId),
        sql`${sessions.status} IN ('pending','in_progress')`,
        sql`${sessions.expiresAt} > ${now}`
      )
    );

  // 1차 면접 스케쥴 링크 — pending/counter_proposed + 유효
  const scheduleBlockers = await db
    .select({
      candidateId: candidates.id,
      candidateName: candidates.name,
      expiresAt: schedules.expiresAt,
    })
    .from(schedules)
    .innerJoin(candidates, eq(candidates.id, schedules.candidateId))
    .where(
      and(
        eq(schedules.jobId, jobId),
        sql`${schedules.status} IN ('pending','counter_proposed')`,
        sql`${schedules.expiresAt} > ${now}`
      )
    );

  const blockers = [
    ...aiBlockers.map((b) => ({
      candidateId: b.candidateId,
      candidateName: b.candidateName,
      reason: "ai_interview_pending" as const,
      expiresAt: b.expiresAt,
    })),
    ...scheduleBlockers.map((b) => ({
      candidateId: b.candidateId,
      candidateName: b.candidateName,
      reason: "schedule_pending" as const,
      expiresAt: b.expiresAt,
    })),
  ];

  // 일괄 불합격 대상 — outcome 미결정 후보 수 (참고용)
  const [pending] = await db
    .select({ n: count() })
    .from(candidates)
    .where(and(eq(candidates.jobId, jobId), sql`${candidates.outcome} IS NULL`));

  return {
    ok: blockers.length === 0,
    blockers,
    pendingDecisionCount: Number(pending?.n ?? 0),
  };
}

/**
 * 공고 종결 — 진행 중(outcome=null) 후보자를 일괄 불합격 처리하고 status='closed' 로 전환.
 * - decisionFromStage 기록 (통계용)
 * - purgeOnDecision 호출 (단건 결정과 PIPA 정책 일관)
 * - sendNotification=true 면 결과 통보 메일 발송
 *
 * 호출 전에 checkCloseable() 로 차단 사유 없는지 반드시 확인.
 */
export async function closeJob(args: {
  jobId: number;
  userId: number;
  sendNotification?: boolean;
}): Promise<{
  closedAt: string;
  rejectedCount: number;
  mailsQueued: number;
}> {
  const closedAt = new Date().toISOString();

  // 대상 후보자(진행 중) 미리 조회 — stage 등 보존, 메일 발송에도 사용
  const targets = await db
    .select({
      id: candidates.id,
      name: candidates.name,
      email: candidates.email,
      stage: candidates.stage,
      orgId: candidates.orgId,
    })
    .from(candidates)
    .where(and(eq(candidates.jobId, args.jobId), sql`${candidates.outcome} IS NULL`));

  // 일괄 불합격 + decisionFromStage 보존 (행별 stage 가 다르므로 행별 UPDATE)
  for (const t of targets) {
    await db
      .update(candidates)
      .set({
        outcome: "rejected",
        outcomeReason: "job_closed_bulk",
        decidedAt: closedAt,
        decidedByUserId: args.userId,
        decisionFromStage: t.stage,
        decisionNote: "공고 종결 시 미결정 후보 일괄 처리",
      })
      .where(eq(candidates.id, t.id));
  }

  // PIPA 정책 일관 — 단건 결정과 동일하게 즉시 본문/파일 폐기
  for (const t of targets) {
    await purgeOnDecision(t.id).catch((e) =>
      console.error(`closeJob: purgeOnDecision failed (cid=${t.id})`, e)
    );
  }

  // 공고 상태 전환
  const [job] = await db
    .select({ title: jobPostings.title, orgId: jobPostings.orgId })
    .from(jobPostings)
    .where(eq(jobPostings.id, args.jobId));
  await db
    .update(jobPostings)
    .set({ status: "closed", closedAt })
    .where(eq(jobPostings.id, args.jobId));

  // 결과 통보 메일 (옵션) — 대상 인원이 무제한이라 발송은 after() 백그라운드로 분리,
  // 응답을 막지 않는다 (페이싱 2/s 기준 240명이면 동기 발송만 2분). 성공 건만
  // decisionEmailCount 증가 → 실패 후보는 상세의 "결정 통보 재발송" 으로 복구 가능.
  let mailsQueued = 0;
  if (args.sendNotification && job) {
    const [org] = job.orgId
      ? await db
          .select({ name: organizations.name })
          .from(organizations)
          .where(eq(organizations.id, job.orgId))
      : [];
    const mailTargets = targets.filter((t) => !!t.email);
    mailsQueued = mailTargets.length;
    if (mailTargets.length > 0) {
      after(async () => {
        let sent = 0;
        let failed = 0;
        for (const t of mailTargets) {
          try {
            const { subject, html, text } = buildDecisionEmail({
              candidateName: t.name,
              jobTitle: job.title,
              decision: "rejected",
              companyName: org?.name ?? null,
              lang: await resolveCandidateEmailLang(t.id),
            });
            await sendMail({
              to: t.email!,
              subject,
              html,
              text,
              orgId: job.orgId,
              audience: "candidate",
            });
            // 결정 통보 메일 카운트 증가
            await db
              .update(candidates)
              .set({
                decisionEmailCount: sql`${candidates.decisionEmailCount} + 1`,
              })
              .where(eq(candidates.id, t.id));
            sent++;
          } catch (e) {
            console.error(
              `closeJob: notification mail failed (cid=${t.id})`,
              e
            );
            failed++;
          }
        }
        if (failed > 0) {
          console.error(
            `closeJob: 통보 메일 ${failed}건 실패 / 성공 ${sent}건 (job=${args.jobId}) — 후보 상세에서 재발송 가능`
          );
        }
      });
    }
  }

  return { closedAt, rejectedCount: targets.length, mailsQueued };
}

/**
 * 자동 종결 — 공고의 모든 지원자가 종결(outcome != null: 합격/불합격/지원취소)되면
 * 공고를 status='closed' 로 전환. 후보자가 1명 이상 있어야 하고, 미결정(outcome=null)
 * 후보가 한 명이라도 있으면 종결하지 않는다.
 *
 * closeJob() 과 달리 일괄 불합격 처리를 하지 않는다 — 호출 시점에 이미 전원 종결 상태이므로
 * 공고 상태만 닫으면 된다. 합·불·지원취소가 결정되는 모든 경로(단건/일괄 결정, AI면접·1차면접
 * 지원취소)에서 결정 직후 fire-and-forget 으로 호출.
 *
 * 멱등: 이미 closed 면 no-op.
 */
export async function maybeAutoCloseJob(jobId: number): Promise<boolean> {
  const [job] = await db
    .select({ status: jobPostings.status })
    .from(jobPostings)
    .where(eq(jobPostings.id, jobId));
  if (!job || job.status !== "active") return false;

  const [agg] = await db
    .select({
      total: count(),
      pending: sql<number>`SUM(CASE WHEN ${candidates.outcome} IS NULL THEN 1 ELSE 0 END)`,
    })
    .from(candidates)
    .where(eq(candidates.jobId, jobId));
  const total = Number(agg?.total ?? 0);
  const pending = Number(agg?.pending ?? 0);
  // 후보자 0명이면 종결하지 않음 (빈 공고를 자동으로 닫지 않음).
  if (total === 0 || pending > 0) return false;

  await db
    .update(jobPostings)
    .set({ status: "closed", closedAt: new Date().toISOString() })
    .where(eq(jobPostings.id, jobId));
  return true;
}

/** 종결 +7일 경과 공고의 candidates PDF + attachments 파일을 삭제. */
export async function purgePdfsAfterClose(): Promise<{
  purgedFiles: number;
  failedFiles: number;
  affectedCandidates: number;
}> {
  const cutoff = sql`datetime('now', '-${sql.raw(String(PDF_PURGE_DAYS_AFTER_CLOSE))} days')`;
  const targets = await db
    .select({
      id: candidates.id,
      filePath: candidates.resumeFilePath,
      photoPath: candidates.photoFilePath,
      outcome: candidates.outcome,
    })
    .from(candidates)
    .innerJoin(jobPostings, eq(jobPostings.id, candidates.jobId))
    .where(
      and(
        eq(jobPostings.status, "closed"),
        lt(jobPostings.closedAt, cutoff),
        // 합격자는 입사 절차상 보존 — purge 제외 (괄호 필수: and() 가 개별 조건을 감싸지 않아 OR 가 새어나감)
        sql`(${candidates.outcome} IS NULL OR ${candidates.outcome} != 'hired')`
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
    if (t.photoPath) {
      try {
        await deleteFile(t.photoPath);
        purgedFiles++;
      } catch (e) {
        console.error(`purgePdfs: photo delete failed (cid=${t.id})`, e);
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
        photoFilePath: null,
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
 *
 * 단, **합격자(outcome='hired') 는 영구 보존** — 입사 절차 및 인사 기록 유지 목적.
 * HR 이 명시적으로 삭제할 때까지 candidates row 유지.
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
        lt(jobPostings.closedAt, cutoff),
        // 합격자는 보존 (괄호 필수: and() 가 개별 조건을 감싸지 않아 OR 가 새어나감)
        sql`(${candidates.outcome} IS NULL OR ${candidates.outcome} != 'hired')`
      )
    );

  for (const t of targets) {
    // 감사 로그 metadata 의 후보자 PII redact — 행 삭제 전에 세션 id 확보 후 처리
    // (감사 추적성은 보존, 식별자만 [redacted]. 후보자 행 삭제 후 metadata 평문 PII 잔존 방지)
    const sess = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.candidateId, t.id));
    await redactCandidateAuditPii(
      t.id,
      sess.map((s) => s.id)
    ).catch((e) => console.error(`purgePii: audit redact failed (cid=${t.id})`, e));
    // appeal / consent / inquiry — PII 마스킹 후 유지 (감사·법적 추적용. candidate_id 는 dangling FK가 되지만 의도된 동작)
    // H7 — appeal.reason / inquiry.message·contactEmail 은 후보자가 직접 쓴 자유서술이라
    //      직접 식별자(이름·연락처)가 섞일 수 있다. 행 삭제 후 평문 잔존을 막기 위해 폐기.
    await db
      .update(appealLogs)
      .set({ email: "[purged]", reason: "[purged]", ip: null, userAgent: null })
      .where(eq(appealLogs.candidateId, t.id));
    await db
      .update(consentLogs)
      .set({ ip: null, userAgent: null })
      .where(eq(consentLogs.candidateId, t.id));
    await db
      .update(inquiries)
      .set({ message: "[purged]", contactEmail: "[purged]", ip: null, userAgent: null })
      .where(eq(inquiries.candidateId, t.id));
    // candidates 행 삭제 → cascade 로 interview_sessions / interviewer_notes /
    // candidate_attachments / screening_jobs 모두 정리
    await db.delete(candidates).where(eq(candidates.id, t.id));
  }

  return { deletedCandidates: targets.length };
}

/**
 * 만료 후 UNRESOLVED_EXPIRED_DELETE_DAYS 일 동안 HR 이 연장·종결 결정을 안 하면
 * 공고를 통째 삭제. cascade 로 candidates / interview_sessions / schedules /
 * screening_jobs / attachments 모두 정리됨.
 * appeal/consent 로그만 PII 마스킹 후 보존 (감사용).
 */
export async function deleteUnresolvedExpiredJobs(): Promise<{
  deletedJobs: number;
}> {
  const cutoff = sql`datetime('now', '-${sql.raw(String(UNRESOLVED_EXPIRED_DELETE_DAYS))} days')`;
  // active 상태 + closesAt 이 (now - 14d) 보다 이전 + 합격자가 한 명도 없는 공고만 대상.
  // 합격자가 있는 공고는 입사 절차를 위해 자동 삭제 대상에서 제외.
  const targets = await db
    .select({ id: jobPostings.id })
    .from(jobPostings)
    .where(
      and(
        eq(jobPostings.status, "active"),
        lt(jobPostings.closesAt, cutoff),
        sql`NOT EXISTS (
          SELECT 1 FROM ${candidates}
          WHERE ${candidates.jobId} = ${jobPostings.id}
            AND ${candidates.outcome} = 'hired'
        )`
      )
    );
  for (const t of targets) {
    // 해당 공고의 후보자에 대한 appeal/consent 로그 마스킹 (감사 보존)
    const cands = await db
      .select({ id: candidates.id })
      .from(candidates)
      .where(eq(candidates.jobId, t.id));
    for (const c of cands) {
      const sess = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.candidateId, c.id));
      await redactCandidateAuditPii(
        c.id,
        sess.map((s) => s.id)
      ).catch((e) =>
        console.error(`deleteUnresolvedExpiredJobs: audit redact failed (cid=${c.id})`, e)
      );
      await db
        .update(appealLogs)
        .set({ email: "[purged]", reason: "[purged]", ip: null, userAgent: null })
        .where(eq(appealLogs.candidateId, c.id));
      await db
        .update(consentLogs)
        .set({ ip: null, userAgent: null })
        .where(eq(consentLogs.candidateId, c.id));
      // H7 — 후보자 자유서술 PII(문의 내용·회신 이메일) 폐기.
      await db
        .update(inquiries)
        .set({ message: "[purged]", contactEmail: "[purged]", ip: null, userAgent: null })
        .where(eq(inquiries.candidateId, c.id));
    }
    await db.delete(jobPostings).where(eq(jobPostings.id, t.id));
  }
  return { deletedJobs: targets.length };
}

/**
 * 임시 공고(isDraft) 자동 폐기 — 생성 +DRAFT_TTL_DAYS 일 경과해도 정식 전환 안 된 것.
 *
 * 지원 링크로 먼저 들어와 hold(파싱·마스킹만) 된 이력서 파일·PII 도 함께 폐기 →
 * 처리 근거 없이 잔존하는 지원자 PII 를 방지(PIPA). 일반 공고(isDraft=false)는 절대 대상이 아니다.
 * job_postings 행을 통째 삭제 → cascade 로 candidates / attachments / screening_jobs 정리.
 */
export async function purgeAbandonedDrafts(): Promise<{
  deletedDrafts: number;
  deletedCandidates: number;
  purgedFiles: number;
}> {
  const cutoff = sql`datetime('now', '-${sql.raw(String(DRAFT_TTL_DAYS))} days')`;
  const targets = await db
    .select({ id: jobPostings.id })
    .from(jobPostings)
    .where(and(eq(jobPostings.isDraft, true), lt(jobPostings.createdAt, cutoff)));

  let deletedCandidates = 0;
  let purgedFiles = 0;
  for (const t of targets) {
    const cands = await db
      .select({ id: candidates.id })
      .from(candidates)
      .where(eq(candidates.jobId, t.id));
    const ids = cands.map((c) => c.id);
    if (ids.length > 0) {
      try {
        const res = await deleteCandidateFiles(ids);
        purgedFiles += res.deletedFiles ?? 0;
      } catch (e) {
        console.error(`purgeAbandonedDrafts: file delete failed (job=${t.id})`, e);
      }
      // hold 후보의 동의 기록(audit_logs)은 식별자만 redact 후 추적성 보존.
      for (const c of cands) {
        await redactCandidateAuditPii(c.id, []).catch((e) =>
          console.error(`purgeAbandonedDrafts: audit redact failed (cid=${c.id})`, e)
        );
      }
      deletedCandidates += ids.length;
    }
    await db.delete(jobPostings).where(eq(jobPostings.id, t.id));
  }
  return { deletedDrafts: targets.length, deletedCandidates, purgedFiles };
}

/**
 * 폐기 임박 임시 공고 리마인드 — 생성 +DRAFT_REMINDER_AFTER_DAYS ~ +DRAFT_TTL_DAYS 사이의
 * 미정식 임시 공고 생성자에게 인앱 알림 1회 (href 로 중복 방지). 7일 경과분은 purge 가 처리.
 */
export async function remindStaleDrafts(): Promise<{ reminded: number }> {
  const ttlCutoff = sql`datetime('now', '-${sql.raw(String(DRAFT_TTL_DAYS))} days')`;
  const remindCutoff = sql`datetime('now', '-${sql.raw(String(DRAFT_REMINDER_AFTER_DAYS))} days')`;
  const targets = await db
    .select({ id: jobPostings.id, userId: jobPostings.createdByUserId })
    .from(jobPostings)
    .where(
      and(
        eq(jobPostings.isDraft, true),
        lt(jobPostings.createdAt, remindCutoff), // 5일 이상 경과
        sql`${jobPostings.createdAt} >= ${ttlCutoff}` // 아직 7일 미만(곧 폐기될 것)
      )
    );

  let reminded = 0;
  for (const t of targets) {
    if (!t.userId) continue;
    const href = `/jobs/${t.id}`;
    const [dup] = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.type, "draft_reminder"), eq(notifications.href, href)))
      .limit(1);
    if (dup) continue;
    await createNotification({
      userId: t.userId,
      type: "draft_reminder",
      title: "임시 공고를 곧 정리합니다 — 공고 내용을 채워 정식 등록해 주세요",
      href,
      payload: { jobId: t.id },
    });
    reminded++;
  }
  return { reminded };
}

/** 한 사이클 — close(no-op) → purge pdf → purge pii → 만료 미해결 공고 삭제 → 임시 공고 리마인드·폐기. */
export async function runLifecycleSweep(): Promise<{
  closed: number;
  pdfPurge: Awaited<ReturnType<typeof purgePdfsAfterClose>>;
  piiPurge: Awaited<ReturnType<typeof purgePiiAfterClose>>;
  unresolvedDeleted: Awaited<ReturnType<typeof deleteUnresolvedExpiredJobs>>;
  draftReminders: Awaited<ReturnType<typeof remindStaleDrafts>>;
  draftsPurged: Awaited<ReturnType<typeof purgeAbandonedDrafts>>;
}> {
  const closed = await closeExpiredJobs();
  const pdfPurge = await purgePdfsAfterClose();
  const piiPurge = await purgePiiAfterClose();
  const unresolvedDeleted = await deleteUnresolvedExpiredJobs();
  // 리마인드를 먼저(5~7일), 그다음 폐기(7일+) — 폐기 전에 알림이 가도록 순서 보장.
  const draftReminders = await remindStaleDrafts();
  const draftsPurged = await purgeAbandonedDrafts();
  return {
    closed,
    pdfPurge,
    piiPurge,
    unresolvedDeleted,
    draftReminders,
    draftsPurged,
  };
}
