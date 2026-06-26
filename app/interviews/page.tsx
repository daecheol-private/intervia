import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { and, eq, inArray } from "drizzle-orm";
import { CalendarClock, Video, MapPin } from "lucide-react";
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
import { formatSlotKst, roundLabel } from "@/lib/schedules";
import { AppShell } from "@/app/components/AppShell";

export const dynamic = "force-dynamic";

type Slot = { start: string; end: string };

// 협의 중 상태의 라벨/톤 — 서버 컴포넌트 로컬 상수(client 전용 schedule-box 와 분리).
const NEGO_META: Record<
  "pending" | "counter_proposed",
  { label: string; cls: string }
> = {
  pending: {
    label: "지원자 응답 대기",
    cls: "bg-warning-soft text-warning border-warning/30",
  },
  counter_proposed: {
    label: "역제시 — 시간 확정 필요",
    cls: "bg-accent-soft text-accent-deep border-accent/40",
  },
};

function kstDateKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

/**
 * 면접 일정 — 내가(또는 법인이) 진행하는 대면 1·2차 면접을 시간순으로 모아 본다.
 * 범위: 확정(selected) + 협의 중(pending·counter_proposed). AI 면접은 일정이 아니라 제외.
 * 데이터 범위(역할별 차등): member = 면접관 배정 공고 / org_admin = 법인 전체.
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
      : inArray(
          interviewSchedules.jobId,
          myJobIds.length ? myJobIds : [-1]
        );

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

  // 다가오는 확정 면접 — 오늘 / 이번 주 / 이후 그룹.
  const todayKey = kstDateKey(new Date(nowMs).toISOString());
  const groupOf = (startIso: string): "today" | "week" | "later" => {
    const d = Math.round(
      (Date.parse(kstDateKey(startIso)) - Date.parse(todayKey)) / 86_400_000
    );
    if (d <= 0) return "today";
    if (d <= 6) return "week";
    return "later";
  };
  const groups: { key: "today" | "week" | "later"; label: string; rows: Row[] }[] =
    [
      { key: "today", label: "오늘", rows: [] },
      { key: "week", label: "이번 주", rows: [] },
      { key: "later", label: "이후", rows: [] },
    ];
  for (const r of upcoming) {
    const g = groupOf(r.selectedSlot!.start);
    groups.find((x) => x.key === g)!.rows.push(r);
  }

  const railCollapsed =
    (await cookies()).get("iv_rail_collapsed")?.value === "1";
  const isEmpty =
    upcoming.length === 0 && negotiating.length === 0 && past.length === 0;

  return (
    <AppShell
      userName={me.name}
      role={me.role}
      isAdmin={me.isAdmin}
      isDev={process.env.NODE_ENV !== "production"}
      defaultCollapsed={railCollapsed}
    >
      <main className="max-w-5xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-ink">면접 일정</h1>
          <p className="text-sm text-ink-soft mt-1">
            {me.role === "org_admin"
              ? "법인의 대면 1·2차 면접 일정을 한 곳에서 확인하세요."
              : "내가 면접관으로 참여하는 대면 면접 일정을 한 곳에서 확인하세요."}
          </p>
        </header>

        {/* 요약 */}
        <div className="flex flex-wrap gap-2 mb-6 text-sm">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-soft text-primary-deep font-medium">
            <CalendarClock className="w-4 h-4" />
            다가오는 면접 {upcoming.length}건
          </span>
          {negotiating.length > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-warning-soft text-warning font-medium">
              일정 협의 중 {negotiating.length}건
            </span>
          )}
        </div>

        {isEmpty ? (
          <div className="bg-card border border-dashed border-border-strong rounded-2xl py-16 text-center">
            <CalendarClock className="w-8 h-8 text-ink-muted mx-auto mb-3" />
            <p className="text-sm text-ink-soft">예정된 면접이 없습니다.</p>
            <p className="text-xs text-ink-muted mt-1">
              공고 상세에서 후보자에게 1·2차 면접 일정을 제시하면 여기에 모입니다.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* 확정 면접 — 시간 그룹 */}
            {upcoming.length > 0 && (
              <section>
                <SectionHeading>확정 면접</SectionHeading>
                <div className="space-y-5">
                  {groups
                    .filter((g) => g.rows.length > 0)
                    .map((g) => (
                      <div key={g.key}>
                        <div className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
                          {g.label}{" "}
                          <span className="text-ink-muted/70">
                            ({g.rows.length})
                          </span>
                        </div>
                        <ul className="space-y-2">
                          {g.rows.map((r) => (
                            <ConfirmedRow
                              key={r.id}
                              r={r}
                              locked={
                                r.jobPasswordHash != null && !unlocked(r.jobId)
                              }
                            />
                          ))}
                        </ul>
                      </div>
                    ))}
                </div>
              </section>
            )}

            {/* 일정 협의 중 */}
            {negotiating.length > 0 && (
              <section>
                <SectionHeading>일정 협의 중</SectionHeading>
                <ul className="space-y-2">
                  {negotiating.map((r) => (
                    <NegotiatingRow
                      key={r.id}
                      r={r}
                      locked={r.jobPasswordHash != null && !unlocked(r.jobId)}
                    />
                  ))}
                </ul>
              </section>
            )}

            {/* 지난 면접 · 결과 입력 */}
            {past.length > 0 && (
              <section>
                <SectionHeading>지난 면접 · 결과 입력</SectionHeading>
                <ul className="space-y-2">
                  {past.map((r) => (
                    <ConfirmedRow
                      key={r.id}
                      r={r}
                      locked={r.jobPasswordHash != null && !unlocked(r.jobId)}
                      past
                    />
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </main>
    </AppShell>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-sm font-semibold text-ink mb-3">{children}</h2>
  );
}

function Initial({ name, locked }: { name: string; locked: boolean }) {
  return (
    <div className="w-9 h-9 rounded-full bg-surface-alt text-ink-soft flex items-center justify-center text-sm font-bold shrink-0">
      {locked ? "🔒" : name.trim().charAt(0).toUpperCase() || "?"}
    </div>
  );
}

function RoundBadge({ round }: { round: "round1" | "round2" }) {
  return (
    <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-surface-alt text-ink-soft border border-border-default font-medium">
      {roundLabel(round)} 면접
    </span>
  );
}

/** 확정 면접 한 줄 — 행 전체가 후보자 상세 링크, 화상 '참가'만 별도 새 탭. */
function ConfirmedRow({
  r,
  locked,
  past = false,
}: {
  r: {
    id: number;
    candidateId: number;
    candidateName: string;
    jobTitle: string;
    round: "round1" | "round2";
    selectedSlot: Slot | null;
    modeOnline: boolean;
    address: string | null;
    addressDetail: string | null;
    onlineMeetingUrl: string | null;
  };
  locked: boolean;
  past?: boolean;
}) {
  const name = locked ? "비공개 후보자" : r.candidateName;
  const jobTitle = locked ? "🔒 비공개 공고" : r.jobTitle;
  return (
    <li
      className={
        "relative bg-card border border-border-default rounded-xl px-4 py-3 hover:bg-surface-alt/50 transition-colors " +
        (past ? "opacity-80" : "")
      }
    >
      <Link
        href={`/candidates/${r.candidateId}`}
        aria-label={`${name} 면접 상세`}
        className="absolute inset-0 rounded-xl"
      />
      <div className="relative pointer-events-none flex items-center gap-3">
        <Initial name={r.candidateName} locked={locked} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold text-ink tabular-nums">
              {r.selectedSlot ? formatSlotKst(r.selectedSlot) : "—"}
            </span>
            <RoundBadge round={r.round} />
            <span className="inline-flex items-center gap-1 text-[11px] text-ink-soft">
              {r.modeOnline ? (
                <>
                  <Video className="w-3 h-3" /> 온라인
                </>
              ) : (
                <>
                  <MapPin className="w-3 h-3" /> 대면
                </>
              )}
            </span>
          </div>
          <div className="text-[12px] text-ink-soft truncate mt-0.5">
            {name} · {jobTitle}
            {!r.modeOnline && r.address && !locked && (
              <span className="text-ink-muted"> · {r.address}</span>
            )}
          </div>
        </div>
        {/* 화상 참가 — Link 위에 떠서 클릭 가능(pointer-events 복구) */}
        {r.modeOnline && r.onlineMeetingUrl && !locked && (
          <a
            href={r.onlineMeetingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="relative pointer-events-auto shrink-0 inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-primary/40 text-primary-deep hover:bg-primary-soft transition-colors"
          >
            <Video className="w-3.5 h-3.5" /> 참가
          </a>
        )}
      </div>
    </li>
  );
}

/** 협의 중 한 줄 — 상태 배지 + 제시한 시간들. */
function NegotiatingRow({
  r,
  locked,
}: {
  r: {
    candidateId: number;
    candidateName: string;
    jobTitle: string;
    round: "round1" | "round2";
    status: "pending" | "selected" | "counter_proposed" | "withdrawn" | "cancelled";
    proposedSlots: Slot[];
    counterSlots: Slot[] | null;
  };
  locked: boolean;
}) {
  const name = locked ? "비공개 후보자" : r.candidateName;
  const jobTitle = locked ? "🔒 비공개 공고" : r.jobTitle;
  const meta =
    r.status === "counter_proposed"
      ? NEGO_META.counter_proposed
      : NEGO_META.pending;
  // 역제시면 후보자가 새로 낸 시간(counterSlots), 아니면 면접관이 제시한 시간(proposedSlots).
  const slots =
    r.status === "counter_proposed" && r.counterSlots?.length
      ? r.counterSlots
      : r.proposedSlots;
  return (
    <li className="relative bg-card border border-border-default rounded-xl px-4 py-3 hover:bg-surface-alt/50 transition-colors">
      <Link
        href={`/candidates/${r.candidateId}`}
        aria-label={`${name} 면접 일정`}
        className="absolute inset-0 rounded-xl"
      />
      <div className="relative pointer-events-none flex items-start gap-3">
        <Initial name={r.candidateName} locked={locked} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={`text-[11px] px-2 py-0.5 rounded-md border font-medium ${meta.cls}`}
            >
              {meta.label}
            </span>
            <RoundBadge round={r.round} />
          </div>
          <div className="text-[12px] text-ink-soft truncate mt-0.5">
            {name} · {jobTitle}
          </div>
          {slots.length > 0 && (
            <div className="text-[11px] text-ink-muted mt-1 space-y-0.5">
              {slots.slice(0, 3).map((s, i) => (
                <div key={i}>· {formatSlotKst(s)}</div>
              ))}
              {slots.length > 3 && <div>외 {slots.length - 3}건</div>}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
