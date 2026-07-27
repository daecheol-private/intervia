"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Pencil, Monitor, Building2 } from "lucide-react";
import { SlotCalendarPicker } from "@/app/components/SlotCalendarPicker";
import {
  ShareRecipientPicker,
  type ShareRecipient,
} from "@/app/components/ShareRecipientPicker";

export type ProposeResult = {
  candidateId: number;
  status: "sent" | "skipped" | "failed";
  reason?: string;
};

/**
 * 면접 일정 모달 (controlled) — 두 가지 입력 방식을 토글로 제공.
 *
 * 1) 시간 제안 (기본): 슬롯 입력 → `POST /api/jobs/[jobId]/schedule-propose`
 *    → 후보자에게 시간 선택 링크 메일 발송 + 서버가 stage 를 round1_scheduling 전환.
 * 2) 직접 확정: 전화 등으로 협의된 시간 1개 →
 *    후보자별 `POST /api/candidates/[id]/schedule-manual` → 즉시 확정(selected) 등록.
 *    후보자 메일은 선택(기본 미발송), 면접관 인앱 알림은 서버가 발송.
 *
 * 공고 목록(다수 일괄)과 후보자 상세(단건) 양쪽에서 재사용. 단순 stage PATCH 가
 * 아니라 "일정 제안/확정" 이라는 실제 행위를 수행해야 하므로 이 모달이 정식 진입점이다.
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
  const [mode, setMode] = useState<"propose" | "direct">("propose");
  const [slots, setSlots] = useState<Array<{ start: string; end: string }>>([]);
  const [durationMin, setDurationMin] = useState(60);
  const [notify, setNotify] = useState(false);
  const [modeOnline, setModeOnline] = useState(false);
  const [address, setAddress] = useState("");
  const [addressDetail, setAddressDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // 확정·변경·취소 안내를 함께 받을 사람(면접관 외). 직전 제안 값으로 프리필한다.
  const [shareRecipients, setShareRecipients] = useState<ShareRecipient[]>([]);
  const [results, setResults] = useState<{ results: ProposeResult[] } | null>(
    null
  );

  // 제안(다수 슬롯)과 직접 확정(단일 슬롯)은 입력 형태가 달라 전환 시 초기화.
  const switchMode = (m: "propose" | "direct") => {
    if (m === mode) return;
    setMode(m);
    setSlots([]);
    setErr("");
  };

  // 소요 시간 변경 시 이미 선택한 슬롯의 종료 시각 재계산 (직접 확정 모드).
  const changeDuration = (min: number) => {
    setDurationMin(min);
    setSlots((prev) =>
      prev[0]
        ? [
            {
              start: prev[0].start,
              end: new Date(
                new Date(prev[0].start).getTime() + min * 60_000
              ).toISOString(),
            },
          ]
        : prev
    );
  };

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

  // 직전 제안에서 쓴 공유 수신자 프리필 — 회의실·인사팀 담당자는 보통 매번 같다.
  useEffect(() => {
    if (!open) return;
    void fetch(`/api/jobs/${jobId}/schedule-propose?round=${round}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (Array.isArray(d?.shareRecipients) && d.shareRecipients.length > 0)
          setShareRecipients(d.shareRecipients);
      })
      .catch(() => {});
  }, [open, jobId, round]);

  if (!open) return null;

  const submit = async () => {
    setBusy(true);
    setErr("");
    setResults(null);
    if (slots.length === 0) {
      setErr(
        mode === "direct"
          ? "면접 일시를 선택해 주세요."
          : "최소 1개 시간을 추가해 주세요."
      );
      setBusy(false);
      return;
    }
    if (!modeOnline && !address.trim()) {
      setErr("오프라인 면접은 주소가 필요합니다.");
      setBusy(false);
      return;
    }

    // 직접 확정 — 후보자별 즉시 확정 등록 (메일 링크 없음)
    if (mode === "direct") {
      const out: ProposeResult[] = [];
      for (const cid of candidateIds) {
        try {
          const r = await fetch(`/api/candidates/${cid}/schedule-manual`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              round,
              slot: slots[0],
              modeOnline,
              address: modeOnline ? null : address.trim(),
              addressDetail: modeOnline ? null : addressDetail.trim(),
              notifyCandidate: notify,
              shareRecipients,
            }),
          });
          if (r.ok) {
            const d = (await r.json().catch(() => null)) as {
              candidateMail?: { sent: boolean } | null;
            } | null;
            const mailFailed = notify && d?.candidateMail && !d.candidateMail.sent;
            out.push({
              candidateId: cid,
              status: "sent",
              reason: mailFailed ? "메일 발송 실패" : undefined,
            });
          } else {
            const ct = r.headers.get("content-type") ?? "";
            const reason = ct.includes("application/json")
              ? (((await r.json().catch(() => null)) as { message?: string } | null)
                  ?.message ?? "실패")
              : await r.text();
            out.push({ candidateId: cid, status: "failed", reason });
          }
        } catch (e) {
          out.push({
            candidateId: cid,
            status: "failed",
            reason: e instanceof Error ? e.message : String(e),
          });
        }
      }
      setBusy(false);
      setResults({ results: out });
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
        shareRecipients,
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
    setMode("propose");
    setNotify(false);
    setDurationMin(60);
    setShareRecipients([]); // 다음 열림에 직전 제안 값으로 다시 프리필된다.
    onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-ink/40 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onClick={close}
    >
      <div
        className="bg-card rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 — 고정 */}
        <div className="px-6 pt-6 pb-4 border-b border-border-default shrink-0">
          <h3 className="font-bold text-ink">{roundLbl} 면접 스케쥴 제시</h3>
          <p className="text-xs text-ink-muted mt-1">
            {mode === "direct"
              ? `전화 등으로 협의된 시간을 선택한 ${candidateIds.length}명의 확정 일정으로 바로 등록합니다.`
              : `선택한 ${candidateIds.length}명에게 메일로 시간 선택 링크를 발송합니다.`}
          </p>
        </div>

        {/* 본문 — 스크롤 */}
        <div className="px-6 py-4 overflow-y-auto flex-1">
          {!results ? (
            <div className="space-y-4 text-sm">
              <div>
                <label className="text-xs font-medium text-ink-soft mb-1 block">
                  입력 방식
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => switchMode("propose")}
                    className={`flex-1 px-3 py-2 rounded-lg border text-left ${
                      mode === "propose"
                        ? "bg-primary-soft border-primary/40 text-primary-deep"
                        : "bg-card border-border-default text-ink-muted"
                    }`}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      <CalendarClock className="w-4 h-4" strokeWidth={2.25} />
                      시간 제안
                    </span>
                    <span className="block text-[10px] mt-0.5 opacity-80">
                      후보자가 메일 링크로 시간 선택
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => switchMode("direct")}
                    className={`flex-1 px-3 py-2 rounded-lg border text-left ${
                      mode === "direct"
                        ? "bg-primary-soft border-primary/40 text-primary-deep"
                        : "bg-card border-border-default text-ink-muted"
                    }`}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      <Pencil className="w-4 h-4" strokeWidth={2.25} />
                      직접 확정
                    </span>
                    <span className="block text-[10px] mt-0.5 opacity-80">
                      전화 등으로 협의된 시간 즉시 등록
                    </span>
                  </button>
                </div>
              </div>

              {mode === "propose" ? (
                <div>
                  <label className="text-xs font-medium text-ink-soft mb-2 block">
                    면접 가능 시간 (1~10개)
                  </label>
                  <SlotCalendarPicker value={slots} onChange={setSlots} />
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-medium text-ink-soft">
                      면접 일시
                    </label>
                    <label className="flex items-center gap-2">
                      <span className="text-xs text-ink-muted">소요 시간</span>
                      <select
                        value={durationMin}
                        onChange={(e) => changeDuration(Number(e.target.value))}
                        className="border border-border-strong rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                      >
                        <option value={30}>30분</option>
                        <option value={60}>1시간</option>
                        <option value={90}>1시간 30분</option>
                        <option value={120}>2시간</option>
                      </select>
                    </label>
                  </div>
                  <SlotCalendarPicker
                    value={slots}
                    onChange={setSlots}
                    single
                    durationMin={durationMin}
                  />
                </div>
              )}

              <div>
                <label className="text-xs font-medium text-ink-soft mb-1 block">
                  면접 방식
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setModeOnline(true)}
                    className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-sm ${
                      modeOnline
                        ? "bg-primary-soft border-primary/40 text-primary-deep"
                        : "bg-card border-border-default text-ink-muted"
                    }`}
                  >
                    <Monitor className="w-4 h-4" strokeWidth={2.25} />
                    온라인
                  </button>
                  <button
                    type="button"
                    onClick={() => setModeOnline(false)}
                    className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-sm ${
                      !modeOnline
                        ? "bg-primary-soft border-primary/40 text-primary-deep"
                        : "bg-card border-border-default text-ink-muted"
                    }`}
                  >
                    <Building2 className="w-4 h-4" strokeWidth={2.25} />
                    오프라인
                  </button>
                </div>
              </div>

              {!modeOnline && (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-ink-soft block">
                    회사 주소
                  </label>
                  <input
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="예: 서울시 강남구 테헤란로 123"
                    className="w-full text-sm border border-border-strong rounded-lg px-3 py-2"
                  />
                  <input
                    value={addressDetail}
                    onChange={(e) => setAddressDetail(e.target.value)}
                    placeholder="상세 (호수·층 등, 선택)"
                    className="w-full text-sm border border-border-strong rounded-lg px-3 py-2"
                  />
                  <p className="text-[11px] text-ink-muted">
                    법인 설정에 주소가 없으면 자동 저장됩니다.
                  </p>
                </div>
              )}

              <ShareRecipientPicker
                jobId={jobId}
                value={shareRecipients}
                onChange={setShareRecipients}
              />

              {mode === "direct" && (
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notify}
                    onChange={(e) => setNotify(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span className="text-xs text-ink-soft leading-relaxed">
                    후보자에게 확정 안내 메일 발송
                    <span className="block text-[11px] text-ink-muted">
                      미체크 시 메일 없이 등록만 합니다 (면접관 공유용). 공고
                      면접관에게는 인앱 알림이 전달됩니다.
                    </span>
                  </span>
                </label>
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
                      ? `✓ ${mode === "direct" ? "확정 등록" : "발송"}${r.reason ? ` (${r.reason})` : ""}`
                      : r.status === "skipped"
                        ? `건너뜀 (${r.reason})`
                        : `✗ 실패${r.reason ? ` (${r.reason})` : ""}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 푸터 — 고정 */}
        <div className="px-6 py-4 border-t border-border-default shrink-0">
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
                  {mode === "direct"
                    ? busy
                      ? "등록 중..."
                      : "확정 등록"
                    : busy
                      ? "발송 중..."
                      : "메일 발송"}
                </button>
              </div>
            </>
          ) : (
            <button
              onClick={() => {
                close();
                onDone();
              }}
              className="w-full px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-surface text-sm font-medium"
            >
              닫기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
