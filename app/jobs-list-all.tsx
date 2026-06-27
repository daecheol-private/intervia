"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Lock } from "lucide-react";
import { formatLocalDate } from "@/lib/utils";
import { JobPinModal } from "@/app/components/JobPinModal";

/**
 * '공고' 메뉴(/jobs) 전체 목록.
 *  - 법인당 공고 수가 적으므로 전체 너비 큰 카드를 세로로 쌓는다(작은 그리드 X).
 *  - 카드 크기·형태는 면접관 여부와 무관하게 동일. 면접관 공고만 상단에 모아 정렬.
 *  - 잠긴(블라인드) 공고는 카드는 그대로 두고 지원 현황 수치만 가린다(블러 + 자물쇠).
 *    클릭 시 PIN 팝업 → 해제하면 상세로 이동. 우회 권한자(면접관·법인담당자·관리자)는 블라인드 X.
 */
type Job = {
  id: number;
  title: string;
  position: string;
  level: string;
  employmentType: string;
  interviewDurationMinutes: number;
  createdAt: string;
  hasPassword: boolean;
  mine: boolean;
  blinded: boolean;
  status?: "active" | "closed";
  isDraft?: boolean;
  closesAt?: string | null;
  // 아래 지표는 블라인드가 아닌 공고만 채워진다.
  candidateCount?: number;
  inResume?: number;
  inInterview?: number;
  hiredCount?: number;
};

function daysLeft(closesAt?: string | null): number | null {
  if (!closesAt) return null;
  return Math.ceil((new Date(closesAt).getTime() - Date.now()) / 86_400_000);
}

function DDayBadge({ job }: { job: Job }) {
  if (job.isDraft) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-md bg-warning-soft text-warning border border-warning/40">
        임시 · 작성 필요
      </span>
    );
  }
  if (job.status === "closed") {
    return (
      <span className="text-xs px-2 py-0.5 rounded-md bg-surface-alt text-ink-soft">
        종결됨
      </span>
    );
  }
  const d = daysLeft(job.closesAt);
  if (d == null) return null;
  const tone =
    d <= 3
      ? "bg-danger-soft text-danger border border-danger/30"
      : d <= 14
        ? "bg-warning-soft text-warning border border-warning/40"
        : "bg-primary-soft text-primary-deep border border-primary/30";
  const label = d <= 0 ? "오늘 만료" : `D-${d}`;
  return (
    <span className={`text-xs px-2 py-0.5 rounded-md ${tone}`}>{label}</span>
  );
}

export default function JobsAllList({ jobs }: { jobs: Job[] }) {
  const router = useRouter();
  const [pinJob, setPinJob] = useState<Job | null>(null);

  const mineJobs = jobs.filter((j) => j.mine);
  const otherJobs = jobs.filter((j) => !j.mine);

  // 블라인드 공고 클릭 → 이동 막고 PIN 팝업. 그 외엔 그대로 상세로 이동.
  const handleClick = (job: Job, e: React.MouseEvent) => {
    if (job.blinded) {
      e.preventDefault();
      setPinJob(job);
    }
  };

  if (jobs.length === 0) {
    return (
      <div className="bg-card border border-dashed border-border-strong rounded-2xl py-16 text-center">
        <div className="w-12 h-12 rounded-xl bg-surface-alt mx-auto mb-4 flex items-center justify-center text-2xl">
          📋
        </div>
        <h3 className="font-semibold text-ink">등록된 공고가 없습니다</h3>
        <p className="text-sm text-ink-muted mt-1">
          첫 공고를 등록하고 AI 면접을 시작해 보세요.
        </p>
        <Link
          href="/jobs/new"
          className="inline-flex mt-5 bg-primary hover:bg-primary-deep text-surface text-sm font-medium px-4 py-2 rounded-lg"
        >
          새 공고 등록
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {mineJobs.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-ink mb-3">
            내 면접 공고{" "}
            <span className="font-normal text-ink-muted">{mineJobs.length}</span>
          </h2>
          <div className="space-y-4">
            {mineJobs.map((j) => (
              <JobCard key={j.id} job={j} onClick={handleClick} />
            ))}
          </div>
        </section>
      )}

      {otherJobs.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-ink mb-3">
            그 외 공고{" "}
            <span className="font-normal text-ink-muted">{otherJobs.length}</span>
          </h2>
          <div className="space-y-4">
            {otherJobs.map((j) => (
              <JobCard key={j.id} job={j} onClick={handleClick} />
            ))}
          </div>
        </section>
      )}

      {pinJob && (
        <JobPinModal
          jobId={pinJob.id}
          title={pinJob.title}
          onClose={() => setPinJob(null)}
          onUnlocked={() => {
            setPinJob(null);
            router.push(`/jobs/${pinJob.id}`);
          }}
        />
      )}
    </div>
  );
}

