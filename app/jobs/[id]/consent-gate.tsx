"use client";

import Link from "next/link";
import { ClipboardList } from "lucide-react";

/**
 * 지원자 AI 평가 안내 게이트 (공고당 1회).
 * - 미확인: "마지막 1단계 · 30초" 가이드 — 안내 문구·넣는 법 페이지로 유도 + 체크박스.
 *   (대부분 '공고에 동의 항목을 넣는 법' 자체를 모르므로, 문구만 던지지 않고
 *    방법까지 보여주는 페이지로 이동시켜 거기서 복사하게 한다.)
 * - 확인: 슬림 success 배너 + 해제 버튼.
 *
 * 법적 효력은 그대로: 체크 = 채용기업이 공고에 안내 문구를 넣었다는 진술·보증(약관 §5).
 * 확인 시각은 서버 감사 로그에 기록되나, HR 에게 위협적으로 보이지 않도록 UI 전면에 노출하지 않는다.
 */
export function ApplicantConsentGate({
  confirmed,
  busy,
  jobId,
  aiScreeningDisabled,
  onConfirm,
  onRevoke,
  onSkipScreening,
  onResumeScreening,
}: {
  confirmed: boolean;
  busy: boolean;
  jobId?: number | string;
  aiScreeningDisabled?: boolean;
  onConfirm: () => void | Promise<void>;
  onRevoke: () => void | Promise<void>;
  onSkipScreening?: () => void | Promise<void>;
  onResumeScreening?: () => void | Promise<void>;
}) {
  // 상태 1: AI 이력서 평가 없이 진행 중 — 동의 게이트 대신 안내 배너.
  if (aiScreeningDisabled) {
    return (
      <div className="rounded-lg border border-warning/30 bg-warning-soft/70 px-4 py-2.5 flex items-center gap-2.5">
        <div className="flex-1 min-w-0 text-xs text-warning leading-relaxed">
          <span className="font-semibold">AI 이력서 평가 없이 진행 중</span> — 이력서는
          채용 담당자가 직접 검토하고, AI는 면접 단계(지원자 동의 후)부터 적용됩니다. 이
          경우 공고에 AI 평가 안내를 넣지 않아도 됩니다.
        </div>
        {onResumeScreening && (
          <button
            onClick={onResumeScreening}
            disabled={busy}
            className="shrink-0 text-xs text-warning hover:text-warning hover:underline disabled:opacity-50"
          >
            AI 평가 다시 켜기
          </button>
        )}
      </div>
    );
  }

  if (confirmed) {
    return (
      <div className="rounded-lg border border-success/30 bg-success-soft/60 px-4 py-2.5 flex items-center gap-2.5">
        <div className="flex-1 min-w-0 text-xs text-success">
          <span className="text-success mr-1.5" aria-hidden>✓</span>
          지원자 안내 완료 — 이제 이력서를 올릴 수 있어요.
        </div>
        <button
          onClick={onRevoke}
          disabled={busy}
          className="shrink-0 text-xs text-success hover:text-success hover:underline disabled:opacity-50"
        >
          해제
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border-2 border-primary/40 bg-primary-soft/40 px-4 py-3.5 ring-1 ring-primary/10">
      <div className="text-sm text-ink leading-relaxed">
        <span className="text-primary font-semibold">마지막 1단계 · 30초</span> — 지원자에게
        “AI 평가를 활용한다”는 안내만 보이면 됩니다.{" "}
        <span className="text-ink-soft">새 시스템도, 별도 계약도 필요 없어요.</span>
      </div>
      <div className="text-[13px] text-ink-soft mt-1.5 leading-relaxed">
        공고에 안내 문구 한 줄만 추가하면 끝이에요.{" "}
        <strong>문구와 넣는 방법</strong>은 아래에서 확인하세요.
      </div>

      <div className="mt-2.5">
        <Link
          href={
            jobId
              ? `/legal/applicant-consent-template?jobId=${jobId}`
              : "/legal/applicant-consent-template"
          }
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-xs font-medium text-surface hover:bg-primary/90"
        >
          <ClipboardList className="w-3.5 h-3.5" /> 안내 문구 보기 · 공고에 넣는 법 →
        </Link>
      </div>

      <label className="flex items-start gap-3 cursor-pointer mt-3 pt-3 border-t border-primary/15">
        <input
          type="checkbox"
          checked={false}
          disabled={busy}
          onChange={(e) => {
            if (e.target.checked) void onConfirm();
          }}
          className="mt-0.5 h-4 w-4 accent-primary"
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-ink font-medium">
            공고에 안내 문구를 넣었습니다
          </div>
          <div className="text-[11px] text-ink-muted mt-0.5">
            AI 채용 시 법으로 정해진 지원자 안내예요. 문구는 저희가 다 준비해 뒀습니다.
          </div>
        </div>
      </label>

      {/* 보조 경로 — 동의(고지)를 넣기 어려운 경우: AI 이력서 평가 자체를 끄고 진행.
         서류는 사람이 검토하고 AI 는 면접부터 적용되므로 §37의2 공고 고지가 불요해진다. */}
      {onSkipScreening && (
        <div className="mt-2.5 pt-2.5 border-t border-primary/10 text-center">
          <button
            onClick={onSkipScreening}
            disabled={busy}
            className="text-xs text-ink-muted hover:text-ink-soft hover:underline disabled:opacity-50"
          >
            안내를 넣기 어렵나요? AI 이력서 평가 없이 진행하기 →
          </button>
        </div>
      )}
    </div>
  );
}
