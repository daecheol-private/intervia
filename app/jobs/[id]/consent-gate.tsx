"use client";

import Link from "next/link";

/**
 * 지원자 AI 평가 고지 확인 게이트 (1-click 인라인).
 * - 미확인: 인라인 안내 + 체크박스 (체크 시 즉시 onConfirm).
 * - 확인: 슬림 success 배너 + 해제 버튼.
 * - 감사 로그(IP/시각/유저)가 서버에서 자동 기록되므로 모달·이중 확인 불필요.
 */
export function ApplicantConsentGate({
  confirmed,
  busy,
  onConfirm,
  onRevoke,
}: {
  confirmed: boolean;
  busy: boolean;
  onConfirm: () => void | Promise<void>;
  onRevoke: () => void | Promise<void>;
}) {
  if (confirmed) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-2.5 flex items-center gap-2.5">
        <div className="flex-1 min-w-0 text-xs text-emerald-800">
          <span className="text-emerald-600 mr-1.5" aria-hidden>✓</span>
          AI 평가 적용 고지 확인됨 — 업로드 가능합니다.
        </div>
        <button
          onClick={onRevoke}
          disabled={busy}
          className="shrink-0 text-xs text-emerald-700 hover:text-emerald-900 hover:underline disabled:opacity-50"
        >
          해제
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border-2 border-primary/40 bg-primary-soft/40 px-4 py-3 ring-1 ring-primary/10">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={false}
          disabled={busy}
          onChange={(e) => {
            if (e.target.checked) void onConfirm();
          }}
          className="mt-1 h-4 w-4 accent-primary"
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-slate-900 leading-relaxed">
            <span className="text-primary font-semibold">이력서 업로드를 위해 확인 필요 →</span>{" "}
            본 공고에 <strong>&quot;AI 평가 적용 + 거부 시 일반 절차 가능&quot;</strong>{" "}
            을 지원자에게 안내했음을 확인합니다.
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            PIPA §37의2 고지 의무 — 확인 시각·IP 가 감사 로그에 기록됩니다.{" "}
            <Link
              href="/legal/applicant-consent-template"
              target="_blank"
              className="text-slate-600 hover:text-slate-900 underline"
            >
              표준 안내 문구 보기
            </Link>
          </div>
        </div>
      </label>
    </div>
  );
}
