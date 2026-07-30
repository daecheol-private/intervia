/**
 * 면접 일정 수동 확정 입력 — 전화 등으로 이미 합의된 1·2차 면접 시간을
 * 스케쥴 제시(메일 링크) 절차 없이 면접관이 직접 확정 상태로 등록.
 *
 * 입력 body:
 *   {
 *     round?: "round1" | "round2",          // 기본 round1. round2 는 1차 합격 후보만.
 *     slot: { start: ISO, end: ISO },
 *     modeOnline?: boolean,                 // 기본 true
 *     address?, addressDetail?,             // modeOnline=false 시 address 필수
 *     notifyCandidate?: boolean,            // true 면 후보자에게 확정 메일 발송 (기본 false)
 *     shareRecipients?: [{email, name?, userId?, report?}]  // 일정 공유 대상(선택).
 *                                                          // report=true 면 평가 리포트 링크 동봉
 *   }
 *
 * 동작:
 *   - 같은 차수의 기존 active 스케쥴(pending/counter_proposed) → cancelled
 *   - status='selected' + selectedSlot 로 즉시 확정 row 생성
 *   - round1 이면 candidate.stage → round1_waiting (확정 흐름과 동일)
 *   - notifyCandidate 시 줌 자동 생성 시도 → 폴백 확정 메일
 *   - 공유 수신자에겐 후보자 통보 여부와 무관하게 확정 안내 발송
 *   - 공고 면접관 전원 인앱 알림 (면접관 공유 목적)
 */
