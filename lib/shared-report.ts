/**
 * 평가 리포트 외부 공유 — 토큰 발급·상태 판정 + 공유 페이로드 취합.
 *
 * Intervia 계정이 없는 사람(현업 부서장·임원 등)에게 후보자 평가 결과를 읽기 전용으로
 * 공유한다. collectSharedReportData 가 **화이트리스트**로 평가 결론만 모으고, 원본 이력서·
 * 연락처·나이·사진 등 PII 와 내부 신호(부정행위 의심·다음 라운드 질문·전사 근거)를 전부
 * 제외한다. read 라우트(app/api/shared/[token])와 공유 페이지가 이 모듈만 통해 데이터를 얻는다.
 */
import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "./db";
import {
  candidates,
  jobPostings,
  interviewSessions,
  recordedInterviews,
  sharedReports,
} from "./schema";
import type { InterviewEvaluation, RecordedInterviewReport } from "./schema";
import { addDays, parseDbTimestamp, sqliteTimestamp } from "./utils";

/** 공유 링크 기본 유효기간(일). 발급 UI·자동 발급 공통 기본값. */
export const SHARE_LINK_DEFAULT_DAYS = 14;

/** 무인증 공유 토큰 — "sr_" + 192bit. interview accessToken 과 동일한 추측 불가 패턴. */
export function generateShareToken(): string {
  return "sr_" + randomBytes(24).toString("hex");
}

/**
 * 활성 공유 링크를 보장한다 — 있으면 재사용, 없으면 발급.
 *
 * `POST /api/candidates/[id]/share`(수동 발급)와 달리 **기존 링크를 폐기하지 않는다**.
 * 일정 확정 메일처럼 시스템이 자동으로 링크를 첨부하는 경로가 이미 배포된 링크를
 * 무효화하면, 먼저 링크를 받은 사람이 영문도 모르고 접근을 잃는다.
 *
 * minValidUntil 은 만료 하한 — 재사용 링크가 그보다 먼저 끊기면 연장한다(폐기 아님).
 */
export async function ensureActiveShareLink(opts: {
  candidateId: number;
  orgId: number | null;
  createdByUserId?: number | null;
  /** 최소 이 시각까지 유효해야 함. 면접 후에 나오는 평가를 열람하므로 면접일 이후로 잡는다. */
  minValidUntil?: Date;
}): Promise<{ token: string; expiresAt: string; created: boolean }> {
  const floor = addDays(new Date(), SHARE_LINK_DEFAULT_DAYS);
  const target =
    opts.minValidUntil && opts.minValidUntil.getTime() > floor.getTime()
      ? opts.minValidUntil
      : floor;

  const rows = await db
    .select()
    .from(sharedReports)
    .where(eq(sharedReports.candidateId, opts.candidateId))
    .orderBy(desc(sharedReports.createdAt));
  const active = rows.find((r) => shareState(r) === "active");

  if (active) {
    if (parseDbTimestamp(active.expiresAt).getTime() < target.getTime()) {
      const expiresAt = sqliteTimestamp(target);
      await db
        .update(sharedReports)
        .set({ expiresAt })
        .where(eq(sharedReports.id, active.id));
      return { token: active.token, expiresAt, created: false };
    }
    return { token: active.token, expiresAt: active.expiresAt, created: false };
  }

  const [row] = await db
    .insert(sharedReports)
    .values({
      candidateId: opts.candidateId,
      orgId: opts.orgId ?? null,
      token: generateShareToken(),
      createdByUserId: opts.createdByUserId ?? null,
      expiresAt: sqliteTimestamp(target),
    })
    .returning();
  return { token: row.token, expiresAt: row.expiresAt, created: true };
}

export type ShareState = "active" | "expired" | "revoked";

/** 폐기 > 만료 순으로 판정. active 만 열람 허용. */
export function shareState(row: {
  expiresAt: string;
  revokedAt: string | null;
}): ShareState {
  if (row.revokedAt) return "revoked";
  if (parseDbTimestamp(row.expiresAt).getTime() < Date.now()) return "expired";
  return "active";
}

type ScreeningReport = NonNullable<
  (typeof candidates.$inferSelect)["screeningReport"]
>;

/** AI 면접 평가 — 외부 공유용 화이트리스트(부정행위·다음질문·컬처핏 자기보고 제외). */
function publicEvaluation(e: InterviewEvaluation) {
  return {
    overall_score: e.overall_score,
    recommendation: e.recommendation,
    summary: e.summary,
    scores: e.scores,
    strengths: e.strengths,
    concerns: e.concerns,
  };
}

