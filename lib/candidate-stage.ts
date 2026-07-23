/**
 * 채용 단계 (stage) 라벨 + 결정 시점 폐기 헬퍼.
 *
 * 12-stage 모델 (메인 9 + AI면접 서브 2 + 1차 면접 서브 3):
 *   applied            (지원)
 *   screened           (서류평가)
 *   ai_pending         (AI면접 · 대기)
 *   ai_evaluated       (AI면접 · 평가)
 *   round1_candidate   (1차 면접 · 후보)
 *   round1_scheduling  (1차 면접 · 스케쥴 지정)
 *   round1_waiting     (1차 면접 · 대기)
 *   round1_passed      (1차 합격)
 *   round2_passed      (2차 합격)
 *   hired              (최종 합격)
 *   rejected           (불합격)
 *   withdrawn          (지원취소)
 *
 * 최종 결정 단계(hired/rejected/withdrawn) 도달 시 이력서 본문·파일 즉시 폐기.
 * 평가 결과는 공고 종결 +14일 라이프사이클 cron 이 candidate row 통째 삭제.
 */
import { db } from "./db";
import { candidates, candidateAttachments, interviewSessions } from "./schema";
import { desc, eq } from "drizzle-orm";
import { deleteFile } from "./storage";
import { wrapEmailCard, type OrgEmailBranding } from "./mailer";

// Stage 타입 + UI 메타는 client-safe 파일에 둠 (db/storage 의존 없음).
export type { Stage, StageWaiter } from "./stage-meta";
export {
  STAGE_META,
  STAGE_RANK,
  STAGE_LABELS,
  STAGE_WAITER,
} from "./stage-meta";
import type { Stage } from "./stage-meta";

/** 메인 단계 + 서브 상태 분리 — UI에서 메인 큰 글자 + 서브 작은 글자 노출용. */
export function splitStage(stage: Stage): { main: string; sub: string | null } {
  switch (stage) {
    case "applied":
      return { main: "지원", sub: null };
    case "screened":
      return { main: "서류평가", sub: null };
    case "ai_pending":
      return { main: "AI면접", sub: "대기" };
    case "ai_evaluated":
      return { main: "AI면접", sub: "평가" };
    case "round1_candidate":
      return { main: "1차 면접", sub: "후보" };
    case "round1_scheduling":
      return { main: "1차 면접", sub: "스케쥴 지정" };
    case "round1_waiting":
      return { main: "1차 면접", sub: "대기" };
    case "round1_passed":
      return { main: "1차 합격", sub: null };
    case "round2_passed":
      return { main: "2차 합격", sub: null };
    case "hired":
      return { main: "최종 합격", sub: null };
    case "rejected":
      return { main: "불합격", sub: null };
    case "withdrawn":
      return { main: "지원취소", sub: null };
  }
}

/** 채용 전형 파이프라인 순서 (메인 단계). 합격/불합격/지원취소는 결정 단계로 분리. */
export const PIPELINE_STAGES: readonly Stage[] = [
  "applied",
  "screened",
  "ai_pending",
  "ai_evaluated",
  "round1_candidate",
  "round1_scheduling",
  "round1_waiting",
  "round1_passed",
  "round2_passed",
  "hired",
];

/** 결정 단계 — 종결. */
export const DECISION_STAGES: readonly Stage[] = ["hired", "rejected", "withdrawn"];

export const TERMINAL_STAGES: readonly Stage[] = [
  "hired",
  "rejected",
  "withdrawn",
];

export function isTerminal(stage: Stage): boolean {
  return TERMINAL_STAGES.includes(stage);
}

/**
 * 종결 결과 — stage 와 분리된 별도 필드. null = 진행 중.
 *
 * 한 후보자는 stage(현재까지 도달한 단계) + outcome(종결 결과) 조합으로 표현:
 *   - (round1_passed, hired)      → 1차 합격까지 가서 최종 합격
 *   - (ai_evaluated, rejected)    → AI면접 평가에서 불합격
 *   - (round1_scheduling, withdrawn) → 일정 조율 중 지원자가 취소
 */
export type Outcome = "hired" | "rejected" | "withdrawn";

export const OUTCOMES: readonly Outcome[] = ["hired", "rejected", "withdrawn"];

export function isOutcome(s: string): s is Outcome {
  return s === "hired" || s === "rejected" || s === "withdrawn";
}

export const OUTCOME_LABELS: Record<Outcome, string> = {
  hired: "최종합격",
  rejected: "불합격",
  withdrawn: "지원취소",
};

/** UI 배지 색상 톤. */
export const OUTCOME_TONE: Record<Outcome, "success" | "danger" | "muted"> = {
  hired: "success",
  rejected: "danger",
  withdrawn: "muted",
};

