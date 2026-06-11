"use client";

import { useState } from "react";
import { formatKstDateTime } from "@/lib/utils";
import { confirmDialog } from "@/app/components/Dialog";
import { ScheduleProposeModal } from "@/app/components/ScheduleProposeModal";
import type { Schedule } from "./types";

const SCHEDULE_STATUS_LABEL: Record<Schedule["status"], string> = {
  pending: "후보자 응답 대기",
  selected: "확정",
  counter_proposed: "후보자 역제시",
  withdrawn: "지원 취소",
  cancelled: "취소됨",
};
const SCHEDULE_STATUS_COLOR: Record<Schedule["status"], string> = {
  pending: "bg-warning-soft text-warning border-warning/30",
  selected: "bg-primary-soft text-primary-deep border-primary/30",
  counter_proposed: "bg-warning-soft text-warning border-warning/30",
  withdrawn: "bg-slate-100 text-slate-500 border-slate-200",
  cancelled: "bg-slate-100 text-slate-500 border-slate-200",
};

function formatSlot(s: { start: string; end: string }): string {
  const start = formatKstDateTime(s.start);
  const e = new Date(s.end);
  const eh = e.getHours().toString().padStart(2, "0");
  const em = e.getMinutes().toString().padStart(2, "0");
  return `${start} ~ ${eh}:${em}`;
}

