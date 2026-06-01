"use client";

import { useEffect, useState } from "react";
import { SlotCalendarPicker } from "@/app/components/SlotCalendarPicker";

export type ProposeResult = {
  candidateId: number;
  status: "sent" | "skipped" | "failed";
  reason?: string;
};

/**
 * 1차 면접 스케쥴 제시 모달 (controlled).
 *
 * 슬롯 입력 → `POST /api/jobs/[jobId]/schedule-propose` → 후보자에게 시간 선택
 * 링크 메일 발송 + 서버가 stage 를 round1_scheduling 으로 전환.
 *
 * 공고 목록(다수 일괄)과 후보자 상세(단건) 양쪽에서 재사용. 단순 stage PATCH 가
 * 아니라 "일정 제안" 이라는 실제 행위를 수행해야 하므로 이 모달이 정식 진입점이다.
 */
export function ScheduleProposeModal({
  jobId,
  candidateIds,
  open,
  onClose,
  onDone,
  nameById,
  round = "round1",
}: {
  jobId: number;
  candidateIds: number[];
  open: boolean;
  onClose: () => void;
  /** 발송 성공 후 "닫기" 클릭 시 — 부모 데이터 갱신 트리거 */
  onDone: () => void;
  /** 결과 표시에 후보자 이름을 쓰고 싶을 때 (선택). 없으면 #id 로 표시. */
  nameById?: Record<number, string>;
  /** 면접 차수. round2 는 1차 합격 후보에게만(서버 가드). 기본 round1. */
  round?: "round1" | "round2";
}) {
  const roundLbl = round === "round2" ? "2차" : "1차";
  const [slots, setSlots] = useState<Array<{ start: string; end: string }>>([]);
  const [modeOnline, setModeOnline] = useState(true);
  const [address, setAddress] = useState("");
  const [addressDetail, setAddressDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [results, setResults] = useState<{ results: ProposeResult[] } | null>(
    null
  );

  // 모달 열릴 때 org 주소 미리 채움
  useEffect(() => {
    if (!open) return;
    void fetch(`/api/orgs/me`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.officeAddress) setAddress(d.officeAddress);
        if (d?.officeAddressDetail) setAddressDetail(d.officeAddressDetail);
      })
      .catch(() => {});
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    setBusy(true);
    setErr("");
    setResults(null);
    if (slots.length === 0) {
      setErr("최소 1개 시간을 추가해 주세요.");
      setBusy(false);
      return;
    }
    if (!modeOnline && !address.trim()) {
      setErr("오프라인 면접은 주소가 필요합니다.");
      setBusy(false);
      return;
    }
    const r = await fetch(`/api/jobs/${jobId}/schedule-propose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidateIds,
        slots,
        modeOnline,
        address: modeOnline ? null : address.trim(),
        addressDetail: modeOnline ? null : addressDetail.trim(),
        round,
      }),
    });
    setBusy(false);
    if (!r.ok) {
      // schedule-propose 는 SMTP 미설정 등에서 JSON {message} 를 줄 수 있음.
      const ct = r.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        const d = await r.json().catch(() => null);
        setErr(d?.message ?? d?.error ?? "발송에 실패했습니다.");
      } else {
        setErr(await r.text());
      }
      return;
    }
    const data = await r.json();
    setResults({ results: data.results });
  };

  const close = () => {
    setErr("");
    setResults(null);
    setSlots([]);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onClick={close}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 — 고정 */}
        <div className="px-6 pt-6 pb-4 border-b border-slate-100 shrink-0">
          <h3 className="font-bold text-slate-900">{roundLbl} 면접 스케쥴 제시</h3>
          <p className="text-xs text-slate-500 mt-1">
            선택한 {candidateIds.length}명에게 메일로 시간 선택 링크를 발송합니다.
          </p>
        </div>

        {/* 본문 — 스크롤 */}
        <div className="px-6 py-4 overflow-y-auto flex-1">
          {!results ? (
            <div className="space-y-4 text-sm">
              <div>
                <label className="text-xs font-medium text-slate-700 mb-2 block">
                  면접 가능 시간 (1~10개)
                </label>
                <SlotCalendarPicker value={slots} onChange={setSlots} />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-700 mb-1 block">
                  면접 방식
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setModeOnline(true)}
                    className={`flex-1 px-3 py-2 rounded-lg border text-sm ${
                      modeOnline
                        ? "bg-primary-soft border-primary/40 text-primary-deep"
                        : "bg-white border-slate-200 text-slate-500"
                    }`}
                  >
                    💻 온라인
                  </button>
                  <button
                    type="button"
                    onClick={() => setModeOnline(false)}
                    className={`flex-1 px-3 py-2 rounded-lg border text-sm ${
                      !modeOnline
                        ? "bg-primary-soft border-primary/40 text-primary-deep"
                        : "bg-white border-slate-200 text-slate-500"
                    }`}
                  >
                    🏢 오프라인
                  </button>
                </div>
              </div>

              {!modeOnline && (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-700 block">
                    회사 주소
                  </label>
                  <input
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="예: 서울시 강남구 테헤란로 123"
                    className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
                  />
                  <input
                    value={addressDetail}
                    onChange={(e) => setAddressDetail(e.target.value)}
                    placeholder="상세 (호수·층 등, 선택)"
                    className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
                  />
                  <p className="text-[11px] text-slate-500">
                    법인 설정에 주소가 없으면 자동 저장됩니다.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2 text-xs">
              {results.results.map((r) => (
                <div
                  key={r.candidateId}
                  className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border ${
                    r.status === "sent"
                      ? "bg-primary-soft border-primary/30 text-primary-deep"
                      : r.status === "skipped"
                        ? "bg-warning-soft border-warning/30 text-warning"
                        : "bg-danger-soft border-danger/30 text-danger"
                  }`}
                >
                  <span>{nameById?.[r.candidateId] ?? `후보자 #${r.candidateId}`}</span>
                  <span className="font-medium">
                    {r.status === "sent"
                      ? "✓ 발송"
                      : r.status === "skipped"
                        ? `건너뜀 (${r.reason})`
                        : `✗ 실패`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 푸터 — 고정 */}
        <div className="px-6 py-4 border-t border-slate-100 shrink-0">
          {!results ? (
            <>
              {err && (
                <div className="mb-3 text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg p-2 whitespace-pre-wrap">
                  {err}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={close}
                  className="flex-1 px-4 py-2 rounded-lg border border-border-strong text-sm hover:bg-surface-alt transition-colors"
                >
                  취소
                </button>
                <button
                  onClick={submit}
                  disabled={busy}
                  className="flex-1 px-4 py-2 rounded-lg bg-accent-deep hover:bg-accent text-surface text-sm font-medium disabled:opacity-50 transition-colors"
                >
                  {busy ? "발송 중..." : "메일 발송"}
                </button>
              </div>
            </>
          ) : (
            <button
              onClick={() => {
                close();
                onDone();
              }}
              className="w-full px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-white text-sm font-medium"
            >
              닫기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