/**
 * 대면 평가 — 외부 공유용 화이트리스트. 전사를 함께 주지 않으므로 evidence_seq(근거 발언
 * 참조)·key_phrases(전사 볼드용)는 무의미해 제거하고, to_verify·followup_questions(내부
 * 판단 리스크·다음 라운드 질문)도 제외한다. 점수·요약·강점·우려만 남긴다.
 */
function publicRecorded(r: RecordedInterviewReport) {
  const scores: Record<
    string,
    { score: number; comment: string; not_assessed?: boolean }
  > = {};
  for (const [k, v] of Object.entries(r.scores)) {
    scores[k] = {
      score: v.score,
      comment: v.comment,
      ...(v.not_assessed ? { not_assessed: true } : {}),
    };
  }
  return {
    overall_score: r.overall_score,
    recommendation: r.recommendation,
    summary: r.summary,
    scores,
    strengths: r.strengths.map((s) => ({ text: s.text })),
    concerns: r.concerns.map((c) => ({ text: c.text })),
  };
}

export type PublicAiEvaluation = ReturnType<typeof publicEvaluation>;
export type PublicRecordedReport = ReturnType<typeof publicRecorded>;

export type SharedReportPayload = {
  candidate: { name: string; stage: string };
  job: { title: string; position: string | null } | null;
  screening: { score: number | null; report: ScreeningReport } | null;
  aiInterview: PublicAiEvaluation | null;
  recorded: {
    round1: PublicRecordedReport | null;
    round2: PublicRecordedReport | null;
  };
  hasAny: boolean;
};

/**
 * 후보자의 평가 결론을 공유용으로 취합. 후보자가 없으면 null.
 * 어느 평가도 준비 안 됐으면 hasAny=false (페이지가 "아직 공유할 평가 없음" 표시).
 *
 * ⚠️ candidate row 를 그대로 반환하지 않는다 — name·stage 만 뽑고, 나머지(연락처·나이·
 * 사진·이력서 텍스트/파일)는 절대 payload 에 넣지 않는다. 새 PII 컬럼이 생겨도 여기서
 * 자동으로 새지 않도록, 필드를 명시적으로 골라 담는다.
 */
export async function collectSharedReportData(
  candidateId: number
): Promise<SharedReportPayload | null> {
  const [candidate] = await db
    .select()
    .from(candidates)
    .where(eq(candidates.id, candidateId));
  if (!candidate) return null;

  const [jobRow] = await db
    .select({ title: jobPostings.title, position: jobPostings.position })
    .from(jobPostings)
    .where(eq(jobPostings.id, candidate.jobId));

  // AI 면접 — 평가가 완료된 최신 세션 하나 (재실시 시 최신 평가).
  const [aiRow] = await db
    .select({ evaluation: interviewSessions.evaluation })
    .from(interviewSessions)
    .where(
      and(
        eq(interviewSessions.candidateId, candidateId),
        isNotNull(interviewSessions.evaluation)
      )
    )
    .orderBy(desc(interviewSessions.completedAt))
    .limit(1);

  // 대면 — round 별로 리포트가 생성된(ready/confirmed) 최신 건.
  const recRows = await db
    .select({
      round: recordedInterviews.round,
      report: recordedInterviews.report,
    })
    .from(recordedInterviews)
    .where(
      and(
        eq(recordedInterviews.candidateId, candidateId),
        isNotNull(recordedInterviews.report),
        inArray(recordedInterviews.status, ["ready", "confirmed"])
      )
    )
    .orderBy(desc(recordedInterviews.createdAt));
  const round1Raw = recRows.find((r) => r.round === "round1")?.report ?? null;
  const round2Raw = recRows.find((r) => r.round === "round2")?.report ?? null;

  const screening = candidate.screeningReport
    ? { score: candidate.screeningScore, report: candidate.screeningReport }
    : null;
  const aiInterview = aiRow?.evaluation
    ? publicEvaluation(aiRow.evaluation)
    : null;
  const round1 = round1Raw ? publicRecorded(round1Raw) : null;
  const round2 = round2Raw ? publicRecorded(round2Raw) : null;

  return {
    candidate: { name: candidate.name, stage: candidate.stage },
    job: jobRow ? { title: jobRow.title, position: jobRow.position } : null,
    screening,
    aiInterview,
    recorded: { round1, round2 },
    hasAny: !!(screening || aiInterview || round1 || round2),
  };
}
