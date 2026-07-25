import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { and, eq, inArray } from "drizzle-orm";
import { CalendarClock } from "lucide-react";
import { db } from "@/lib/db";
import {
  interviewSchedules,
  candidates,
  jobPostings,
  jobInterviewers,
} from "@/lib/schema";
import { getCurrentUser } from "@/lib/auth";
import { getUnlockChecker } from "@/lib/job-lock";
import { isScheduleSuperseded } from "@/lib/stage-meta";
import { AppShell } from "@/app/components/AppShell";
import {
  InterviewCalendar,
  type CalEvent,
  type NegoEvent,
} from "./interview-calendar";

export const dynamic = "force-dynamic";

function kstDateKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

/**
 * 면접 일정 — 내가(또는 법인이) 진행하는 대면 1·2차 면접을 월간 캘린더로 본다.
 * 범위: 확정(selected) + 협의 중(pending·counter_proposed). AI 면접은 일정이 아니라 제외.
 * 데이터 범위(역할별 차등): member = 면접관 배정 공고 / org_admin = 법인 전체.
 * 표시: 확정 면접 → 캘린더 칩 / 협의 중(시간 미확정) → 캘린더 아래 별도 섹션(client).
 */
export default async function InterviewsPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (me.role === "system_admin") redirect("/admin/dashboard");

  // 면접관 배정 공고 — member 스코프 + (역할 무관) PIN 우회 판정.
  const ir = await db
    .select({ jobId: jobInterviewers.jobId })
    .from(jobInterviewers)
    .where(eq(jobInterviewers.userId, me.id));
  const myJobIds = ir.map((r) => r.jobId);
  const interviewerSet = new Set(myJobIds);

  // 데이터 범위(역할별 차등): org_admin = 법인 전체 / member = 면접관 배정 공고만.
  const scopeFilter =
    me.role === "org_admin"
      ? eq(jobPostings.orgId, me.orgId ?? -1)
      : inArray(interviewSchedules.jobId, myJobIds.length ? myJobIds : [-1]);

  const baseRows = await db
    .select({
      id: interviewSchedules.id,
      candidateId: interviewSchedules.candidateId,
      candidateName: candidates.name,
      candidateStage: candidates.stage,
      candidateOutcome: candidates.outcome,
      jobId: interviewSchedules.jobId,
      jobTitle: jobPostings.title,
      jobPasswordHash: jobPostings.passwordHash,
      round: interviewSchedules.round,
      status: interviewSchedules.status,
      selectedSlot: interviewSchedules.selectedSlot,
      proposedSlots: interviewSchedules.proposedSlots,
      counterSlots: interviewSchedules.counterSlots,
      modeOnline: interviewSchedules.modeOnline,
      address: interviewSchedules.address,
      addressDetail: interviewSchedules.addressDetail,
      onlineMeetingUrl: interviewSchedules.onlineMeetingUrl,
    })
    .from(interviewSchedules)
    .innerJoin(candidates, eq(candidates.id, interviewSchedules.candidateId))
    .innerJoin(jobPostings, eq(jobPostings.id, interviewSchedules.jobId))
    .where(
      and(
        scopeFilter,
        inArray(interviewSchedules.status, [
          "selected",
          "pending",
          "counter_proposed",
        ])
      )
    );

  const unlocked = await getUnlockChecker(me, interviewerSet);

  type Row = (typeof baseRows)[number];
  const nowMs = Date.now();
  const upcoming: Row[] = [];
  const past: Row[] = [];
  const negotiating: Row[] = [];

  for (const r of baseRows) {
    // 종결됐거나 해당 회차를 이미 지난(결과 확정된) 일정은 제외 — 유효 일정만.
    if (r.candidateOutcome != null) continue;
    if (
      isScheduleSuperseded({
        stage: r.candidateStage,
        outcome: r.candidateOutcome,
        round: r.round,
      })
    )
      continue;

    if (r.status === "selected" && r.selectedSlot) {
      const endMs = new Date(r.selectedSlot.end).getTime();
      if (endMs >= nowMs) upcoming.push(r);
      else past.push(r);
    } else if (r.status === "pending" || r.status === "counter_proposed") {
      negotiating.push(r);
    }
  }

  upcoming.sort(
    (a, b) =>
      new Date(a.selectedSlot!.start).getTime() -
      new Date(b.selectedSlot!.start).getTime()
  );
  past.sort(
    (a, b) =>
      new Date(b.selectedSlot!.end).getTime() -
      new Date(a.selectedSlot!.end).getTime()
  );
  // 역제시(액션 필요)를 위로.
  negotiating.sort(
    (a, b) =>
      (a.status === "counter_proposed" ? 0 : 1) -
      (b.status === "counter_proposed" ? 0 : 1)
  );

  // 직렬화 + 잠금 마스킹 — locked 후보자의 실명/공고명/주소/링크는 client 로 보내지 않는다.
  const toCal = (r: Row, isPast: boolean): CalEvent => {
    const locked = r.jobPasswordHash != null && !unlocked(r.jobId);
    return {
      id: r.id,
      candidateId: r.candidateId,
      candidateName: locked ? "비공개 후보자" : r.candidateName,
      jobTitle: locked ? "비공개 공고" : r.jobTitle,
      round: r.round,
      start: r.selectedSlot!.start,
      end: r.selectedSlot!.end,
      modeOnline: r.modeOnline,
      address: locked ? null : r.address,
      onlineMeetingUrl: locked ? null : r.onlineMeetingUrl,
      locked,
      past: isPast,
    };
  };
  const calEvents: CalEvent[] = [
    ...upcoming.map((r) => toCal(r, false)),
    ...past.map((r) => toCal(r, true)),
  ];

  const negoEvents: NegoEvent[] = negotiating.map((r) => {
    const locked = r.jobPasswordHash != null && !unlocked(r.jobId);
    // 역제시면 후보자가 새로 낸 시간(counterSlots), 아니면 면접관이 제시한 시간(proposedSlots).
    const slots =
      (r.status === "counter_proposed" && r.counterSlots?.length
        ? r.counterSlots
        : r.proposedSlots) ?? [];
    return {
      candidateId: r.candidateId,
      candidateName: locked ? "비공개 후보자" : r.candidateName,
      jobTitle: locked ? "비공개 공고" : r.jobTitle,
      round: r.round,
      status: r.status as "pending" | "counter_proposed",
      slots,
      locked,
    };
  });

  const todayKey = kstDateKey(new Date(nowMs).toISOString());
  // 열자마자 의미 있는 날을 띄운다: 다음 면접 → (없으면) 가장 최근 지난 면접 → 오늘.
  const initialKey =
    upcoming.length > 0
      ? kstDateKey(upcoming[0].selectedSlot!.start)
      : past.length > 0
        ? kstDateKey(past[0].selectedSlot!.start)
        : todayKey;

  const railCollapsed =
    (await cookies()).get("iv_rail_collapsed")?.value === "1";

  return (
    <AppShell
      userName={me.name}
      role={me.role}
      isAdmin={me.isAdmin}
      isDev={process.env.NODE_ENV !== "production"}
      defaultCollapsed={railCollapsed}
    >
      <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
        <header className="mb-6">
          <div className="flex items-center gap-2">
            <CalendarClock className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold text-ink">면접 일정</h1>
          </div>
          <p className="text-sm text-ink-soft mt-1">
            {me.role === "org_admin"
              ? "법인의 대면 1·2차 면접 일정을 한 곳에서 확인하세요."
              : "내가 면접관으로 참여하는 대면 면접 일정을 한 곳에서 확인하세요."}
          </p>
        </header>

        {calEvents.length === 0 && negoEvents.length === 0 ? (
          <div className="bg-card border border-dashed border-border-strong rounded-2xl py-16 px-6 text-center">
            <div className="w-12 h-12 rounded-full bg-surface-alt flex items-center justify-center mx-auto mb-4">
              <CalendarClock className="w-6 h-6 text-ink-muted" />
            </div>
            <h2 className="text-base font-semibold text-ink mb-1">
              아직 예정된 면접이 없습니다
            </h2>
            <p className="text-sm text-ink-soft mb-6 max-w-md mx-auto leading-relaxed">
              공고 상세에서 후보자에게 1·2차 면접 일정을 제시하면 이곳에
              모입니다.
            </p>
            <Link
              href="/jobs"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary-deep transition-colors"
            >
              공고로 가기
            </Link>
          </div>
        ) : (
          <InterviewCalendar
            events={calEvents}
            nego={negoEvents}
            todayKey={todayKey}
            initialKey={initialKey}
          />
        )}
      </main>
    </AppShell>
  );
}
