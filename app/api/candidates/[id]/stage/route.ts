/**
 * 후보자 채용 단계 변경. 최종 결정 (hired/rejected/withdrawn) 도달 시:
 *   - decided_at / decided_by_user_id / decision_note 기록
 *   - 이력서 본문·파일 즉시 폐기 (A-5 결정 — PIPA 보유기간 정책)
 *   - optional: 결정 통보 메일 발송 (sendNotification=true)
 */
import { db } from "@/lib/db";
import { candidates, jobPostings, organizations } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { guardCandidate } from "@/lib/candidate-guard";
import {
  type Stage,
  type Outcome,
  STAGE_LABELS,
  OUTCOME_LABELS,
  OUTCOME_REASONS_BY_OUTCOME,
  isOutcome,
  purgeOnDecision,
  buildDecisionEmail,
  resolveCandidateEmailLang,
} from "@/lib/candidate-stage";
import { sendMail, isSmtpAvailable } from "@/lib/mailer";
import { sendCandidateAlimtalk } from "@/lib/alimtalk";
import { logAudit } from "@/lib/audit";
import {
  requireSpendableBalance,
} from "@/lib/wallet-guard";
import { MAX_DECISION_EMAILS_PER_CANDIDATE, maybeAutoCloseJob } from "@/lib/job-lifecycle";
import { notifyJobInterviewers } from "@/lib/notifications";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";

