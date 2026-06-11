"use client";

import { useEffect, useState } from "react";

/**
 * 면접 일정 수동 확정 입력 모달.
 *
 * 전화 등으로 이미 합의된 1·2차 면접 시간을 스케쥴 제시(슬롯 메일) 없이
 * 바로 확정 상태로 등록 — `POST /api/candidates/[id]/schedule-manual`.
 * 후보자 메일은 선택(기본 미발송), 면접관 공유용 인앱 알림은 서버가 발송.
 */
export function ScheduleManualModal({
  candidateId,
  candidateName,
  round,
  open,
  onClose,
  onDone,
}: {
  candidateId: number;
  candidateName: string;
  round: "round1" | "round2";
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const roundLbl = round === "round2" ? "2차" : "1차";
  const [start, setStart] = useState("");
  const [durationMin, setDurationMin] = useState(60);
  const [modeOnline, setModeOnline] = useState(true);
  const [address, setAddress] = useState("");
  const [addressDetail, setAddressDetail] = useState("");
  const [notify, setNotify] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // 모달 열릴 때 org 주소 미리 채움 (ScheduleProposeModal 과 동일)
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
    setErr("");
    if (!start) {
      setErr("면접 일시를 입력해 주세요.");
      return;
    }
    const startDate = new Date(start);
    if (Number.isNaN(startDate.getTime())) {
      setErr("일시 형식이 올바르지 않습니다.");
      return;
    }
    if (!modeOnline && !address.trim()) {
      setErr("오프라인 면접은 주소가 필요합니다.");
      return;
    }
    setBusy(true);
    const slot = {
      start: startDate.toISOString(),
      end: new Date(startDate.getTime() + durationMin * 60_000).toISOString(),
    };
    const r = await fetch(`/api/candidates/${candidateId}/schedule-manual`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        round,
        slot,
        modeOnline,
        address: modeOnline ? null : address.trim(),
        addressDetail: modeOnline ? null : addressDetail.trim(),
        notifyCandidate: notify,
      }),
    });
    setBusy(false);
    if (!r.ok) {
      const ct = r.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        const d = await r.json().catch(() => null);
        setErr(d?.message ?? d?.error ?? "등록에 실패했습니다.");
      } else {
        setErr(await r.text());
      }
      return;
    }
    const data = (await r.json().catch(() => null)) as {
      candidateMail?: { sent: boolean; error?: string } | null;
    } | null;
    if (notify && data?.candidateMail && !data.candidateMail.sent) {
      // 일정 자체는 등록됨 — 메일 실패만 알리고 닫는다.
      alert(
        `일정은 등록되었으나 후보자 메일 발송에 실패했습니다: ${data.candidateMail.error ?? "알 수 없는 오류"}`
      );
    }
    close();
    onDone();
  };

  const close = () => {
    setErr("");
    setStart("");
    setNotify(false);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onClick={close}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-4 border-b border-slate-100 shrink-0">
          <h3 className="font-bold text-slate-900">{roundLbl} 면접 일정 직접 입력</h3>
          <p className="text-xs text-slate-500 mt-1">
            전화 등으로 이미 협의된 시간을 {candidateName} 님의 확정 일정으로
            등록합니다. 후보자에게 시간 선택 링크는 발송되지 않습니다.
          </p>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1 space-y-4 text-sm">
          <div className="flex gap-2">
            <label className="flex-1 block">
              <span className="text-xs font-medium text-slate-700">면접 일시</span>
              <input
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </label>
            <label className="block w-28">
              <span className="text-xs font-medium text-slate-700">소요 시간</span>
              <select
                value={durationMin}
                onChange={(e) => setDurationMin(Number(e.target.value))}
                className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value={30}>30분</option>
                <option value={60}>1시간</option>
                <option value={90}>1시간 30분</option>
                <option value={120}>2시간</option>
              </select>
            </label>
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
            </div>
          )}

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={notify}
              onChange={(e) => setNotify(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-xs text-slate-600 leading-relaxed">
              후보자에게 확정 안내 메일 발송
              <span className="block text-[11px] text-slate-400">
                미체크 시 메일 없이 등록만 합니다 (면접관 공유용). 공고
                면접관에게는 인앱 알림이 전달됩니다.
              </span>
            </span>
          </label>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 shrink-0">
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
              onClick={() => void submit()}
              disabled={busy}
              className="flex-1 px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-white text-sm font-medium disabled:opacity-50 transition-colors"
            >
              {busy ? "등록 중..." : "확정 등록"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
