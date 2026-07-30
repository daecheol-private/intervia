/**
 * 1차 면접 스케쥴 제시 — 체크한 후보자 다수에게 시간 슬롯 제시 + 메일 발송.
 *
 * 입력:
 *  - candidateIds: number[]  (round1_candidate 또는 round1_scheduling 상태 후보)
 *  - slots: [{start, end}]   (1~10개, 미래 시각)
 *  - modeOnline: boolean
 *  - address?, addressDetail?  (modeOnline=false 시 필수)
 *  - shareRecipients?: [{email, name?, userId?, report?}]  일정 확정·변경·취소를 함께 받을 사람(선택).
 *    report=true 면 확정·변경 안내에 평가 리포트 공유 링크가 함께 나간다(취소 안내엔 미포함).
 *
 * 동작:
 *  - 각 후보자별로 기존 active 스케쥴(pending/counter_proposed) 을 'cancelled' 로 마킹
 *  - 새 interview_schedules row 생성 (status='pending')
 *  - candidates.stage = 'round1_scheduling'
 *  - 후보자에게 메일 발송 (/schedule/[token])
 *  - 오프라인 면접 주소가 입력되면 org_addresses 에 저장(중복은 건너뜀)
 *
 * GET: 이 공고·차수의 직전 제안에 쓰인 공유 수신자 반환 — 모달이 프리필한다.
 */
import { db } from "@/lib/db";
import {
  jobPostings,
  candidates,
  interviewSchedules,
  organizations,
} from "@/lib/schema";
import { ensureOrgAddress } from "@/lib/org-address";
import { and, desc, eq, inArray, sql, isNull, isNotNull, or } from "drizzle-orm";
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
import { getJobContactEmail } from "@/lib/job-contact";
import {
  requireSpendableBalance,
  insufficientTokensResponse,
} from "@/lib/wallet-guard";
import {
  normalizeShareRecipients,
  sendScheduleShareEmails,
} from "@/lib/schedule-share";

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
    shareRecipients?: unknown;
  } | null;
  if (!body) return new Response("바디 필요", { status: 400 });

  const share = normalizeShareRecipients(body.shareRecipients);
  if (!share.ok) return new Response(share.error, { status: 400 });

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

  // 메일·알림톡 발신자 표기에 쓰는 법인명.
  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, job.orgId));

  // 면접 장소 주소 자동 저장 — 실제로 면접을 잡은 장소는 다음에도 쓸 가능성이 높으므로
  // 주소록에 남긴다(이미 있으면 중복 없이 그대로). 필요 없어지면 법인 설정에서 삭제한다.
  if (address && !modeOnline)
    await ensureOrgAddress(job.orgId, address, addressDetail);

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
  // 채용 담당자 문의처 — 지원자 메일 하단 안내. 공고 단위라 루프 밖 1회.
  const contactEmail = await getJobContactEmail(jobId);
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
    // 공유 수신자 통지에 쓸 옛 확정 정보(시간·수신자)도 같이 확보한다.
    const [priorSelected] = await db
      .select()
      .from(interviewSchedules)
      .where(
        and(
          eq(interviewSchedules.candidateId, cand.id),
          eq(interviewSchedules.round, round),
          eq(interviewSchedules.status, "selected")
        )
      );
    const isReschedule = !!priorSelected;

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

    // 확정돼 있던 일정을 무르는 경우 — 회의실을 잡아둔 공유 수신자에게 취소를 알린다.
    // 새 시간은 아직 미정이라 확정 안내는 지원자가 시간을 고른 뒤 별도로 나간다.
    if (priorSelected?.selectedSlot) {
      try {
        await sendScheduleShareEmails({
          sched: priorSelected,
          slot: priorSelected.selectedSlot,
          kind: "cancelled",
          cancelReason:
            "면접 일정 변경으로 기존 일정이 취소되었습니다. 새 일정이 확정되면 다시 안내드립니다.",
        });
      } catch (e) {
        console.error("[schedule-propose] 기존 일정 취소 공유 실패", e);
      }
    }

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
        shareRecipients: share.list.length > 0 ? share.list : null,
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
      contactEmail,
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
      // 후보자 정보가 면접관 외 누구에게 나가는지 추적 — 주소 자체를 남긴다(내부 감사용).
      shareRecipients: share.list.map((r) => r.email),
      // 평가 결론까지 나가는 지정이면 별도 표시 — 일정 정보보다 민감하다.
      shareReport: share.list.some((r) => r.report),
    },
  });

  void isNull;
  void sql;
  return Response.json({ ok: true, results });
}

/**
 * 이 공고·차수에서 마지막으로 지정된 공유 수신자 — 일정 모달이 프리필한다.
 * 공유 수신자는 제안 건별 스냅샷이라 재제안 때 다시 입력해야 하는 것을 덜어준다.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const userGuard = requireUser(me);
  if (userGuard) return userGuard;

  const { id } = await params;
  const jobId = Number(id);
  const [job] = await db
    .select({ orgId: jobPostings.orgId })
    .from(jobPostings)
    .where(eq(jobPostings.id, jobId));
  if (!job) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, job.orgId))
    return new Response("Not found", { status: 404 });

  const url = new URL(req.url);
  const round = url.searchParams.get("round") === "round2" ? "round2" : "round1";
  const [last] = await db
    .select({ shareRecipients: interviewSchedules.shareRecipients })
    .from(interviewSchedules)
    .where(
      and(
        eq(interviewSchedules.jobId, jobId),
        eq(interviewSchedules.round, round),
        isNotNull(interviewSchedules.shareRecipients)
      )
    )
    .orderBy(desc(interviewSchedules.id))
    .limit(1);

  return Response.json({ shareRecipients: last?.shareRecipients ?? [] });
}