import { db } from "@/lib/db";
import { interviewSchedules, candidates } from "@/lib/schema";
import { and, eq, or } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { guardCandidate } from "@/lib/candidate-guard";
import {
  generateScheduleToken,
  scheduleExpiresAt,
  validateSlots,
  roundLabel,
} from "@/lib/schedules";
import { sendScheduleConfirmationEmails } from "@/lib/schedule-notify";
import { normalizeShareRecipients } from "@/lib/schedule-share";
import { notifyJobInterviewers } from "@/lib/notifications";
import { tryAutoCreateZoomMeeting } from "@/lib/schedule-zoom";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { isJobExpired } from "@/lib/job-lifecycle";
import {
  requireSpendableBalance,
  insufficientTokensResponse,
} from "@/lib/wallet-guard";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const userGuard = requireUser(me);
  if (userGuard) return userGuard;

  // 일괄 직접 확정(목록에서 최대 50명)이 후보자별 호출로 들어옴 — 한도는 그보다 여유 있게.
  const limited = await rateLimit(
    req,
    "schedule-manual",
    { limit: 60, windowSec: 60 },
    me!.id
  );
  if (limited) return limited;

  const { id } = await params;
  const cid = Number(id);
  if (!Number.isFinite(cid))
    return new Response("잘못된 candidate id", { status: 400 });

  const body = (await req.json().catch(() => null)) as {
    round?: string;
    slot?: { start: string; end: string };
    modeOnline?: boolean;
    address?: string;
    addressDetail?: string;
    notifyCandidate?: boolean;
    shareRecipients?: unknown;
  } | null;
  if (!body?.slot) return new Response("slot { start, end } 필요", { status: 400 });

  const share = normalizeShareRecipients(body.shareRecipients);
  if (!share.ok) return new Response(share.error, { status: 400 });

  const round: "round1" | "round2" =
    body.round === "round2" ? "round2" : "round1";

  const guard = await guardCandidate(me!, cid);
  if (!guard.ok) return guard.res;
  const { candidate, job } = guard;
  if (!job || !job.orgId)
    return new Response("법인 없는 공고", { status: 400 });

  // 종결/만료 공고·종결 후보 가드 — schedule-propose 와 동일 불변식.
  if (job.status === "closed")
    return Response.json(
      { code: "job_closed", message: "종결된 공고입니다. 연장 후 다시 시도해 주세요." },
      { status: 409 }
    );
  if (isJobExpired(job))
    return Response.json(
      {
        code: "job_expired",
        message:
          "공고 종결 예정일이 지났습니다. 공고를 연장하거나 종결한 후 다시 시도해 주세요.",
      },
      { status: 409 }
    );
  if (candidate.outcome)
    return new Response("이미 종결된 후보자입니다.", { status: 409 });
  if (round === "round2" && candidate.stage !== "round1_passed")
    return new Response(
      "2차 면접 일정은 1차 합격 상태의 후보자에게만 등록할 수 있습니다.",
      { status: 400 }
    );

  // 잔액 가드 — 일정 제시와 동일하게 신규 면접 일정 시작을 차단 대상에 포함.
  const balanceGuard = await requireSpendableBalance(job.orgId, {
    isSystemAdmin: me!.role === "system_admin",
  });
  if (!balanceGuard.ok) return insufficientTokensResponse(balanceGuard);

  const slotCheck = validateSlots([body.slot]);
  if (!slotCheck.ok) return new Response(slotCheck.error, { status: 400 });
  const slot = slotCheck.slots[0];

  const modeOnline = body.modeOnline !== false;
  const address = body.address?.trim() || null;
  const addressDetail = body.addressDetail?.trim() || null;
  if (!modeOnline && !address)
    return new Response("오프라인 면접은 주소가 필요합니다.", { status: 400 });

  const now = new Date().toISOString();

  // 기존 확정(selected) 일정이 있으면 이번 등록은 "재조정(변경)" — 메일을 변경형 문구로.
  const priorSelected = await db
    .select({ id: interviewSchedules.id })
    .from(interviewSchedules)
    .where(
      and(
        eq(interviewSchedules.candidateId, cid),
        eq(interviewSchedules.round, round),
        eq(interviewSchedules.status, "selected")
      )
    );
  const isReschedule = priorSelected.length > 0;

  // 같은 차수의 이전 active 스케쥴 cancel — 확정(selected) 포함.
  // 확정 후 재조정 시 옛 확정 row 가 남아 selected 가 중복되거나 리마인더가 옛 시간으로
  // 발송되는 것을 방지한다. cancelled 는 감사용으로 보존.
  await db
    .update(interviewSchedules)
    .set({ status: "cancelled", updatedAt: now })
    .where(
      and(
        eq(interviewSchedules.candidateId, cid),
        eq(interviewSchedules.round, round),
        or(
          eq(interviewSchedules.status, "pending"),
          eq(interviewSchedules.status, "counter_proposed"),
          eq(interviewSchedules.status, "selected")
        )
      )
    );

  const [sched] = await db
    .insert(interviewSchedules)
    .values({
      candidateId: cid,
      jobId: job.id,
      orgId: job.orgId,
      round,
      accessToken: generateScheduleToken(),
      proposedSlots: [slot],
      modeOnline,
      address,
      addressDetail,
      status: "selected",
      selectedSlot: slot,
      proposedByUserId: me!.id,
      shareRecipients: share.list.length > 0 ? share.list : null,
      expiresAt: scheduleExpiresAt(),
      respondedAt: now,
    })
    .returning();

  // 후보자 stage 전환 — round1 만 round1_waiting 으로. round2 는 stage 변경 없음(round1_passed 유지).
  if (round === "round1") {
    await db
      .update(candidates)
      .set({ stage: "round1_waiting" })
      .where(eq(candidates.id, cid));
  }

  // 후보자 통보 (선택) — 줌 자동 생성 시도 후 헬퍼로 후보자에게만 확정 메일 발송.
  // 면접관은 아래 인앱 알림으로 공유(전화 합의 후 등록이라 전원 메일은 과함).
  // 공유 수신자가 지정돼 있으면 후보자 통보를 끄더라도 헬퍼를 태운다 — 회의실·임원 안내는
  // 후보자 통보 여부와 별개다. 줌 자동 생성은 기존대로 후보자 통보 시에만.
  const wantCandidateMail = !!body.notifyCandidate && !!candidate.email;
  let candidateMail: { sent: boolean; error?: string } | null = null;
  if (wantCandidateMail || share.list.length > 0) {
    const zoom = wantCandidateMail ? await tryAutoCreateZoomMeeting(sched) : null;
    const r = await sendScheduleConfirmationEmails({
      sched,
      slot,
      meetingUrl: zoom?.handled ? zoom.meetingUrl : null,
      meetingNote: zoom?.handled ? zoom.meetingNote : null,
      isReschedule,
      notifyInterviewers: false,
      notifyCandidate: wantCandidateMail,
    });
    if (wantCandidateMail)
      candidateMail = r.candidateEmailSent
        ? { sent: true }
        : { sent: false, error: "메일 서버 미설정 또는 발송 실패" };
  }

  // 인앱 알림 — 공고 면접관 전원 fanout (면접관 공유 목적. 등록자 본인은 메일 제외)
  try {
    await notifyJobInterviewers(
      job.id,
      {
        type: "schedule_confirmed",
        title: `${candidate.name} 님의 ${roundLabel(round)} 면접 일정이 등록되었습니다`,
        href: `/candidates/${cid}`,
        payload: { scheduleId: sched.id, slot },
      },
      { excludeEmailUserIds: [me!.id] }
    );
  } catch (e) {
    console.error("[schedule-manual] notify interviewers failed", e);
  }

  logAudit(req, {
    actor: me!,
    action: "schedule.manual_confirm",
    resourceType: "interview_schedule",
    resourceId: sched.id,
    orgId: job.orgId,
    jobId: job.id,
    metadata: {
      candidateId: cid,
      round,
      slot,
      notified: !!candidateMail?.sent,
      shareRecipients: share.list.map((r) => r.email),
      shareReport: share.list.some((r) => r.report),
    },
  });

  return Response.json({
    ok: true,
    scheduleId: sched.id,
    selectedSlot: slot,
    candidateMail,
  });
}