/**
 * 종결 사유 코드. 자동 사유는 시스템이 설정, 수동 사유는 면접관이 선택.
 * "기타" 선택 시 decisionNote 에 자유 텍스트 추가.
 */
export type OutcomeReason =
  // 자동
  | "candidate_withdrew"       // 지원자가 직접 지원 취소
  | "ai_link_expired"          // AI면접 링크 7일 만료
  | "schedule_link_expired"    // 1차 면접 일정 링크 만료
  // 수동 (면접관 선택)
  | "resume_unfit"             // 서류 부적합
  | "ai_interview_unfit"       // AI면접 평가 부적합
  | "round1_unfit"             // 1차 면접 부적합
  | "round2_unfit"             // 2차 면접 부적합
  | "offer_declined"           // 처우협의 결렬
  | "passed_final"             // 최종 합격 결정
  | "other";                   // 기타 (자유 입력)

export const OUTCOME_REASON_LABELS: Record<OutcomeReason, string> = {
  candidate_withdrew: "지원자가 지원 취소",
  ai_link_expired: "AI면접 링크 만료 (응시 기한 경과 — AI 평가 결과 아님)",
  schedule_link_expired: "1차 면접 일정 링크 만료",
  resume_unfit: "서류 부적합",
  ai_interview_unfit: "AI면접 평가 부적합",
  round1_unfit: "1차 면접 부적합",
  round2_unfit: "2차 면접 부적합",
  offer_declined: "처우협의 결렬",
  passed_final: "최종 합격 결정",
  other: "기타",
};

/** outcome 별 선택 가능한 사유 — UI 셀렉트 박스용. */
export const OUTCOME_REASONS_BY_OUTCOME: Record<Outcome, OutcomeReason[]> = {
  hired: ["passed_final"],
  rejected: [
    "resume_unfit",
    "ai_interview_unfit",
    "round1_unfit",
    "round2_unfit",
    "offer_declined",
    "ai_link_expired",
    "schedule_link_expired",
    "other",
  ],
  withdrawn: ["candidate_withdrew", "other"],
};

/**
 * 최종 결정 시점 이력서 본문·파일 즉시 폐기 (PIPA 보유기간 정책).
 * 평가 결과(screeningReport / interviewSessions.evaluation) 는 일시 보존 —
 * 공고 종결 +14일 라이프사이클 cron 이 candidate row 통째 삭제.
 *
 * 단, **outcome='hired'(최종 합격) 후보는 폐기하지 않음** — 입사 절차상
 * 이력서/포트폴리오 원본이 필요하고, 본인 동의 하에 보관 정당성 확보.
 * (PIPA §15·§22 — 채용 이후 단계에서는 별도 동의/근거 하에 보관 가능)
 */
export async function purgeOnDecision(candidateId: number): Promise<void> {
  const [c] = await db
    .select({
      resumeFilePath: candidates.resumeFilePath,
      photoFilePath: candidates.photoFilePath,
      outcome: candidates.outcome,
    })
    .from(candidates)
    .where(eq(candidates.id, candidateId));
  if (!c) return;
  if (c.outcome === "hired") {
    // 합격자는 이력서·첨부·사진 그대로 보존
    return;
  }
  const atts = await db
    .select({ id: candidateAttachments.id, filePath: candidateAttachments.filePath })
    .from(candidateAttachments)
    .where(eq(candidateAttachments.candidateId, candidateId));
  // 이력서 + 첨부 파일을 병렬 삭제 — 각 deleteFile 은 Blob 네트워크 왕복이라
  // 직렬로 하면 파일 수만큼 느려진다(일괄 종결 시 특히). deleteFile 은 내부에서
  // 예외를 삼키므로 Promise.all 이 안전하나, 만약을 위해 .catch 로 한 번 더 감싼다.
  await Promise.all([
    c.resumeFilePath
      ? deleteFile(c.resumeFilePath).catch((e) =>
          console.error(`purgeOnDecision: file delete failed (cid=${candidateId})`, e)
        )
      : Promise.resolve(),
    c.photoFilePath
      ? deleteFile(c.photoFilePath).catch((e) =>
          console.error(`purgeOnDecision: photo delete failed (cid=${candidateId})`, e)
        )
      : Promise.resolve(),
    ...atts.map((a) =>
      a.filePath
        ? deleteFile(a.filePath).catch((e) =>
            console.error(`purgeOnDecision: attachment delete failed (aid=${a.id})`, e)
          )
        : Promise.resolve()
    ),
  ]);
  await db.delete(candidateAttachments).where(eq(candidateAttachments.candidateId, candidateId));
  await db
    .update(candidates)
    .set({
      resumeText: "",
      resumeMaskedText: null,
      resumeFilePath: "",
      photoFilePath: null,
    })
    .where(eq(candidates.id, candidateId));
}

