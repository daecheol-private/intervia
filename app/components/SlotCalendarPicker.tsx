"use client";

/**
 * 캘린더 + 시간대 슬롯 입력 컴포넌트.
 *
 * 사용 흐름:
 *  1. 월 캘린더에서 날짜 선택
 *  2. 하단 시간 그리드에서 시작 시간 다수 선택 (08:00 ~ 20:00, 30분 단위)
 *  3. "추가" 버튼 → 선택된 모든 시간을 한 번에 슬롯 목록에 추가
 *  4. 다른 날짜로 이동해 반복
 *  5. 칩 ✕ 클릭으로 개별 제거
 *
 * 면접 길이는 1시간 고정.
 * 출력 포맷: `{ start: ISO, end: ISO }[]` — datetime-local 과 동일.
 */
import { useMemo, useState } from "react";

export type SlotItem = { start: string; end: string };

const MAX_SLOTS = 10;
const DURATION_MIN = 60; // 면접 시간 1시간 고정

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function ymd(d: Date): string {
  // KST 기준 yyyy-mm-dd (날짜 비교용)
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtChip(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const dateLabel = s.toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  });
  const tFmt: Intl.DateTimeFormatOptions = {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };
  return `${dateLabel} ${s.toLocaleTimeString("ko-KR", tFmt)} ~ ${e.toLocaleTimeString("ko-KR", tFmt)}`;
}

const TIME_SLOTS: string[] = (() => {
  const out: string[] = [];
  for (let h = 8; h <= 20; h++) {
    out.push(`${String(h).padStart(2, "0")}:00`);
    if (h < 20) out.push(`${String(h).padStart(2, "0")}:30`);
  }
  return out;
})();