const ALL_STAGES: Stage[] = [
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
  "rejected",
  "withdrawn",
];

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { id } = await params;
  const cid = Number(id);
  const body = (await req.json().catch(() => null)) as {
    stage?: string;
    outcome?: string;
    outcomeReason?: string;
    note?: string;
    sendNotification?: boolean;
    customMessage?: string;
  } | null;

  if (!body) return new Response("요청 본문이 없습니다.", { status: 400 });

  // 두 가지 액션: outcome 설정(종결) vs stage 변경(진행 단계).
  // 들어온 stage 가 종결값이면 outcome 으로 자동 변환 (legacy 클라이언트 호환).
  let outcomeRequested: Outcome | null = null;
  if (typeof body.outcome === "string" && isOutcome(body.outcome)) {
    outcomeRequested = body.outcome;
  } else if (typeof body.stage === "string" && isOutcome(body.stage)) {
    outcomeRequested = body.stage;
  }

  let stageRequested: Stage | null = null;
  if (
    typeof body.stage === "string" &&
    !isOutcome(body.stage) &&
    ALL_STAGES.includes(body.stage as Stage)
  ) {
    stageRequested = body.stage as Stage;
  }

  if (!outcomeRequested && !stageRequested)
    return new Response("stage 또는 outcome 값이 올바르지 않습니다.", { status: 400 });

  const g = await guardCandidate(me!, cid);
  if (!g.ok) return g.res;
  const { candidate } = g;

  const prevStage = candidate.stage as Stage;
  const prevOutcome = candidate.outcome as Outcome | null;

  // outcome 설정 모드 (종결)
  // stage 는 보존 — 종결 시점의 진행 단계가 "어디까지 갔는가" 정보.
  const isOutcomeAction = !!outcomeRequested;
  const becameTerminal = isOutcomeAction && prevOutcome == null;

  if (isOutcomeAction && prevOutcome === outcomeRequested) {
    return new Response("이미 같은 결과입니다.", { status: 400 });
  }
  if (stageRequested && prevStage === stageRequested && !isOutcomeAction) {
    return new Response("이미 같은 단계입니다.", { status: 400 });
  }

  // PIPA §37의2 — 불합격(불리한 자동화 의사결정 후속) 확정 시 사유 기록 필수.
  // 목록에서 선택한 사유 코드여야 통과 (자유 입력 강제는 아니나, 사람이 사유를 고르게 해
  // "실질적 인적 검토"를 보장 + 사전공개 문구("결정 사유를 기록한 뒤 확정")와 정합).
  // hired 는 단일 사유(passed_final)를 UI 가 자동 첨부, withdrawn 은 후보자 자의라 제외.
  if (outcomeRequested === "rejected") {
    const allowed = OUTCOME_REASONS_BY_OUTCOME.rejected as readonly string[];
    const reason = typeof body.outcomeReason === "string" ? body.outcomeReason : "";
    if (!reason || !allowed.includes(reason)) {
      return Response.json(
        {
          error: "불합격 결정에는 사유를 선택해야 합니다.",
          code: "reason_required",
          allowed,
        },
        { status: 400 }
      );
    }
  }

  const updateFields: {
    stage?: Stage;
    outcome?: Outcome | null;
    outcomeReason?: string | null;
    decisionNote?: string;
    decidedAt?: string;
    decidedByUserId?: number;
    decisionFromStage?: string;
  } = {};
  if (stageRequested) updateFields.stage = stageRequested;
  if (isOutcomeAction) {
    updateFields.outcome = outcomeRequested;
    updateFields.outcomeReason = body.outcomeReason ?? null;
    updateFields.decidedAt = new Date().toISOString();
    updateFields.decidedByUserId = me!.id;
    // stage 자체가 "어느 단계에서 결정됐는지" 정보. legacy 컬럼은 호환용 으로 같이 기록.
    updateFields.decisionFromStage = prevStage;
  }
  if (typeof body.note === "string" && body.note.length > 0)
    updateFields.decisionNote = body.note.slice(0, 5000);

  await db
    .update(candidates)
    .set(updateFields)
    .where(eq(candidates.id, cid));

  // 면접관 알림: 1차 면접 완료 후 합/불 결정 대기 단계로 진입
  if (
    stageRequested === "round1_passed" ||
    stageRequested === "round1_waiting"
  ) {
    void notifyJobInterviewers(candidate.jobId, {
      type: "round1_decision",
      title: `${candidate.name} 후보자의 1차 면접 결과 결정이 필요합니다`,
      href: `/candidates/${cid}`,
      payload: { candidateId: cid, jobId: candidate.jobId, stage: stageRequested },
    });
  }

  logAudit(req, {
    actor: me!,
    action: "candidate.stage_change" as const,
    resourceType: "candidate",
    resourceId: cid,
    orgId: candidate.orgId,
    jobId: candidate.jobId,
    metadata: {
      stage_change: stageRequested
        ? { from: prevStage, to: stageRequested }
        : undefined,
      outcome_change: isOutcomeAction
        ? { from: prevOutcome, to: outcomeRequested, reason: body.outcomeReason ?? null }
        : undefined,
      note_present: !!updateFields.decisionNote,
      terminal: becameTerminal,
    },
  });

  // 메일 통보 (선택) — outcome 이 hired/rejected 일 때만
  let mailResult: {
    sent: boolean;
    error?: string;
    code?: string;
  } = { sent: false };
  if (
    body.sendNotification &&
    candidate.email &&
    (outcomeRequested === "hired" || outcomeRequested === "rejected")
  ) {
    // 잔액 가드
    const balanceGuard = await requireSpendableBalance(candidate.orgId, {
      isSystemAdmin: me!.role === "system_admin",
    });
    if (!balanceGuard.ok) {
      mailResult = {
        sent: false,
        code: "insufficient_tokens",
        error: balanceGuard.message,
      };
    } else if (
      candidate.decisionEmailCount >= MAX_DECISION_EMAILS_PER_CANDIDATE
    ) {
      mailResult = {
        sent: false,
        code: "email_limit_exceeded",
        error: `결정 통보 메일은 후보자당 최대 ${MAX_DECISION_EMAILS_PER_CANDIDATE}회까지만 발송 가능합니다.`,
      };
    } else if (await isSmtpAvailable(candidate.orgId)) {
      try {
        const [job] = await db
          .select({ title: jobPostings.title })
          .from(jobPostings)
          .where(eq(jobPostings.id, candidate.jobId));
        const [org] = candidate.orgId
          ? await db
              .select({ name: organizations.name })
              .from(organizations)
              .where(eq(organizations.id, candidate.orgId))
          : [];
        const mail = buildDecisionEmail({
          candidateName: candidate.name,
          jobTitle: job?.title ?? "공고",
          decision: outcomeRequested as "hired" | "rejected",
          customMessage: body.customMessage,
          companyName: org?.name ?? null,
          lang: await resolveCandidateEmailLang(cid),
        });
        await sendMail({
          to: candidate.email,
          ...mail,
          orgId: candidate.orgId,
          audience: "candidate",
        });
        // 합격 통보만 알림톡 병행 (불합격은 메일 유지). 베스트에포트.
        if (outcomeRequested === "hired") {
          await sendCandidateAlimtalk("decision_pass", {
            phone: candidate.phone,
            vars: {
              orgName: org?.name ?? null,
              candidateName: candidate.name,
              jobTitle: job?.title ?? "공고",
            },
            fallbackText: `[${org?.name ?? "채용"}] ${candidate.name}님, ${job?.title ?? "공고"} 전형에 합격하셨습니다. 다음 절차는 별도 안내드리겠습니다.`,
          });
        }
        await db
          .update(candidates)
          .set({ decisionEmailCount: sql`${candidates.decisionEmailCount} + 1` })
          .where(eq(candidates.id, cid));
        mailResult = { sent: true };
        logAudit(req, {
          actor: me!,
          action: "interview.send_email",
          resourceType: "candidate",
          resourceId: cid,
          orgId: candidate.orgId,
          jobId: candidate.jobId,
          metadata: { kind: "decision_notify", to: candidate.email, decision: outcomeRequested },
        });
      } catch (e) {
        console.error(`[stage] 결정 통보 메일 발송 실패 (candidate ${cid}):`, e);
        mailResult = {
          sent: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    } else {
      mailResult = { sent: false, error: "SMTP 미설정" };
    }
  }

  // 최종 결정 시점 폐기 (A-5: 즉시 폐기).
  // 단, 결정 통보 메일 발송이 요청되었는데 실패한 경우는 폐기 보류 —
  // 후보자가 결과도 못 받고 본인 데이터도 사라지는 상황 방지.
  // 운영자가 SMTP 수정 후 stage 변경 없이도 "결정 통보 재발송" 으로 처리하거나
  // hold 상태로 두는 등 후속 대응 가능.
  let purged = false;
  const mailRequestedButFailed =
    body.sendNotification === true && !mailResult.sent;
  if (becameTerminal && !mailRequestedButFailed) {
    await purgeOnDecision(cid).catch((e) =>
      console.error("purgeOnDecision failed", e)
    );
    purged = true;
  }

  // 모든 지원자가 종결(합격/불합격/지원취소)되면 공고 자동 종결.
  if (becameTerminal) {
    await maybeAutoCloseJob(candidate.jobId).catch((e) =>
      console.error("maybeAutoCloseJob failed", e)
    );
  }

  const finalStage = stageRequested ?? prevStage;
  const finalOutcome = isOutcomeAction ? outcomeRequested : prevOutcome;
  return Response.json({
    ok: true,
    stage: finalStage,
    stageLabel: STAGE_LABELS[finalStage],
    outcome: finalOutcome,
    outcomeLabel: finalOutcome ? OUTCOME_LABELS[finalOutcome] : null,
    terminal: becameTerminal,
    purged,
    purgeSkippedReason: mailRequestedButFailed
      ? "결정 통보 메일 발송 실패로 이력서 폐기를 보류했습니다. SMTP 확인 후 다시 시도하거나, 별도 통보 후 수동 처리해 주세요."
      : undefined,
    mail: mailResult,
  });
}