/**
 * 후보자의 AI 면접 진행 언어를 조회 — 결정/이의제기 통보 메일의 언어 분기용.
 * 완료 세션을 우선하고, 없으면 최신 세션 기준. 세션이 아예 없으면(서류 단계 탈락 등) 'ko'.
 * 평가 리포트는 이 값과 무관하게 항상 한국어지만, 후보자에게 직접 가는 메일은 면접 언어를 따른다.
 */
export async function resolveCandidateEmailLang(
  candidateId: number
): Promise<"ko" | "en"> {
  const rows = await db
    .select({
      language: interviewSessions.language,
      status: interviewSessions.status,
    })
    .from(interviewSessions)
    .where(eq(interviewSessions.candidateId, candidateId))
    .orderBy(desc(interviewSessions.createdAt));
  if (rows.length === 0) return "ko";
  const picked = rows.find((r) => r.status === "completed") ?? rows[0];
  return picked.language === "en" ? "en" : "ko";
}

/** 합·불 통보 메일 템플릿. lang='en' 이면 영어 후보자용 템플릿(제목·헤더·기본본문·푸터). */
export function buildDecisionEmail(opts: {
  candidateName: string;
  jobTitle: string;
  decision: "hired" | "rejected";
  customMessage?: string;
  companyName?: string | null;
  /** 후보자 면접 언어. 후보자 대면 메일이라 분기(평가 리포트와 별개). 기본 'ko'. */
  lang?: "ko" | "en";
  // 지원자용 메일에 표시할 채용 담당자 문의처.
  contactEmail?: string | null;
  branding?: OrgEmailBranding | null;
}): { subject: string; html: string; text: string } {
  const { candidateName, jobTitle, decision, customMessage, companyName } = opts;
  const en = opts.lang === "en";
  // 법인명 접두 — 단, 공고 제목에 이미 법인명이 포함돼 있으면 중복을 피해 생략.
  const coName = companyName?.trim() ?? "";
  const hasCo = !!coName && !jobTitle.includes(coName);
  const coKo = hasCo ? `${coName} ` : "";
  const coEn = hasCo ? ` at ${coName}` : "";
  const headerMap = en
    ? { hired: "🎉 Congratulations", rejected: "Thank you for applying" }
    : { hired: "🎉 합격을 축하드립니다", rejected: "지원해 주셔서 감사합니다" };
  const cleanTitle = jobTitle
    .replace(/\s*(채용\s*공고|채용)\s*$/, "")
    .trim();
  const subject = en
    ? `[Intervia] ${cleanTitle} — ${decision === "hired" ? "Offer" : "Application update"}`
    : `[Intervia] ${cleanTitle} ${decision === "hired" ? "합격 안내" : "전형 결과 안내"}`;
  const defaultBody = en
    ? decision === "hired"
      ? `Dear ${candidateName},\n\nCongratulations! We are delighted to offer you the ${jobTitle} position${coEn}. Our hiring team will reach out to you shortly with the next steps.\n\nThank you.`
      : `Dear ${candidateName},\n\nThank you for your interest in the ${jobTitle} position${coEn} and for the time you invested in your application. After careful consideration, we are unable to move forward with your application at this time. We sincerely appreciate your effort and wish you every success in your future endeavors.`
    : decision === "hired"
      ? `${candidateName}님, ${coKo}${jobTitle} 포지션 최종 합격을 진심으로 축하드립니다.\n\n곧 채용 담당자가 별도로 연락드려 입사 절차를 안내해 드릴 예정입니다.\n감사합니다.`
      : `${candidateName}님, ${coKo}${jobTitle} 포지션에 지원해 주셔서 진심으로 감사드립니다.\n\n신중히 검토한 결과, 이번 채용에서는 함께하기 어렵게 되었음을 안내드립니다. 좋은 인연으로 다시 만날 기회가 있기를 기대하며, 앞으로의 여정에 좋은 결과 있으시기를 응원합니다.`;
  const body = customMessage ?? defaultBody;

  const text = `${body}\n\n${en ? "The Intervia Recruiting Team" : "Intervia 채용팀"}`;
  const escaped = body.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
  const html = wrapEmailCard({
    branding: opts.branding,
    contactEmail: opts.contactEmail ?? null,
    innerHtml: `
      <h1 style="font-size:20px;margin:24px 0 16px;color:#0f172a;">${headerMap[decision]}</h1>
      <div style="font-size:14px;line-height:1.7;color:#475569;white-space:pre-wrap;">${escaped}</div>
    `,
    footer: en
      ? "This email was sent from the Intervia recruitment platform."
      : "본 메일은 Intervia 채용 플랫폼에서 발송되었습니다.",
  });
  return { subject, html, text };
}
