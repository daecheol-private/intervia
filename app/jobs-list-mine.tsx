import Link from "next/link";
import { formatLocalDate } from "@/lib/utils";

/**
 * '내가 면접관인 공고' 전용 카드 — 진행 막대(서류→면접→합격)와
 * 면접관 관점의 '내 할 일'(단계별 결정 대기)을 보여준다.
 *
 * 이 목록의 공고는 전부 로그인 사용자가 면접관인 공고라, 서버(isJobUnlocked)가
 * PIN 잠금을 항상 우회한다 — 카드에 잠금 모달/자물쇠를 두지 않는다(클릭 즉시 진입).
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
  status?: "active" | "closed";
  isDraft?: boolean;
  closesAt?: string | null;
  candidateCount: number;
  inResume: number;
  inInterview: number;
  hiredCount: number;
  screenedDecision: number;
  pendingDecision: number;
  round1Candidates: number;
  round1Passed: number;
  round2Passed: number;
};

function daysLeft(closesAt?: string | null): number | null {
  if (!closesAt) return null;
  return Math.ceil((new Date(closesAt).getTime() - Date.now()) / 86_400_000);
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

// '내 할 일' 단계 — 0 인 항목은 카드에서 숨긴다. 라벨/판정은 대시보드 알림과 일치.
const TODO_DEFS: { key: keyof Job; label: string }[] = [
  { key: "screenedDecision", label: "면접 진행 결정" },
  { key: "pendingDecision", label: "합·불 결정" },
  { key: "round1Candidates", label: "1차 일정 제시" },
  { key: "round1Passed", label: "2차 진행 결정" },
  { key: "round2Passed", label: "최종 결정" },
];

export default function MyInterviewerJobsList({ jobs }: { jobs: Job[] }) {
  if (jobs.length === 0) {
    return (
      <div className="bg-card border border-dashed border-border-strong rounded-2xl py-16 text-center">
        <div className="w-12 h-12 rounded-xl bg-surface-alt mx-auto mb-4 flex items-center justify-center text-2xl">
          🎤
        </div>
        <h3 className="font-semibold text-ink">
          면접관으로 지정된 공고가 없습니다
        </h3>
        <p className="text-sm text-ink-muted mt-1">
          공고를 직접 등록하거나, 관리자에게 면접관 지정을 요청하세요.
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
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {jobs.map((j) => {
        const total = j.candidateCount;
        const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
        const inProgress = j.inResume + j.inInterview;
        const todos = TODO_DEFS.map((t) => ({
          label: t.label,
          n: j[t.key] as number,
        })).filter((t) => t.n > 0);
        const todoTotal = todos.reduce((s, t) => s + t.n, 0);

        return (
          <Link
            key={j.id}
            href={`/jobs/${j.id}`}
            className="card-hover bg-card border border-border-default rounded-xl p-5 flex flex-col gap-3.5 block"
          >
            {/* 헤더 — 제목 + D-Day/등록일 */}
            <div className="flex justify-between items-start gap-3">
              <h2 className="font-semibold text-ink leading-snug line-clamp-2">
                {j.title}
              </h2>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <DDayBadge job={j} />
                <span className="text-[11px] text-ink-muted whitespace-nowrap">
                  {formatLocalDate(j.createdAt)}
                </span>
              </div>
            </div>

            {/* 태그 */}
            <div className="flex flex-wrap gap-1.5">
              <Tag>{j.position}</Tag>
              <Tag>{j.level}</Tag>
              <Tag>{j.employmentType}</Tag>
              <Tag>{j.interviewDurationMinutes ?? 20}분</Tag>
            </div>

            {/* 진행 상황 — 막대 + 요약 */}
            <div className="pt-3 border-t border-border-default">
              <div className="flex items-center justify-between text-[11px] mb-1.5">
                <span className="text-ink-muted">진행 상황</span>
                <span className="text-ink-soft tabular-nums">
                  지원 {total} · 진행 {inProgress} · 합격 {j.hiredCount}
                </span>
              </div>
              {total > 0 ? (
                <div
                  className="flex h-2 rounded-full overflow-hidden bg-surface-alt"
                  title={`서류 ${j.inResume} · 면접 ${j.inInterview} · 합격 ${j.hiredCount}`}
                >
                  <div
                    style={{ width: `${pct(j.inResume)}%`, background: "#94a3b8" }}
                  />
                  <div
                    style={{ width: `${pct(j.inInterview)}%`, background: "#4f46e5" }}
                  />
                  <div
                    style={{ width: `${pct(j.hiredCount)}%`, background: "#2f8f6f" }}
                  />
                </div>
              ) : (
                <div className="text-[11px] text-ink-muted">
                  아직 지원자가 없습니다
                </div>
              )}
            </div>

            {/* 내 할 일 — 단계별 결정 대기. 없으면 '처리할 일 없음'. */}
            <div className="pt-3 border-t border-border-default">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] text-ink-muted">내 할 일</span>
                {todoTotal > 0 && (
                  <span className="text-[11px] font-semibold text-primary-deep tabular-nums">
                    {todoTotal}건
                  </span>
                )}
              </div>
              {todos.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {todos.map((t) => (
                    <span
                      key={t.label}
                      className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-primary-soft text-primary-deep border border-primary/30 font-medium"
                    >
                      {t.label}
                      <span className="tabular-nums font-bold">{t.n}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-[11px] text-ink-muted">
                  ✓ 지금 처리할 일 없음
                </div>
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] px-2 py-0.5 rounded-md bg-surface-alt text-ink-soft">
      {children}
    </span>
  );
}
