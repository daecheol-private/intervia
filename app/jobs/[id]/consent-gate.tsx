"use client";

import Link from "next/link";

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
          지원자 안내 완료 — 이제 이력서를 올릴 수 있어요.
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
    <div className="rounded-lg border-2 border-primary/40 bg-primary-soft/40 px-4 py-3.5 ring-1 ring-primary/10">
      <div className="text-sm text-slate-900 leading-relaxed">
        <span className="text-primary font-semibold">마지막 1단계 · 30초</span> — 지원자에게
        “AI 평가를 활용한다”는 안내만 보이면 됩니다.{" "}
        <span className="text-slate-600">새 시스템도, 별도 계약도 필요 없어요.</span>
      </div>
      <div className="text-[13px] text-slate-700 mt-1.5 leading-relaxed">
        공고에 안내 문구 한 줄만 추가하면 끝이에요.{" "}
        <strong>문구와 넣는 방법</strong>은 아래에서 확인하세요.
      </div>

      <div className="mt-2.5">
        <Link
          href="/legal/applicant-consent-template"
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-xs font-medium text-white hover:bg-primary/90"
        >
          📋 안내 문구 보기 · 공고에 넣는 법 →
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
          <div className="text-sm text-slate-900 font-medium">
            공고에 안내 문구를 넣었습니다
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            AI 채용 시 법으로 정해진 지원자 안내예요. 문구는 저희가 다 준비해 뒀습니다.
          </div>
        </div>
      </label>
    </div>
  );
}
