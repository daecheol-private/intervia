"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { formatKstDateTime, formatLocalDate } from "@/lib/utils";
import { JobPinModal } from "@/app/components/JobPinModal";

type Job = {
  id: number;
  title: string;
  position: string;
  level: string;
  employmentType: string;
  interviewDurationMinutes: number;
  createdAt: string;
  hasPassword: boolean;
  candidateCount: number;
  screenedCount: number;
  interviewedCount: number;
  status?: "active" | "closed";
  isDraft?: boolean;
  publishedAt?: string;
  closesAt?: string;
  closedAt?: string | null;
  extensionCount?: number;
};

function daysLeft(closesAt?: string): number | null {
  if (!closesAt) return null;
  const ms = new Date(closesAt).getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
}

function DDayBadge({ job }: { job: Job }) {
  if (job.isDraft) {
    return (
      <span className="text-[11px] px-2 py-0.5 rounded-md bg-warning-soft text-warning border border-warning/40">
        임시 · 작성 필요
      </span>
    );
  }
  if (job.status === "closed") {
    return (
      <span className="text-[11px] px-2 py-0.5 rounded-md bg-surface-alt text-ink-soft">
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
    <span className={`text-[11px] px-2 py-0.5 rounded-md ${tone}`}>{label}</span>
  );
}

export default function JobsList({
  jobs,
  isAdmin,
}: {
  jobs: Job[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [pinJob, setPinJob] = useState<Job | null>(null);

  const handleClick = (job: Job, e: React.MouseEvent) => {
    // 관리자는 잠금 우회
    if (job.hasPassword && !isAdmin) {
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
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {jobs.map((j) => (
          <Link
            key={j.id}
            href={`/jobs/${j.id}`}
            onClick={(e) => handleClick(j, e)}
            className="card-hover bg-card border border-border-default rounded-xl p-5 block"
          >
            <div className="flex justify-between items-start gap-3">
              <h2 className="font-semibold text-ink leading-snug line-clamp-2 flex items-center gap-1.5">
                {j.hasPassword && (
                  <span className="text-warning" title="비밀번호 보호됨">
                    🔒
                  </span>
                )}
                {j.title}
              </h2>
              <div className="flex flex-col items-end gap-1">
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
            <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-border-default">
              <Stat label="지원자" value={j.candidateCount} />
              <Stat label="평가완료" value={j.screenedCount} />
              <Stat label="면접완료" value={j.interviewedCount} />
            </div>
          </Link>
        ))}
      </div>

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
    </>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] px-2 py-0.5 rounded-md bg-surface-alt text-ink-soft">
      {children}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-[11px] text-ink-muted">{label}</div>
      <div className="font-semibold text-ink">{value}명</div>
    </div>
  );
}

