"use client";

import { useState } from "react";
import { ScheduleProposeModal } from "@/app/components/ScheduleProposeModal";

export function SchedulePropose({
  jobId,
  selectedIds,
  onDone,
  round = "round1",
}: {
  jobId: number;
  selectedIds: number[];
  onDone: () => void;
  round?: "round1" | "round2";
}) {
  const [open, setOpen] = useState(false);
  const disabled = selectedIds.length === 0;
  const label = round === "round2" ? "2차 일정 제시" : "면접 스케쥴 제시";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="ml-auto text-xs px-3 py-1.5 rounded-md bg-primary hover:bg-primary-deep text-surface font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        title={disabled ? "후보자를 체크하세요" : label}
      >
        📅 {label} ({selectedIds.length})
      </button>
      <ScheduleProposeModal
        jobId={jobId}
        candidateIds={selectedIds}
        round={round}
        open={open}
        onClose={() => setOpen(false)}
        onDone={onDone}
      />
    </>
  );
}

/**
 * 합·불 일괄 처리 모달 — 사유(선택) + 통보 메일 발송 여부 + 맞춤 메시지.
 * 개별 결정(DecisionMenu)과 동일한 입력을 일괄 처리에도 제공한다.
 * 사유 라벨은 서버 전용 모듈(candidate-stage) 의존을 피하려 로컬에 둔다.
 */
export function BulkDecisionModal({
  decision,
  count,
  stages,
  jobTitle,
  companyName,
  busy,
  onCancel,
  onConfirm,
}: {
  decision: "hired" | "rejected";
  count: number;
  stages: string[];
  jobTitle: string;
  companyName?: string | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (opts: {
    reason: string;
    sendMail: boolean;
    customMessage: string;
  }) => void;
}) {
  const label = decision === "hired" ? "최종합격" : "불합격";
  const isReject = decision === "rejected";
  const reasonOptions = isReject
    ? [
        { value: "resume_unfit", label: "서류 부적합" },
        { value: "ai_interview_unfit", label: "AI면접 평가 부적합" },
        { value: "round1_unfit", label: "1차 면접 부적합" },
        { value: "round2_unfit", label: "2차 면접 부적합" },
        { value: "offer_declined", label: "처우협의 결렬" },
        { value: "other", label: "기타" },
      ]
    : [{ value: "passed_final", label: "최종 합격 결정" }];
  // 전형(stage)별 기본 불합격 사유 — 선택 후보들의 stage 중 가장 많은 단계 기준 자동 선택.
  const reasonForStage = (s: string): string =>
    s === "applied" || s === "screened"
      ? "resume_unfit"
      : s === "ai_pending" || s === "ai_evaluated"
      ? "ai_interview_unfit"
      : s.startsWith("round1")
      ? "round1_unfit"
      : s === "round2_passed"
      ? "offer_declined" // 2차 면접 통과 후 불합격 → 처우협의 결렬이 기본
      : "other";
  const autoReason = (() => {
    if (!isReject) return "passed_final";
    const counts: Record<string, number> = {};
    for (const s of stages) {
      const r = reasonForStage(s);
      counts[r] = (counts[r] ?? 0) + 1;
    }
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    // 불합격 사유는 서버에서 필수(§37의2) — 빈 값 방지 위해 기본 사유로 폴백.
    return top ? top[0] : "resume_unfit";
  })();
  // 기본 통보 메일 템플릿 — {이름} 은 발송 시 각 지원자 이름으로 치환된다.
  // (lib/candidate-stage.ts 의 buildDecisionEmail 기본 본문과 동일하게 유지)
  const coName = companyName?.trim() ?? "";
  const co = coName && !jobTitle.includes(coName) ? `${coName} ` : "";
  const defaultBody =
    decision === "hired"
      ? `{이름}님, ${co}${jobTitle} 포지션 최종 합격을 진심으로 축하드립니다.\n\n곧 채용 담당자가 별도로 연락드려 입사 절차를 안내해 드릴 예정입니다.\n감사합니다.`
      : `{이름}님, ${co}${jobTitle} 포지션에 지원해 주셔서 진심으로 감사드립니다.\n\n신중히 검토한 결과, 이번 채용에서는 함께하기 어렵게 되었음을 안내드립니다. 좋은 인연으로 다시 만날 기회가 있기를 기대하며, 앞으로의 여정에 좋은 결과 있으시기를 응원합니다.`;
  const [reason, setReason] = useState<string>(autoReason);
  const [sendMail, setSendMail] = useState(false);
  const [customMessage, setCustomMessage] = useState(defaultBody);

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4"
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="bg-card rounded-xl shadow-xl border border-border-default w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold text-ink mb-1">{label} 일괄 처리</h3>
        <p className="text-sm text-ink-soft">
          선택된 <strong className="text-ink">{count}</strong>명을 "{label}"으로
          일괄 처리합니다.
        </p>

        <div className="mt-3 text-xs text-warning bg-warning-soft border border-warning/30 rounded-lg px-3 py-2 leading-relaxed">
          {isReject
            ? "⚠️ 종결 결정입니다. 이력서 원본·첨부 파일은 즉시 폐기되고, 공고 종결 +14일 후 후보자 정보 전체가 자동 삭제됩니다."
            : "⚠️ 종결 결정입니다. 최종합격으로 처리되며, 이력서·첨부 파일은 입사 절차를 위해 보존됩니다."}
        </div>

        <div className="mt-4">
          <label className="block text-xs font-semibold text-ink-soft mb-1.5">
            {label} 사유 {isReject ? "(필수)" : "(선택)"}
          </label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
            className="w-full px-3 py-2 text-sm border border-border-default rounded-lg bg-card focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
          >
            {reasonOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <label className="mt-4 flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={sendMail}
            onChange={(e) => setSendMail(e.target.checked)}
            disabled={busy}
            className="mt-0.5 w-4 h-4 rounded border-border-default"
          />
          <span className="text-sm text-ink">
            {label} 통보 메일 발송
            <span className="block text-[11px] text-ink-soft">
              이메일이 등록된 후보자에게만 발송됩니다.
            </span>
          </span>
        </label>
        {sendMail && (
          <div className="mt-2">
            <p className="text-[11px] text-ink-soft mb-1">
              아래 내용으로 발송됩니다.{" "}
              <code className="px-1 rounded bg-surface-alt">{"{이름}"}</code> 자리에
              각 지원자 이름이 자동으로 들어갑니다. 직접 수정할 수 있어요.
            </p>
            <textarea
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              rows={8}
              disabled={busy}
              placeholder="통보 메일 본문"
              className="w-full px-3 py-2 text-sm border border-border-default rounded-lg bg-card focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
            />
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 rounded-lg border border-border-default text-sm text-ink-soft hover:bg-surface-alt disabled:opacity-50"
          >
            취소
          </button>
          <button
            onClick={() => onConfirm({ reason, sendMail, customMessage })}
            disabled={busy}
            className={`px-4 py-2 rounded-lg text-sm font-medium text-surface disabled:opacity-50 ${
              isReject
                ? "bg-danger hover:bg-danger/90"
                : "bg-primary hover:bg-primary-deep"
            }`}
          >
            {busy ? "처리 중..." : `${label} 처리`}
          </button>
        </div>
      </div>
    </div>
  );
}
