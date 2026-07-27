"use client";

import { useEffect, useState } from "react";
import { X, UserCheck } from "lucide-react";
import { formatLocalDate } from "@/lib/utils";
import { notify, confirmDialog } from "@/app/components/Dialog";
import type { Job } from "./types";

export function LifecyclePanel({
  job,
  onChanged,
  rightSlot,
}: {
  job: Job;
  onChanged: () => void;
  rightSlot?: React.ReactNode;
}) {
  const [showExtend, setShowExtend] = useState(false);
  const [info, setInfo] = useState<{
    candidateCount: number;
    totalCandidateCount: number;
    perResume: number;
    totalCost: number;
    extensionDays: number;
    currentClosesAt: string;
    daysLeft: number | null;
    allowed: boolean;
    reason: "no_candidates" | "too_early" | null;
    visibleWithinDays: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const status = job.status ?? "active";
  const closesAt = job.closesAt;
  const closedAt = job.closedAt;
  const dLeft = closesAt
    ? Math.ceil((new Date(closesAt).getTime() - Date.now()) / 86_400_000)
    : null;

  const openExtend = async () => {
    setShowExtend(true);
    const r = await fetch(`/api/jobs/${job.id}/extend`);
    if (r.ok) setInfo(await r.json());
  };

  // 재개 — 종결 예정일이 아직 남은 공고만. 실수로 닫았거나 전원 불합격으로 닫힌 공고를 되살린다.
  // 종결 때 일괄 불합격된 후보자는 되돌아오지 않으므로 미리 알린다.
  const doReopen = async () => {
    if (
      !(await confirmDialog(
        "공고를 다시 진행 상태로 되돌립니다. 종결 시 불합격 처리된 후보자는 복구되지 않습니다.",
        { title: "공고 재개", confirmText: "재개" }
      ))
    )
      return;
    setBusy(true);
    const r = await fetch(`/api/jobs/${job.id}/reopen`, { method: "POST" });
    setBusy(false);
    const data = await r.json().catch(() => null);
    if (!r.ok) {
      notify(data?.message ?? "재개 실패", { tone: "danger", title: "재개 실패" });
      return;
    }
    notify("공고를 다시 진행 상태로 되돌렸습니다.", {
      tone: "success",
      title: "공고 재개 완료",
    });
    onChanged();
  };

  const doExtend = async () => {
    setBusy(true);
    const r = await fetch(`/api/jobs/${job.id}/extend`, { method: "POST" });
    setBusy(false);
    const data = await r.json().catch(() => null);
    if (!r.ok) {
      notify(data?.message ?? "연장 실패", { tone: "danger", title: "연장 실패" });
      return;
    }
    notify(
      `공고를 ${data.extensionDays ?? 30}일 연장했습니다. (${data.totalCost} 토큰 차감)`,
      { tone: "success", title: "공고 연장 완료" }
    );
    setShowExtend(false);
    onChanged();
  };

  return (
    <div className="mt-4 pt-4 border-t border-border-default">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-ink-soft flex flex-wrap gap-x-4 gap-y-1">
          {status === "closed" ? (
            <>
              <span className="font-medium text-ink-soft">
                종결됨
                {closedAt
                  ? ` · ${formatLocalDate(closedAt)}`
                  : ""}
              </span>
              <span className="text-warning">
                +7일 후 이력서 PDF 자동 폐기 / +14일 후 후보자 PII 자동 폐기
              </span>
            </>
          ) : (
            <>
              <span>
                종결 예정:{" "}
                <span className="font-medium text-ink">
                  {closesAt ? formatLocalDate(closesAt) : "-"}
                </span>{" "}
                {dLeft != null && (
                  <span
                    className={
                      dLeft <= 3
                        ? "text-danger"
                        : dLeft <= 14
                          ? "text-warning"
                          : "text-ink-soft"
                    }
                  >
                    (D-{dLeft})
                  </span>
                )}
              </span>
              {(job.extensionCount ?? 0) > 0 && (
                <span className="text-ink-muted">
                  연장 {job.extensionCount}회
                </span>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap justify-end">
          {status === "closed" && dLeft != null && dLeft > 0 && (
            <button
              onClick={doReopen}
              disabled={busy}
              className="px-3 py-1.5 rounded-lg border border-primary/30 text-primary-deep hover:bg-primary-soft text-sm disabled:opacity-50"
            >
              공고 재개
            </button>
          )}
          {status === "active" && dLeft != null && dLeft <= 14 && (
            <button
              onClick={openExtend}
              className="px-3 py-1.5 rounded-lg border border-primary/30 text-primary-deep hover:bg-primary-soft text-sm"
            >
              공고 연장
            </button>
          )}
          {rightSlot}
        </div>
      </div>

      {showExtend && (
        <div
          className="fixed inset-0 bg-ink/40 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          onClick={() => setShowExtend(false)}
        >
          <div
            className="bg-card rounded-2xl p-6 w-full max-w-md shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-ink">공고 연장</h3>
            {info ? (
              <div className="mt-4 text-sm text-ink-soft space-y-2">
                <div className="flex justify-between">
                  <span>보관 중 이력서</span>
                  <span className="font-medium">
                    {info.candidateCount}명
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>이력서 단가</span>
                  <span className="font-medium">{info.perResume} 토큰</span>
                </div>
                <div className="flex justify-between border-t pt-2 text-ink">
                  <span>차감 합계</span>
                  <span className="font-bold">
                    {info.totalCost} 토큰
                  </span>
                </div>
                <div className="text-xs text-ink-muted mt-3 bg-surface-alt rounded-lg p-3 space-y-1">
                  <div>종결 예정일이 {info.extensionDays}일 연장됩니다.</div>
                  {info.totalCandidateCount > info.candidateCount && (
                    <div>
                      전체 {info.totalCandidateCount}명 중 불합격·지원취소{" "}
                      {info.totalCandidateCount - info.candidateCount}명은
                      이력서가 폐기되어 과금에서 제외됩니다.
                    </div>
                  )}
                </div>
                {!info.allowed && info.reason === "too_early" && (
                  <div className="text-xs text-warning mt-2 bg-warning-soft border border-warning/30 rounded-lg p-3">
                    ⏳ 종결 {info.visibleWithinDays}일 전부터 연장 가능합니다.
                    (현재 D-{info.daysLeft})
                  </div>
                )}
                {!info.allowed && info.reason === "no_candidates" && (
                  <div className="text-xs text-warning mt-2 bg-warning-soft border border-warning/30 rounded-lg p-3">
                    📋 보관 중인 이력서가 없어 연장이 불필요합니다. (불합격·지원취소 이력서는 보관비용이 없습니다)
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-4 text-sm text-ink-muted">정보 불러오는 중...</div>
            )}
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setShowExtend(false)}
                className="flex-1 px-4 py-2 rounded-lg border border-border-strong text-sm"
              >
                취소
              </button>
              <button
                onClick={doExtend}
                disabled={busy || !info || !info.allowed}
                className="flex-1 px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-surface text-sm font-medium disabled:opacity-50"
              >
                {busy ? "처리 중..." : "연장"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 헤더 우측 하단 컴팩트 면접관 표시 — 이름 칩 + "면접관 지정"(나를 추가) 버튼. */
export function InterviewersInline({ jobId }: { jobId: number }) {
  type Row = {
    userId: number;
    name: string;
    email: string;
    assignedAt: string;
  };
  const [data, setData] = useState<{
    interviewers: Row[];
    me: { isInterviewer: boolean };
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const r = await fetch(`/api/jobs/${jobId}/interviewers`);
    if (r.ok) setData(await r.json());
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const selfAssign = async () => {
    setBusy(true);
    const r = await fetch(`/api/jobs/${jobId}/interviewers`, { method: "POST" });
    setBusy(false);
    if (!r.ok) {
      notify(await r.text(), { tone: "danger", title: "면접관 지정 실패" });
      return;
    }
    void load();
  };

  const remove = async (userId: number, name: string) => {
    if (
      !(await confirmDialog(`${name} 님을 면접관에서 제외할까요?`, {
        tone: "danger",
        title: "면접관 제외",
        confirmText: "제외",
      }))
    )
      return;
    setBusy(true);
    const r = await fetch(`/api/jobs/${jobId}/interviewers?userId=${userId}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (!r.ok) {
      notify(await r.text(), { tone: "danger", title: "제외 실패" });
      return;
    }
    void load();
  };

  if (!data) return null;

  return (
    <div
      data-tour="interviewers-inline"
      className="flex items-center flex-wrap justify-end gap-1.5 text-sm"
    >
      <span className="inline-flex items-center gap-1 text-ink-soft font-medium">
        <UserCheck className="w-4 h-4 text-ink-muted" />
        면접관
      </span>
      {data.interviewers.length === 0 ? (
        <span className="text-ink-muted">미지정</span>
      ) : (
        data.interviewers.map((r) => (
          <span
            key={r.userId}
            title={r.email}
            className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-0.5 rounded-full bg-accent-soft text-primary-deep font-semibold ring-1 ring-accent/40"
          >
            {r.name}
            <button
              onClick={() => remove(r.userId, r.name)}
              disabled={busy}
              className="inline-flex items-center text-primary-deep/50 hover:text-danger disabled:opacity-50 leading-none"
              title="면접관에서 제외"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </span>
        ))
      )}
      {!data.me.isInterviewer && (
        <button
          onClick={selfAssign}
          disabled={busy}
          className="px-2.5 py-0.5 rounded-full border border-primary/40 text-primary-deep hover:bg-primary-soft text-xs font-medium disabled:opacity-50"
          title="나를 이 공고의 면접관으로 지정"
        >
          {busy ? "처리 중…" : "+ 면접관 지정"}
        </button>
      )}
    </div>
  );
}
