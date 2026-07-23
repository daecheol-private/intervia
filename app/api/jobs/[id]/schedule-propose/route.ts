/**
 * 1차 면접 스케쥴 제시 — 체크한 후보자 다수에게 시간 슬롯 제시 + 메일 발송.
 *
 * 입력:
 *  - candidateIds: number[]  (round1_candidate 또는 round1_scheduling 상태 후보)
 *  - slots: [{start, end}]   (1~10개, 미래 시각)
 *  - modeOnline: boolean
 *  - address?, addressDetail?  (modeOnline=false 시 필수)
 *
 * 동작:
 *  - 각 후보자별로 기존 active 스케쥴(pending/counter_proposed) 을 'cancelled' 로 마킹
 *  - 새 interview_schedules row 생성 (status='pending')
 *  - candidates.stage = 'round1_scheduling'
 *  - 후보자에게 메일 발송 (/schedule/[token])
 *  - 회사 주소가 비어있고 입력이 들어오면 organizations 에 저장
 */
import { db } from "@/lib/db";
import {
  jobPostings,
  candidates,
  interviewSchedules,
  organizations,
} from "@/lib/schema";
import { and, eq, inArray, sql, isNull, or } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import {
  generateScheduleToken,
  scheduleExpiresAt,
  validateSlots,
  buildScheduleProposalEmail,
} from "@/lib/schedules";
import {
  sendMail,
  isSmtpAvailable,
  getOrgEmailBranding,
  brandingAttachments,
} from "@/lib/mailer";
import { sendCandidateAlimtalk } from "@/lib/alimtalk";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { isJobExpired } from "@/lib/job-lifecycle";
import {
  requireSpendableBalance,
  insufficientTokensResponse,
} from "@/lib/wallet-guard";