/** 공고 카드 — 전체 너비. 좌: 직무 정보 / 우: 지원 현황. 잠긴 공고는 지원 현황만 블라인드. */
function JobCard({
  job: j,
  onClick,
}: {
  job: Job;
  onClick: (job: Job, e: React.MouseEvent) => void;
}) {
  const total = j.candidateCount ?? 0;
  const inResume = j.inResume ?? 0;
  const inInterview = j.inInterview ?? 0;
  const hired = j.hiredCount ?? 0;
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);

  return (
    <Link
      href={`/jobs/${j.id}`}
      onClick={(e) => onClick(j, e)}
      className="card-hover bg-card border border-border-default rounded-2xl p-5 sm:p-6 grid gap-5 lg:grid-cols-[1fr_auto] lg:gap-10 lg:items-center block"
    >
      {/* 좌 — 직무 정보 */}
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold text-ink leading-snug flex items-start gap-2 min-w-0">
            {j.blinded && (
              <Lock
                className="w-[18px] h-[18px] mt-0.5 text-ink-muted shrink-0"
                aria-label="비밀번호 보호됨"
              />
            )}
            <span className="line-clamp-2">{j.title}</span>
          </h2>
          {/* D-Day/등록일 — 모바일에선 제목 옆, 데스크톱에선 우측 컬럼 위로 올라간다 */}
          <div className="flex flex-col items-end gap-1 shrink-0 lg:hidden">
            <DDayBadge job={j} />
            <span className="text-[11px] text-ink-muted whitespace-nowrap">
              {formatLocalDate(j.createdAt)}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-3">
          <Tag>{j.position}</Tag>
          <Tag>{j.level}</Tag>
          <Tag>{j.employmentType}</Tag>
          <Tag>{j.interviewDurationMinutes ?? 20}분</Tag>
        </div>
      </div>

      {/* 우 — 지원 현황 (지표 + 진행 막대). 데스크톱은 고정폭, 모바일은 전체폭. */}
      <div className="lg:w-[420px] border-t lg:border-t-0 lg:border-l border-border-default pt-4 lg:pt-0 lg:pl-10">
        {/* D-Day/등록일 — 데스크톱 전용 (우측 상단) */}
        <div className="hidden lg:flex items-center justify-end gap-2 mb-3">
          <DDayBadge job={j} />
          <span className="text-[11px] text-ink-muted whitespace-nowrap">
            {formatLocalDate(j.createdAt)}
          </span>
        </div>
        <div className="flex items-end justify-between gap-2">
          <BigStat label="지원자" value={total} blinded={j.blinded} />
          <BigStat label="서류" value={inResume} blinded={j.blinded} />
          <BigStat label="면접" value={inInterview} blinded={j.blinded} />
          <BigStat label="합격" value={hired} blinded={j.blinded} success />
        </div>

        {j.blinded ? (
          <>
            <div
              className="mt-4 h-2.5 rounded-full bg-surface-alt blur-[2px] select-none"
              aria-hidden
            />
            <div className="mt-2 flex items-center gap-1.5 text-xs text-ink-muted">
              <Lock className="w-3.5 h-3.5 shrink-0" />
              비밀번호를 입력하면 지원 현황을 볼 수 있습니다
            </div>
          </>
        ) : (
          <div
            className="mt-4 h-2.5 rounded-full overflow-hidden bg-surface-alt flex"
            title={`서류 ${inResume} · 면접 ${inInterview} · 합격 ${hired}`}
          >
            <div style={{ width: `${pct(inResume)}%`, background: "#94a3b8" }} />
            <div style={{ width: `${pct(inInterview)}%`, background: "#4f46e5" }} />
            <div style={{ width: `${pct(hired)}%`, background: "#2f8f6f" }} />
          </div>
        )}
      </div>
    </Link>
  );
}

function BigStat({
  label,
  value,
  blinded,
  success,
}: {
  label: string;
  value: number;
  blinded: boolean;
  success?: boolean;
}) {
  return (
    <div className="text-center">
      <div
        className={
          "text-2xl font-bold tabular-nums leading-none " +
          (success ? "text-success " : "text-ink ") +
          (blinded ? "blur-[4px] select-none" : "")
        }
        aria-hidden={blinded || undefined}
      >
        {blinded ? "••" : value}
      </div>
      <div className="text-[11px] text-ink-muted mt-1.5">{label}</div>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs px-2 py-0.5 rounded-md bg-surface-alt text-ink-soft">
      {children}
    </span>
  );
}