export function SlotCalendarPicker({
  value,
  onChange,
  maxDaysAhead = 60,
  single = false,
  durationMin = DURATION_MIN,
}: {
  value: SlotItem[];
  onChange: (slots: SlotItem[]) => void;
  maxDaysAhead?: number;
  /** 단일 선택 모드 — 시간 클릭 즉시 그 슬롯 하나로 교체 (일정 직접 입력용). */
  single?: boolean;
  /** 면접 길이(분). 기본 60. */
  durationMin?: number;
}) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const maxDate = useMemo(() => {
    const d = startOfDay(today);
    d.setDate(d.getDate() + maxDaysAhead);
    return d;
  }, [today, maxDaysAhead]);
  // 초기 선택일은 '내일' (가장 흔한 케이스 — 당일 면접은 거의 없음).
  const tomorrow = useMemo(() => {
    const d = startOfDay(today);
    d.setDate(d.getDate() + 1);
    return d;
  }, [today]);

  const [view, setView] = useState<Date>(tomorrow);
  const [selectedDay, setSelectedDay] = useState<Date | null>(tomorrow);
  // 같은 날 여러 시간 동시 선택 — "HH:MM" 문자열 집합
  const [selectedTimes, setSelectedTimes] = useState<Set<string>>(new Set());

  const usedDates = useMemo(
    () => new Set(value.map((s) => ymd(new Date(s.start)))),
    [value]
  );

  const gotoMonth = (delta: number) => {
    const next = new Date(view);
    next.setMonth(next.getMonth() + delta);
    setView(next);
  };

  // 캘린더 그리드 — 해당 월 1일 요일부터 시작
  const cells = useMemo(() => {
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const startOffset = first.getDay(); // 0=일
    const last = new Date(view.getFullYear(), view.getMonth() + 1, 0);
    const totalDays = last.getDate();
    const rows: (Date | null)[][] = [];
    let row: (Date | null)[] = [];
    for (let i = 0; i < startOffset; i++) row.push(null);
    for (let d = 1; d <= totalDays; d++) {
      row.push(new Date(view.getFullYear(), view.getMonth(), d));
      if (row.length === 7) {
        rows.push(row);
        row = [];
      }
    }
    if (row.length > 0) {
      while (row.length < 7) row.push(null);
      rows.push(row);
    }
    return rows;
  }, [view]);

  const addSelectedTimes = () => {
    if (!selectedDay || selectedTimes.size === 0) return;
    const existingStarts = new Set(value.map((s) => s.start));
    const toAdd: SlotItem[] = [];
    // 시간순 정렬 보장 위해 sort
    const times = Array.from(selectedTimes).sort();
    for (const t of times) {
      if (value.length + toAdd.length >= MAX_SLOTS) break;
      const [hh, mm] = t.split(":").map(Number);
      const start = new Date(selectedDay);
      start.setHours(hh, mm, 0, 0);
      const end = new Date(start.getTime() + durationMin * 60_000);
      const startIso = start.toISOString();
      if (existingStarts.has(startIso)) continue;
      toAdd.push({ start: startIso, end: end.toISOString() });
      existingStarts.add(startIso);
    }
    if (toAdd.length === 0) return;
    onChange(
      [...value, ...toAdd].sort((a, b) => a.start.localeCompare(b.start))
    );
    setSelectedTimes(new Set());
  };

  const toggleTime = (t: string) => {
    setSelectedTimes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  // 단일 모드 — 클릭 즉시 그 시간 하나로 교체.
  const pickSingle = (t: string) => {
    if (!selectedDay) return;
    const [hh, mm] = t.split(":").map(Number);
    const start = new Date(selectedDay);
    start.setHours(hh, mm, 0, 0);
    onChange([
      {
        start: start.toISOString(),
        end: new Date(start.getTime() + durationMin * 60_000).toISOString(),
      },
    ]);
  };

  const durLabel =
    durationMin % 60 === 0
      ? `${durationMin / 60}시간`
      : durationMin > 60
        ? `${Math.floor(durationMin / 60)}시간 ${durationMin % 60}분`
        : `${durationMin}분`;

  const removeSlot = (idx: number) => {
    const next = [...value];
    next.splice(idx, 1);
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {/* 월 헤더 */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => gotoMonth(-1)}
          className="px-2 py-1 rounded hover:bg-surface-alt text-ink-soft text-sm"
        >
          ‹
        </button>
        <span className="text-sm font-semibold text-ink">
          {view.getFullYear()}년 {view.getMonth() + 1}월
        </span>
        <button
          type="button"
          onClick={() => gotoMonth(1)}
          className="px-2 py-1 rounded hover:bg-surface-alt text-ink-soft text-sm"
        >
          ›
        </button>
      </div>

      {/* 요일 헤더 */}
      <div className="grid grid-cols-7 gap-1 text-[10px] text-ink-muted text-center">
        {["일", "월", "화", "수", "목", "금", "토"].map((d, i) => (
          <div
            key={d}
            className={i === 0 ? "text-rose-500" : i === 6 ? "text-primary" : ""}
          >
            {d}
          </div>
        ))}
      </div>

      {/* 날짜 그리드 */}
      <div className="grid grid-cols-7 gap-1">
        {cells.flat().map((d, i) => {
          if (!d) return <div key={i} />;
          const disabled = d < today || d > maxDate;
          const isSel =
            selectedDay && ymd(d) === ymd(selectedDay) ? true : false;
          const isToday = ymd(d) === ymd(today);
          const hasSlot = usedDates.has(ymd(d));
          const dayOfWeek = d.getDay();
          return (
            <button
              type="button"
              key={i}
              disabled={disabled}
              onClick={() => {
                setSelectedDay(d);
                setSelectedTimes(new Set());
              }}
              className={`relative aspect-square text-xs rounded transition-colors ${
                disabled
                  ? "text-slate-300 cursor-not-allowed"
                  : isSel
                    ? "bg-primary text-white font-semibold"
                    : isToday
                      ? "bg-primary-soft text-primary-deep font-medium hover:bg-primary-soft"
                      : dayOfWeek === 0
                        ? "text-rose-600 hover:bg-slate-100"
                        : dayOfWeek === 6
                          ? "text-primary hover:bg-slate-100"
                          : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              {d.getDate()}
              {hasSlot && (
                <span
                  className={`absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${
                    isSel ? "bg-card" : "bg-accent-deep"
                  }`}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* 시간 선택 영역 — 같은 날 여러 시간 동시 선택 가능 (1시간 고정) */}
      {selectedDay ? (
        <div className="border-t border-border-default pt-3 space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-medium text-ink-soft">
              {selectedDay.toLocaleDateString("ko-KR", {
                month: "long",
                day: "numeric",
                weekday: "short",
              })}{" "}
              시간 선택 ({durLabel})
            </span>
            {!single && (
              <span className="text-[10px] text-ink-muted">
                {selectedTimes.size > 0
                  ? `${selectedTimes.size}개 선택됨`
                  : "여러 개 선택 가능"}
              </span>
            )}
          </div>
          <div className="grid grid-cols-5 sm:grid-cols-6 gap-1">
            {TIME_SLOTS.map((t) => {
              const [hh, mm] = t.split(":").map(Number);
              const start = new Date(selectedDay);
              start.setHours(hh, mm, 0, 0);
              const startIso = start.toISOString();
              const used = !single && value.some((s) => s.start === startIso);
              const picked = single
                ? value.some((s) => s.start === startIso)
                : selectedTimes.has(t);
              return (
                <button
                  type="button"
                  key={t}
                  disabled={used}
                  onClick={() => (single ? pickSingle(t) : toggleTime(t))}
                  className={`text-[11px] px-2 py-1 rounded border ${
                    used
                      ? "bg-slate-100 text-slate-300 border-slate-100 cursor-not-allowed"
                      : picked
                        ? "bg-primary text-white border-primary-deep font-medium"
                        : "bg-white text-slate-700 border-slate-200 hover:border-primary/40"
                  }`}
                >
                  {t}
                </button>
              );
            })}
          </div>
          {!single && (
            <button
              type="button"
              onClick={addSelectedTimes}
              disabled={selectedTimes.size === 0 || value.length >= MAX_SLOTS}
              className="w-full px-3 py-2 rounded-lg bg-primary hover:bg-primary-deep text-surface text-xs font-medium disabled:opacity-40"
            >
              + 선택한 시간 추가{" "}
              {selectedTimes.size > 0 && (
                <span className="opacity-80 font-normal">
                  ({selectedTimes.size}개)
                </span>
              )}
            </button>
          )}
        </div>
      ) : (
        <div className="text-xs text-ink-muted text-center py-3 bg-surface-alt rounded-lg">
          캘린더에서 날짜를 클릭하세요.
        </div>
      )}

      {/* 추가된 슬롯 칩 */}
      {value.length > 0 && (
        <div className="border-t border-border-default pt-3">
          <div className="text-xs font-medium text-ink-soft mb-2">
            {single
              ? "선택한 면접 시간"
              : `제안할 면접 시간 (${value.length}/${MAX_SLOTS})`}
          </div>
          <div className="space-y-1.5">
            {value.map((s, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-2 px-2 py-1.5 bg-primary-soft border border-primary/30 rounded-md text-xs"
              >
                <span className="text-primary-deep">{fmtChip(s.start, s.end)}</span>
                <button
                  type="button"
                  onClick={() => removeSlot(i)}
                  className="text-primary hover:text-rose-600"
                  aria-label="제거"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