export const runtime = "nodejs";
// 동기 발송 최대 50명 × MAIL_RATE_PER_SEC(기본 2/s) 페이싱 ≈ 25s + 재시도 여유.
// interview-links 와 동일 기준.
export const maxDuration = 120;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const userGuard = requireUser(me);
  if (userGuard) return userGuard;

  const limited = await rateLimit(
    req,
    "schedule-propose",
    { limit: 5, windowSec: 60 },
    me!.id
  );
  if (limited) return limited;

  const { id } = await params;
  const jobId = Number(id);
  const body = (await req.json().catch(() => null)) as {
    candidateIds?: number[];
    slots?: Array<{ start: string; end: string }>;
    modeOnline?: boolean;
    address?: string;
    addressDetail?: string;
    round?: string;
  } | null;
  if (!body) return new Response("바디 필요", { status: 400 });

  // 면접 차수 — round2 는 "1차 합격(round1_passed)" 후보에게만 제시 가능.
  // round2 는 별도 세부 단계를 만들지 않으므로 stage 는 round1_passed 로 유지된다(2차 합격 결정 시 수동 전환).
  const round: "round1" | "round2" =
    body.round === "round2" ? "round2" : "round1";

  const [job] = await db
    .select()
    .from(jobPostings)
    .where(eq(jobPostings.id, jobId));
  if (!job) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, job.orgId))
    return new Response("Not found", { status: 404 });
  if (!job.orgId) return new Response("법인 없는 공고", { status: 400 });

  // 종결/만료 공고 가드 — interview-link·send-email 과 동일하게 일정 제시도 차단.
  // (종결된 공고가 계속 면접 일정을 발송하지 못하게 — 라이프사이클 불변식)
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

  // 잔액 가드
  const balanceGuard = await requireSpendableBalance(job.orgId, {
    isSystemAdmin: me!.role === "system_admin",
  });
  if (!balanceGuard.ok) return insufficientTokensResponse(balanceGuard);

  // 슬롯 검증
  const slotCheck = validateSlots(body.slots);
  if (!slotCheck.ok)
    return new Response(slotCheck.error, { status: 400 });

  const modeOnline = body.modeOnline !== false;
  let address = body.address?.trim() || null;
  let addressDetail = body.addressDetail?.trim() || null;
  if (!modeOnline) {
    if (!address)
      return new Response(
        "오프라인 면접은 주소가 필요합니다.",
        { status: 400 }
      );
  }

  if (!Array.isArray(body.candidateIds) || body.candidateIds.length === 0)
    return new Response("후보자를 선택하세요.", { status: 400 });
  if (body.candidateIds.length > 50)
    return new Response("한 번에 최대 50명까지 가능합니다.", { status: 400 });

  // 회사 주소 자동 저장 (org 에 아직 주소 없으면)
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, job.orgId));
  if (
    org &&
    address &&
    !org.officeAddress &&
    !modeOnline
  ) {
    await db
      .update(organizations)
      .set({
        officeAddress: address,
        officeAddressDetail: addressDetail,
      })
      .where(eq(organizations.id, job.orgId));
  }

  // 대상 후보자 로드 + 검증 — 일정 제시에 쓰는 컬럼만(id·name·email·phone·stage·outcome).
  // 전체 select() 는 resume_text·resume_masked_text·screening_report 까지 최대 50명분을
  // 끌어왔다(GOTCHAS §0-0-5). 누락 컬럼은 tsc 가 사용처에서 잡는다.
  const targets = await db
    .select({
      id: candidates.id,
      name: candidates.name,
      email: candidates.email,
      phone: candidates.phone,
      stage: candidates.stage,
      outcome: candidates.outcome,
    })
    .from(candidates)
    .where(
      and(
        eq(candidates.jobId, jobId),
        inArray(candidates.id, body.candidateIds)
      )
    );
  if (targets.length === 0)
    return new Response("유효한 후보자 없음", { status: 400 });

  // round2 가드 — 1차 합격 후보만 2차 일정 제시 가능.
  if (round === "round2") {
    const invalid = targets.filter((c) => c.stage !== "round1_passed");
    if (invalid.length > 0)
      return new Response(
        "2차 면접 일정은 1차 합격 상태의 후보자에게만 제시할 수 있습니다.",
        { status: 400 }
      );
  }

  // SMTP 사전 체크
  if (!(await isSmtpAvailable(job.orgId))) {
    return Response.json(
      {
        code: "smtp_not_configured",
        message:
          "메일 서버가 등록되지 않았습니다. 법인 관리자에게 [메일서버] 등록을 요청해 주세요.",
      },
      { status: 503 }
    );
  }

  const base = process.env.APP_BASE_URL ?? new URL(req.url).origin;
  // 법인 브랜딩(로고+컬러) — 일괄 발송이라 루프 밖에서 1회 조회.
  const branding = await getOrgEmailBranding(job.orgId);
  const results: {
    candidateId: number;
    status: "sent" | "skipped" | "failed";
    reason?: string;
  }[] = [];

  for (const cand of targets) {
    // 종결(합격·불합격·지원취소)된 후보에겐 새 면접 일정을 제시하지 않는다.
    // (interview-link 와 동일 — outcome 도달 후 일정제시 차단, 상태 불일치 방지)
    if (cand.outcome) {
      results.push({
        candidateId: cand.id,
        status: "skipped",
        reason: "이미 종결된 후보자",
      });
      continue;
    }
    if (!cand.email) {
      results.push({
        candidateId: cand.id,
        status: "skipped",
        reason: "이메일 없음",
      });
      continue;
    }
    // 기존 확정(selected)이 있으면 이번 제안은 "변경 재제안" — 메일을 변경형 문구로.
    const priorSelected = await db
      .select({ id: interviewSchedules.id })
      .from(interviewSchedules)
      .where(
        and(
          eq(interviewSchedules.candidateId, cand.id),
          eq(interviewSchedules.round, round),
          eq(interviewSchedules.status, "selected")
        )
      );
    const isReschedule = priorSelected.length > 0;

    // 같은 차수의 이전 active 스케쥴 cancel — 확정(selected) 포함.
    // 확정 후 변경 재제안 시 옛 확정이 남아 화면이 "확정"으로 잘못 표시되거나
    // 리마인더가 옛 시간으로 나가는 것을 방지한다. cancelled 는 감사용 보존.
    await db
      .update(interviewSchedules)
      .set({ status: "cancelled", updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(interviewSchedules.candidateId, cand.id),
          eq(interviewSchedules.round, round),
          or(
            eq(interviewSchedules.status, "pending"),
            eq(interviewSchedules.status, "counter_proposed"),
            eq(interviewSchedules.status, "selected")
          )
        )
      );

    const token = generateScheduleToken();
    const expiresAt = scheduleExpiresAt();
    const [sched] = await db
      .insert(interviewSchedules)
      .values({
        candidateId: cand.id,
        jobId,
        orgId: job.orgId,
        round,
        accessToken: token,
        proposedSlots: slotCheck.slots,
        modeOnline,
        address,
        addressDetail,
        status: "pending",
        proposedByUserId: me!.id,
        expiresAt,
      })
      .returning();

    // 후보자 stage 전환 — round1 만 round1_scheduling 으로. round2 는 stage 변경 없음(round1_passed 유지).
    if (round === "round1") {
      await db
        .update(candidates)
        .set({ stage: "round1_scheduling" })
        .where(eq(candidates.id, cand.id));
    }

    const url = `${base}/schedule/${token}`;
    const mail = buildScheduleProposalEmail({
      candidateName: cand.name,
      jobTitle: job.title,
      orgName: org?.name ?? "법인",
      url,
      expiresAt,
      slots: slotCheck.slots,
      modeOnline,
      address,
      addressDetail,
      round,
      isReschedule,
      branding,
    });

    try {
      await sendMail({
        to: cand.email,
        ...mail,
        orgId: job.orgId,
        audience: "candidate",
        attachments: brandingAttachments(branding),
      });
      // 알림톡 병행 (전화번호 있을 때만, 베스트에포트).
      await sendCandidateAlimtalk("schedule_propose", {
        phone: cand.phone,
        vars: {
          orgName: org?.name ?? null,
          candidateName: cand.name,
          jobTitle: job.title,
          url,
        },
        fallbackText: `[${org?.name ?? "채용"}] ${cand.name}님, ${job.title} 면접 일정을 선택해 주세요: ${url}`,
      });
      results.push({ candidateId: cand.id, status: "sent" });
    } catch (e) {
      results.push({
        candidateId: cand.id,
        status: "failed",
        reason: e instanceof Error ? e.message : String(e),
      });
      // 메일 실패해도 row 는 유지 (수동 재발송 가능). stage 도 유지.
      void sched;
    }
  }

  logAudit(req, {
    actor: me!,
    action: "interview.send_email",
    resourceType: "job" as const,
    resourceId: jobId,
    orgId: job.orgId,
    jobId,
    metadata: {
      kind: "schedule_propose",
      round,
      sent: results.filter((r) => r.status === "sent").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      failed: results.filter((r) => r.status === "failed").length,
    },
  });

  void isNull;
  void sql;
  return Response.json({ ok: true, results });
}
