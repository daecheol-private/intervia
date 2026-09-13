import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { CalendarCheck, CalendarX2, Clock, FileQuestion } from "lucide-react";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  candidates,
  interviewSchedules,
  jobPostings,
  organizations,
} from "@/lib/schema";
import {
  emailRef,
  schedulePlaceLabel,
  verifyStaffViewToken,
} from "@/lib/staff-alimtalk";
import { ensureActiveShareLink, SHARE_LINK_DEFAULT_DAYS } from "@/lib/shared-report";
import { formatSlotKst, roundLabel } from "@/lib/schedules";
import { maskPersonName } from "@/lib/email-domain";
import { addDays } from "@/lib/utils";
import { logAudit } from "@/lib/audit";

/**
 * 면접 일정 확정 알림톡의 "지원자 정보 보기" 착지점 — 누른 사람에 따라 보낸다.
 *  - 가입자(면접관·법인 멤버) → 후보자 상세. 로그인·법인 권한은 그 화면이 다시 확인한다.
 *  - 평가 리포트 공유가 허용된 비회원 → 평가 리포트(/shared/[token], 원본 이력서·연락처 제외)
 *  - 그 외 비회원(회의실 담당자 등) → 일정 정보만
 * 링크 자체는 lib/staff-alimtalk.ts 가 수신자별로 서명해 발급한다.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "면접 일정 · Intervia",
  robots: { index: false, follow: false },
};

function StateShell({
  icon,
  title,
  desc,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <main className="mx-auto max-w-lg px-4 py-20 sm:py-28 text-center">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-surface-alt text-ink-muted mb-4">
        {icon}
      </div>
      <h1 className="text-xl font-bold text-ink">{title}</h1>
      <p className="text-sm text-ink-muted mt-2 leading-relaxed">{desc}</p>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-14 shrink-0 text-ink-muted">{label}</dt>
      <dd className="text-ink break-words">{value}</dd>
    </div>
  );
}

export default async function StaffScheduleViewPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const v = verifyStaffViewToken(token);
  if (!v.ok) {
    return v.reason === "expired" ? (
      <StateShell
        icon={<Clock className="w-7 h-7" />}
        title="만료된 링크입니다."
        desc="면접일로부터 열람 기간이 지났습니다. 채용 담당자에게 문의하세요."
      />
    ) : (
      <StateShell
        icon={<FileQuestion className="w-7 h-7" />}
        title="링크를 찾을 수 없습니다."
        desc="주소가 정확한지 확인해 주세요."
      />
    );
  }

  const [sched] = await db
    .select()
    .from(interviewSchedules)
    .where(eq(interviewSchedules.id, v.scheduleId));
  if (!sched) {
    return (
      <StateShell
        icon={<FileQuestion className="w-7 h-7" />}
        title="링크를 찾을 수 없습니다."
        desc="면접 일정이 삭제되었습니다. 채용 담당자에게 문의하세요."
      />
    );
  }

  logAudit(null, {
    action: "staff_view.open",
    actorRole: v.ref.kind === "user" ? "member" : "anonymous",
    resourceType: "interview_schedule",
    resourceId: sched.id,
    orgId: sched.orgId,
    jobId: sched.jobId,
    metadata: { kind: v.ref.kind },
  });

  if (v.ref.kind === "user") redirect(`/candidates/${sched.candidateId}`);

  const ref = v.ref.emailRef;
  const recipient = (sched.shareRecipients ?? []).find(
    (r) => r.userId == null && emailRef(r.email) === ref
  );
  if (!recipient) {
    return (
      <StateShell
        icon={<FileQuestion className="w-7 h-7" />}
        title="열람할 수 없는 링크입니다."
        desc="이 면접 일정의 공유 대상에서 제외되었습니다. 채용 담당자에게 문의하세요."
      />
    );
  }

  if (sched.status !== "selected" || !sched.selectedSlot) {
    return (
      <StateShell
        icon={<CalendarX2 className="w-7 h-7" />}
        title="취소된 면접 일정입니다."
        desc="이 일정은 더 이상 유효하지 않습니다. 새 일정이 잡히면 다시 안내드립니다."
      />
    );
  }

  if (recipient.report) {
    const link = await ensureActiveShareLink({
      candidateId: sched.candidateId,
      orgId: sched.orgId,
      minValidUntil: addDays(new Date(sched.selectedSlot.start), SHARE_LINK_DEFAULT_DAYS),
    });
    redirect(`/shared/${link.token}`);
  }

  // 평가 공유가 허용되지 않은 수신자 — 일정 정보만 보여준다.
  const [cand] = await db
    .select({ name: candidates.name })
    .from(candidates)
    .where(eq(candidates.id, sched.candidateId));
  const [job] = await db
    .select({ title: jobPostings.title })
    .from(jobPostings)
    .where(eq(jobPostings.id, sched.jobId));
  const [org] = sched.orgId
    ? await db
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, sched.orgId))
    : [];

  return (
    <main className="mx-auto max-w-lg px-4 py-16 sm:py-24">
      <div className="bg-card border border-border-default rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-2 text-primary">
          <CalendarCheck className="w-5 h-5" />
          <span className="text-sm font-semibold">{org?.name ?? "채용"} 면접 일정</span>
        </div>
        <dl className="mt-4 space-y-2 text-sm">
          <Row label="공고" value={job?.title ?? "-"} />
          <Row label="차수" value={`${roundLabel(sched.round)} 면접`} />
          <Row label="지원자" value={maskPersonName(cand?.name) || "지원자"} />
          <Row label="일시" value={formatSlotKst(sched.selectedSlot)} />
          <Row label="장소" value={schedulePlaceLabel(sched, sched.onlineMeetingUrl)} />
        </dl>
        <p className="mt-5 text-xs text-ink-muted leading-relaxed">
          평가 리포트는 채용 담당자가 공유를 허용한 경우에만 볼 수 있습니다.
        </p>
      </div>
    </main>
  );
}