export function ScheduleBox({
  schedule,
  jobId,
  candidateId,
  candidateName,
  onChanged,
}: {
  schedule: Schedule;
  jobId: number;
  candidateId: number;
  candidateName: string;
  onChanged: () => void;
}) {
  const selected = schedule.selectedSlot;
  const [confirming, setConfirming] = useState<string | null>(null); // 진행 중인 slot 의 start
  const [confirmErr, setConfirmErr] = useState<string | null>(null);
  const [proposeOpen, setProposeOpen] = useState(false);

  // 후보자가 counter 제시한(또는 HR 가 처음 제시한) 슬롯을 확정.
  const confirmSlot = async (slot: { start: string; end: string }) => {
    if (
      !(await confirmDialog(
        `${formatSlot(slot)} 으로 확정하시겠습니까?\n후보자와 면접관에게 확정 메일이 발송됩니다.`,
        { title: "일정 확정", confirmText: "확정" }
      ))
    )
      return;
    setConfirming(slot.start);
    setConfirmErr(null);
    try {
      const r = await fetch(`/api/schedules/${schedule.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot }),
      });
      if (!r.ok) {
        setConfirmErr(await r.text());
        return;
      }
      onChanged();
    } finally {
      setConfirming(null);
    }
  };

  const canConfirm =
    schedule.status === "counter_proposed" || schedule.status === "pending";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span
          className={`text-xs px-2 py-0.5 rounded-full border ${SCHEDULE_STATUS_COLOR[schedule.status]}`}
        >
          {SCHEDULE_STATUS_LABEL[schedule.status]}
        </span>
        <span className="text-xs text-slate-500">
          {schedule.round === "round1" ? "1차" : "2차"} 면접
        </span>
      </div>

      {selected ? (
        <div className="bg-primary-soft/50 border border-primary/20 rounded-xl p-4">
          <div className="text-xs text-primary-deep font-semibold mb-1">
            확정 일시
          </div>
          <div className="text-base font-semibold text-slate-900">
            {formatSlot(selected)}
          </div>
        </div>
      ) : (
        <div>
          <div className="text-xs font-semibold text-slate-500 mb-2">
            제시된 시간
          </div>
          <ul className="text-sm text-slate-700 space-y-1">
            {schedule.proposedSlots.map((s, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-2"
              >
                <span>· {formatSlot(s)}</span>
                {canConfirm && (
                  <button
                    onClick={() => void confirmSlot(s)}
                    disabled={confirming !== null}
                    className="text-[11px] px-2 py-0.5 rounded-md border border-primary/40 text-primary-deep hover:bg-primary-soft disabled:opacity-50"
                  >
                    {confirming === s.start ? "확정 중..." : "이 시간으로 확정"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {schedule.counterSlots && schedule.counterSlots.length > 0 && !selected && (
        <div>
          <div className="text-xs font-semibold text-warning mb-2">
            후보자 역제시
          </div>
          <ul className="text-sm text-slate-700 space-y-1">
            {schedule.counterSlots.map((s, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span>· {formatSlot(s)}</span>
                {canConfirm && (
                  <button
                    onClick={() => void confirmSlot(s)}
                    disabled={confirming !== null}
                    className="text-[11px] px-2 py-0.5 rounded-md bg-primary text-surface hover:bg-primary-deep disabled:opacity-50"
                  >
                    {confirming === s.start ? "확정 중..." : "이 시간으로 확정"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {confirmErr && (
        <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2">
          {confirmErr}
        </div>
      )}

      {canConfirm && (
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => setProposeOpen(true)}
            className="text-xs px-3 py-1.5 rounded-lg border border-primary/40 text-primary-deep font-medium hover:bg-primary-soft"
          >
            🔄 일정 다시 잡기
          </button>
          <span className="text-[11px] text-slate-500">
            새 시간을 다시 제안하거나, 협의된 시간을 직접 확정할 수 있습니다.
            기존 제안은 취소됩니다.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
        <div>
          <div className="text-xs text-slate-500">방식</div>
          <div className="text-slate-900">
            {schedule.modeOnline ? "온라인" : "오프라인"}
          </div>
        </div>
        {!schedule.modeOnline && schedule.address && (
          <div className="sm:col-span-2">
            <div className="text-xs text-slate-500">주소</div>
            <div className="text-slate-900">
              {schedule.address}
              {schedule.addressDetail ? ` ${schedule.addressDetail}` : ""}
            </div>
          </div>
        )}
      </div>

      {schedule.modeOnline && schedule.status === "selected" && (
        <MeetingLinkPanel schedule={schedule} onChanged={onChanged} />
      )}

      {schedule.candidateNote && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
          <div className="text-xs text-slate-500 mb-1">후보자 메모</div>
          <div className="text-sm text-slate-700 whitespace-pre-wrap">
            {schedule.candidateNote}
          </div>
        </div>
      )}

      <div className="text-xs text-slate-400">
        {schedule.respondedAt
          ? `후보자 응답: ${formatKstDateTime(schedule.respondedAt)}`
          : `링크 만료: ${formatKstDateTime(schedule.expiresAt)}`}
      </div>

      <ScheduleProposeModal
        jobId={jobId}
        candidateIds={[candidateId]}
        nameById={{ [candidateId]: candidateName }}
        round={schedule.round}
        open={proposeOpen}
        onClose={() => setProposeOpen(false)}
        onDone={onChanged}
      />
    </div>
  );
}

function MeetingLinkPanel({
  schedule,
  onChanged,
}: {
  schedule: Schedule;
  onChanged: () => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [url, setUrl] = useState(schedule.onlineMeetingUrl ?? "");
  const [note, setNote] = useState(schedule.onlineMeetingNote ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const hasLink = !!schedule.onlineMeetingUrl;

  const submit = async () => {
    const trimmed = url.trim();
    if (!trimmed.startsWith("https://")) {
      setErr("미팅 링크는 https:// 로 시작해야 합니다.");
      return;
    }
    if (trimmed.length > 100) {
      setErr("100자 이내로 입력해 주세요.");
      return;
    }
    if (/\s/.test(trimmed)) {
      setErr("URL 에 공백이 있습니다.");
      return;
    }
    setBusy(true);
    setErr("");
    const r = await fetch(`/api/schedules/${schedule.id}/meeting-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meetingUrl: trimmed, note: note.trim() || null }),
    });
    setBusy(false);
    if (!r.ok) {
      setErr(await r.text());
      return;
    }
    setModalOpen(false);
    onChanged();
  };

  if (!hasLink) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
        <div className="text-2xl shrink-0" aria-hidden>
          🎥
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-amber-900">
            온라인 미팅 링크가 아직 등록되지 않았습니다
          </div>
          <div className="text-xs text-amber-800 mt-0.5 leading-relaxed">
            Zoom · Google Meet · Teams 등에서 미팅을 먼저 만든 뒤, 링크를 붙여넣어
            후보자에게 안내해 주세요. 캘린더 초대(.ics) 가 자동으로 첨부됩니다.
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="mt-3 px-3 py-1.5 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-lg"
          >
            + 미팅 링크 추가
          </button>
        </div>
        {modalOpen && (
          <MeetingLinkModal
            url={url}
            note={note}
            setUrl={setUrl}
            setNote={setNote}
            err={err}
            busy={busy}
            onSubmit={submit}
            onCancel={() => {
              setModalOpen(false);
              setErr("");
            }}
            title="온라인 미팅 링크 추가"
            submitLabel="저장 및 발송"
          />
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
      <div className="flex items-start gap-3">
        <div className="text-2xl shrink-0" aria-hidden>
          ✅
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-emerald-900">
            미팅 링크 등록 완료
          </div>
          <a
            href={schedule.onlineMeetingUrl!}
            target="_blank"
            rel="noopener noreferrer"
            className="block mt-1 text-xs text-emerald-800 hover:text-emerald-900 underline break-all"
          >
            {schedule.onlineMeetingUrl}
          </a>
          {schedule.onlineMeetingNote && (
            <div className="mt-2 text-xs text-slate-700 bg-white border border-slate-200 rounded p-2 whitespace-pre-wrap">
              {schedule.onlineMeetingNote}
            </div>
          )}
          {schedule.meetingLinkSentAt && (
            <div className="mt-2 text-[11px] text-emerald-700">
              📧 발송 완료 · {formatKstDateTime(schedule.meetingLinkSentAt)}
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => setModalOpen(true)}
              className="px-2.5 py-1 text-xs bg-white border border-emerald-300 hover:bg-emerald-50 text-emerald-700 rounded"
            >
              수정 · 재발송
            </button>
          </div>
        </div>
      </div>
      {modalOpen && (
        <MeetingLinkModal
          url={url}
          note={note}
          setUrl={setUrl}
          setNote={setNote}
          err={err}
          busy={busy}
          onSubmit={submit}
          onCancel={() => {
            setModalOpen(false);
            setErr("");
          }}
          title="미팅 링크 수정 및 재발송"
          submitLabel="저장 및 재발송"
        />
      )}
    </div>
  );
}

function MeetingLinkModal({
  url,
  note,
  setUrl,
  setNote,
  err,
  busy,
  onSubmit,
  onCancel,
  title,
  submitLabel,
}: {
  url: string;
  note: string;
  setUrl: (v: string) => void;
  setNote: (v: string) => void;
  err: string;
  busy: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  title: string;
  submitLabel: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-lg font-bold text-slate-900">{title}</div>
        <div className="mt-1 text-xs text-slate-500">
          Zoom · Google Meet · Teams 등에서 미팅을 먼저 만든 뒤 링크를
          붙여넣어주세요. https:// 로 시작하는 100자 이내 URL.
        </div>
        <label className="block mt-4">
          <span className="text-xs text-slate-600 font-medium">미팅 URL</span>
          <input
            type="url"
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://zoom.us/j/..."
            className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </label>
        <label className="block mt-3">
          <span className="text-xs text-slate-600 font-medium">
            추가 안내 (선택)
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="예) 10분 전 접속해 카메라·마이크 점검 부탁드립니다. 회의실 비번: 12345"
            className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
          />
        </label>
        <div className="mt-3 text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded p-2">
          📅 저장 시 후보자와 면접관에게 미팅 정보 + 캘린더 초대 파일(.ics) 이
          즉시 발송됩니다.
        </div>
        {err && (
          <div className="mt-2 text-xs text-danger bg-danger-soft border border-danger/30 rounded px-2 py-1.5">
            {err}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-2 text-sm text-slate-600 hover:text-slate-900"
          >
            취소
          </button>
          <button
            onClick={onSubmit}
            disabled={busy || url.trim().length === 0}
            className="px-4 py-2 text-sm font-semibold bg-primary hover:bg-primary-deep text-white rounded-lg disabled:opacity-50"
          >
            {busy ? "저장 중..." : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
