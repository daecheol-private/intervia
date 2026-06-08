"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { formatKstDateTime, formatLocalDate } from "@/lib/utils";
import { PasswordInput } from "@/app/components/PasswordInput";

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
  if (job.status === "closed") {
    return (
      <span className="text-[11px] px-2 py-0.5 rounded-md bg-slate-200 text-slate-600">
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
        ? "bg-amber-50 text-amber-700 border border-amber-200"
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
      <div className="bg-white border border-dashed border-slate-300 rounded-2xl py-16 text-center">
        <div className="w-12 h-12 rounded-xl bg-slate-100 mx-auto mb-4 flex items-center justify-center text-2xl">
          📋
        </div>
        <h3 className="font-semibold text-slate-900">등록된 공고가 없습니다</h3>
        <p className="text-sm text-slate-500 mt-1">
          첫 공고를 등록하고 AI 면접을 시작해 보세요.
        </p>
        <Link
          href="/jobs/new"
          className="inline-flex mt-5 bg-primary hover:bg-primary-deep text-white text-sm font-medium px-4 py-2 rounded-lg"
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
            className="card-hover bg-white border border-slate-200 rounded-xl p-5 block"
          >
            <div className="flex justify-between items-start gap-3">
              <h2 className="font-semibold text-slate-900 leading-snug line-clamp-2 flex items-center gap-1.5">
                {j.hasPassword && (
                  <span className="text-amber-600" title="비밀번호 보호됨">
                    🔒
                  </span>
                )}
                {j.title}
              </h2>
              <div className="flex flex-col items-end gap-1">
                <DDayBadge job={j} />
                <span className="text-[11px] text-slate-400 whitespace-nowrap">
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
            <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-slate-100">
              <Stat label="지원자" value={j.candidateCount} />
              <Stat label="평가완료" value={j.screenedCount} />
              <Stat label="면접완료" value={j.interviewedCount} />
            </div>
          </Link>
        ))}
      </div>

      {pinJob && (
        <PinModal
          job={pinJob}
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
    <span className="text-[11px] px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">
      {children}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="font-semibold text-slate-900">{value}명</div>
    </div>
  );
}

function PinModal({
  job,
  onClose,
  onUnlocked,
}: {
  job: Job;
  onClose: () => void;
  onUnlocked: () => void;
}) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (pin.length !== 4) {
      setErr("4자리 숫자를 입력하세요.");
      return;
    }
    setErr("");
    setBusy(true);
    const res = await fetch(`/api/jobs/${job.id}/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pin }),
    });
    setBusy(false);
    if (!res.ok) {
      setErr(await res.text());
      setPin("");
      return;
    }
    onUnlocked();
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center">
          <div className="text-3xl mb-2">🔒</div>
          <h3 className="font-bold text-slate-900">{job.title}</h3>
          <p className="text-sm text-slate-500 mt-1">
            공고 비밀번호 4자리를 입력하세요.
          </p>
        </div>
        <div className="mt-5">
          <PasswordInput
            autoFocus
            inputMode="numeric"
            maxLength={4}
            value={pin}
            onChange={(v) => setPin(v.replace(/\D/g, "").slice(0, 4))}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            className="w-full border border-slate-300 rounded-lg px-3 py-3 text-center text-2xl font-mono tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="••••"
          />
        </div>
        {err && <div className="text-xs text-danger mt-2 text-center">{err}</div>}
        <div className="flex gap-2 mt-5">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg border border-slate-300 hover:bg-slate-100 text-sm"
          >
            취소
          </button>
          <button
            onClick={submit}
            disabled={busy || pin.length !== 4}
            className="flex-1 px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-white text-sm font-medium disabled:opacity-50"
          >
            {busy ? "확인 중..." : "확인"}
          </button>
        </div>
      </div>
    </div>
  );
}
