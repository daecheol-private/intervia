"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { SlotCalendarPicker } from "@/app/components/SlotCalendarPicker";
import { Logo } from "@/app/components/Logo";
import { formatLocalDate } from "@/lib/utils";

type Slot = { start: string; end: string };

/** 지원자 화면 상단 브랜드 — 모든 상태(로딩·확정·취소·일정선택)에 항상 노출. */
function BrandHeader() {
  return (
    <div className="flex justify-center mb-6">
      <Logo size={28} />
    </div>
  );
}

type Info = {
  token: string;
  status:
    | "pending"
    | "selected"
    | "counter_proposed"
    | "withdrawn"
    | "cancelled";
  round?: "round1" | "round2";
  proposedSlots: Slot[];
  modeOnline: boolean;
  address: string | null;
  addressDetail: string | null;
  selectedSlot: Slot | null;
  counterSlots: Slot[] | null;
  onlineMeetingUrl: string | null;
  onlineMeetingNote: string | null;
  expiresAt: string;
  candidateName: string;
  jobTitle: string;
  jobPosition: string;
  orgName: string;
};

function fmtSlot(s: Slot): string {
  const start = new Date(s.start);
  const end = new Date(s.end);
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };
  const endTime = end.toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${start.toLocaleString("ko-KR", opts)} ~ ${endTime}`;
}

export default function SchedulePage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [info, setInfo] = useState<Info | null>(null);
  const [err, setErr] = useState<{ code: string; message: string } | null>(
    null
  );
  const [mode, setMode] = useState<"view" | "counter" | "withdrawn">("view");
  const [busy, setBusy] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const load = async () => {
    const r = await fetch(`/api/schedule/${token}`);
    if (!r.ok) {
      const e = await r.json().catch(() => null);
      setErr(e ?? { code: "error", message: "조회 실패" });
      return;
    }
    setInfo(await r.json());
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const selectSlot = async () => {
    if (selectedIdx == null) return;
    setBusy(true);
    const r = await fetch(`/api/schedule/${token}/select`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slotIndex: selectedIdx }),
    });
    setBusy(false);
    if (!r.ok) {
      alert(await r.text());
      return;
    }
    void load();
  };

  const withdraw = async () => {
    // 본인 확인 — 지원 취소는 본인 정보가 영구 폐기되는 비가역 액션이라, 면접 안내를 받은
    // 이메일을 입력받아 서버에서 일치를 검증한다(링크 유출 시 제3자 취소 차단).
    const email = prompt(
      "지원을 취소하면 더 이상 면접이 진행되지 않으며 본인 정보가 폐기됩니다 (비가역).\n계속하려면 면접 안내를 받으신 이메일을 입력해 주세요."
    );
    if (email == null) return; // 취소
    if (!email.trim()) {
      alert("이메일을 입력해 주세요.");
      return;
    }
    setBusy(true);
    const r = await fetch(`/api/schedule/${token}/withdraw`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim() }),
    });
    setBusy(false);
    if (!r.ok) {
      alert(await r.text());
      return;
    }
    setMode("withdrawn");
  };

  if (err) {
    return (
      <main className="max-w-md mx-auto px-6 py-16">
        <BrandHeader />
        <div className="bg-card border border-danger/40 rounded-2xl p-8 text-center shadow-sm">
          <div className="text-4xl mb-3">⚠️</div>
          <h1 className="text-lg font-bold text-ink">접근 실패</h1>
          <p className="text-sm text-ink-soft mt-3 leading-relaxed">
            {err.message}
          </p>
        </div>
      </main>
    );
  }

  if (!info) {
    return (
      <main className="max-w-md mx-auto px-6 py-16">
        <BrandHeader />
        <div className="text-center text-sm text-ink-muted">불러오는 중...</div>
      </main>
    );
  }

  // 상태별 화면
  if (info.status === "withdrawn" || mode === "withdrawn") {
    return (
      <main className="max-w-md mx-auto px-6 py-16">
        <BrandHeader />
        <div className="bg-card border border-border-default rounded-2xl p-8 text-center shadow-sm">
          <div className="text-4xl mb-3">🗑️</div>
          <h1 className="text-lg font-bold text-ink">지원 취소 완료</h1>
          <p className="text-sm text-ink-soft mt-3 leading-relaxed">
            지원이 취소되었습니다. 관심 가져주셔서 감사합니다.
          </p>
        </div>
      </main>
    );
  }

  if (info.status === "selected" && info.selectedSlot) {
    return (
      <main className="max-w-md mx-auto px-6 py-16">
        <BrandHeader />
        <div className="bg-card border border-primary/30 rounded-2xl p-8 text-center shadow-sm">
          <div className="text-4xl mb-3">✅</div>
          <h1 className="text-lg font-bold text-ink">면접 시간 확정</h1>
          <p className="text-sm text-ink-soft mt-3">
            {info.orgName} · {info.jobTitle}
          </p>
          <div className="mt-4 p-4 bg-surface-alt border border-border-default rounded-xl text-left">
            <div className="text-xs text-ink-muted">일시</div>
            <div className="text-sm font-semibold text-ink mt-1">
              {fmtSlot(info.selectedSlot)}
            </div>
            <div className="text-xs text-ink-muted mt-3">방식</div>
            <div className="text-sm text-ink mt-1">
              {info.modeOnline ? "온라인" : "오프라인"}
              {!info.modeOnline && info.address && (
                <div className="text-xs text-ink-soft mt-1">
                  {info.address}
                  {info.addressDetail && <> {info.addressDetail}</>}
                </div>
              )}
            </div>
            {info.modeOnline && info.onlineMeetingUrl && (
              <>
                <div className="text-xs text-ink-muted mt-3">미팅 링크</div>
                <a
                  href={info.onlineMeetingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-sm text-primary-deep underline mt-1 break-all"
                >
                  {info.onlineMeetingUrl}
                </a>
                {info.onlineMeetingNote && (
                  <div className="mt-2 text-xs text-ink-soft bg-card border border-border-default rounded p-2 whitespace-pre-wrap">
                    {info.onlineMeetingNote}
                  </div>
                )}
              </>
            )}
            {info.modeOnline && !info.onlineMeetingUrl && (
              <div className="mt-3 text-xs text-ink-muted italic">
                미팅 링크는 면접 일정에 가까워지면 별도로 안내해 드립니다.
              </div>
            )}
          </div>
        </div>
      </main>
    );
  }

  // pending / counter_proposed — 선택 또는 역제시 화면
  return (
    <main className="max-w-md mx-auto px-6 py-12">
      <BrandHeader />
      <div className="bg-card border border-border-default rounded-2xl p-6 shadow-sm">
        <header className="text-center pb-5 border-b border-border-default">
          <div className="text-3xl mb-2">📅</div>
          <h1 className="text-lg font-bold text-ink">
            {info.orgName} {info.round === "round2" ? "2차" : "1차"} 면접 일정 선택
          </h1>
          <p className="text-xs text-ink-muted mt-1">{info.jobTitle}</p>
          <p className="text-[11px] text-ink-muted mt-1">
            안녕하세요 {info.candidateName}님 — 가능한 시간을 선택해 주세요.
          </p>
        </header>

        <div className="py-4 text-xs text-ink-soft bg-surface-alt rounded-lg px-3 my-4">
          방식: <strong>{info.modeOnline ? "온라인" : "오프라인"}</strong>
          {!info.modeOnline && info.address && (
            <>
              <br />
              주소: {info.address}
              {info.addressDetail && <> {info.addressDetail}</>}
            </>
          )}
        </div>

        {mode === "view" ? (
          <>
            <h2 className="text-xs font-semibold text-ink-soft mb-2">
              제시된 시간
            </h2>
            <div className="space-y-2">
              {info.proposedSlots.map((s, i) => (
                <label
                  key={i}
                  className={`flex items-center gap-3 px-3 py-3 rounded-lg border cursor-pointer ${
                    selectedIdx === i
                      ? "bg-primary-soft border-primary/40"
                      : "bg-card border-border-default hover:bg-surface-alt"
                  }`}
                >
                  <input
                    type="radio"
                    name="slot"
                    checked={selectedIdx === i}
                    onChange={() => setSelectedIdx(i)}
                  />
                  <span className="text-sm text-ink">{fmtSlot(s)}</span>
                </label>
              ))}
            </div>
            {info.status === "counter_proposed" && info.counterSlots && (
              <p className="text-[11px] text-warning bg-warning-soft border border-warning/40 rounded-lg p-2 mt-3">
                이전에 역제시하신 시간이 면접관 검토 중입니다. 새 시간이 제시될 수 있어요.
              </p>
            )}
            <button
              onClick={selectSlot}
              disabled={busy || selectedIdx == null}
              className="w-full mt-4 px-4 py-3 rounded-lg bg-primary hover:bg-primary-deep text-surface text-sm font-medium disabled:opacity-50"
            >
              {busy ? "처리 중..." : "이 시간으로 확정"}
            </button>
            <div className="flex gap-2 mt-3 text-xs">
              <button
                onClick={() => setMode("counter")}
                className="flex-1 px-3 py-2 rounded-lg border border-border-strong hover:bg-surface-alt text-ink-soft"
              >
                다른 시간 제안하기
              </button>
              <button
                onClick={withdraw}
                disabled={busy}
                className="flex-1 px-3 py-2 rounded-lg border border-danger/40 text-danger hover:bg-danger-soft disabled:opacity-50"
              >
                지원 취소
              </button>
            </div>
          </>
        ) : (
          <CounterForm
            token={token}
            onCancel={() => setMode("view")}
            onSubmitted={() => {
              setMode("view");
              void load();
            }}
          />
        )}

        <p className="text-[10px] text-ink-muted text-center mt-6">
          링크 유효기간:{" "}
          {formatLocalDate(info.expiresAt)}
        </p>
      </div>
      <p className="text-[11px] text-ink-muted text-center mt-4">
        본 페이지는 Intervia 채용 플랫폼에서 발송되었습니다.{" "}
        <Link href="/privacy" className="underline">
          처리방침
        </Link>
      </p>
    </main>
  );
}

function CounterForm({
  token,
  onCancel,
  onSubmitted,
}: {
  token: string;
  onCancel: () => void;
  onSubmitted: () => void;
}) {
  const [slots, setSlots] = useState<Array<{ start: string; end: string }>>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    setBusy(true);
    setErr("");
    if (slots.length === 0) {
      setErr("최소 1개 시간을 추가해 주세요.");
      setBusy(false);
      return;
    }
    const r = await fetch(`/api/schedule/${token}/counter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slots, note }),
    });
    setBusy(false);
    if (!r.ok) {
      setErr(await r.text());
      return;
    }
    alert("역제시 완료. 면접관이 검토 후 다시 안내드립니다.");
    onSubmitted();
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-soft bg-primary-soft border border-primary/30 rounded-lg p-2">
        가능한 시간을 1~5개 제시해 주세요. 면접관이 검토 후 확정 또는 재제시합니다.
      </p>
      <SlotCalendarPicker value={slots} onChange={setSlots} />
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={1000}
        placeholder="추가 안내 사항 (선택)"
        className="w-full text-xs border border-border-strong rounded-lg px-2 py-1.5"
      />
      {err && (
        <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg p-2">
          {err}
        </div>
      )}
      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 px-3 py-2 rounded-lg border border-border-strong text-sm text-ink-soft"
        >
          뒤로
        </button>
        <button
          onClick={submit}
          disabled={busy}
          className="flex-1 px-3 py-2 rounded-lg bg-primary hover:bg-primary-deep text-surface text-sm font-medium disabled:opacity-50"
        >
          {busy ? "전송 중..." : "역제시"}
        </button>
      </div>
    </div>
  );
}
