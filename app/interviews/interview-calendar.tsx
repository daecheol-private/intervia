"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Video, MapPin, ChevronLeft, ChevronRight } from "lucide-react";

const KST = "Asia/Seoul";
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export type CalEvent = {
  id: number;
  candidateId: number;
  candidateName: string;
  jobTitle: string;
  round: "round1" | "round2";
  start: string;
  end: string;
  modeOnline: boolean;
  address: string | null;
  onlineMeetingUrl: string | null;
  locked: boolean;
  past: boolean;
};

export type NegoEvent = {
  candidateId: number;
  candidateName: string;
  jobTitle: string;
  round: "round1" | "round2";
  status: "pending" | "counter_proposed";
  slots: { start: string; end: string }[];
  locked: boolean;
};

type Tab = "upcoming" | "past";

const NEGO_META: Record<
  "pending" | "counter_proposed",
  { label: string; cls: string }
> = {
  pending: {
    label: "지원자 응답 대기",
    cls: "bg-warning-soft text-warning border-warning/30",
  },
  counter_proposed: {
    label: "역제시 — 시간 확정 필요",
    cls: "bg-accent-soft text-accent-deep border-accent/40",
  },
};

function pad(n: number): string {
  return n < 10 ? "0" + n : "" + n;
}

/** ISO → KST 날짜 키 "YYYY-MM-DD" (캘린더 셀 키와 동일 포맷으로 매칭). */
function kstDateKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: KST });
}

/** ISO → KST "HH:mm". */
function kstTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ko-KR", {
    timeZone: KST,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** ISO → KST "6/30 (화)" 짧은 날짜 (리스트 행용). */
function kstShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ko-KR", {
    timeZone: KST,
    month: "numeric",
    day: "numeric",
    weekday: "short",
  });
}

/** 협의 중 슬롯 — 여러 날 후보라 날짜까지 표시. "06/28 (토) 13:00 ~ 14:00". */
function formatNegoSlot(s: { start: string; end: string }): string {
  const date = new Date(s.start).toLocaleDateString("ko-KR", {
    timeZone: KST,
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  return `${date} ${kstTime(s.start)} ~ ${kstTime(s.end)}`;
}

function roundLabel(r: "round1" | "round2"): string {
  return r === "round2" ? "2차" : "1차";
}

function parseKey(key: string): { year: number; month: number; day: number } {
  const [y, m, d] = key.split("-").map(Number);
  return { year: y, month: m, day: d };
}

/**
 * 면접 일정 캘린더 — 좌측 월간 그리드 + 우측 토글 리스트(예정된 면접 / 평가 대기).
 * 캘린더에서 날짜를 누르면 해당 종류 탭으로 전환하고 그 면접을 우측에서 강조한다.
 * 협의 중(시간 미확정)은 캘린더로 표현 불가라 아래 풀폭 섹션으로 둔다.
 * KST 고정: 셀 키는 그레고리력 산술(UTC)로 만들고 면접의 KST 날짜 키와 매칭.
 */
export function InterviewCalendar({
  events,
  nego,
  todayKey,
  initialKey,
}: {
  events: CalEvent[];
  nego: NegoEvent[];
  todayKey: string;
  initialKey: string;
}) {
  const init = parseKey(initialKey);
  const [view, setView] = useState({ year: init.year, month: init.month });
  const [selected, setSelected] = useState(initialKey);
  const [tab, setTab] = useState<Tab>(() => {
    const evs = events.filter((e) => kstDateKey(e.start) === initialKey);
    return evs.length && evs[0].past ? "past" : "upcoming";
  });

  // 예정 / 평가 대기 분리 — page 에서 이미 정렬된 순서 유지(예정=가까운 순, 평가=최근 종료 순).
  const upcomingEvents = useMemo(() => events.filter((e) => !e.past), [events]);
  const pastEvents = useMemo(() => events.filter((e) => e.past), [events]);

  // 날짜별 그룹 (KST 키) — 셀 칩에 사용.
  const byDate = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of events) {
      const k = kstDateKey(e.start);
      const arr = m.get(k);
      if (arr) arr.push(e);
      else m.set(k, [e]);
    }
    for (const arr of m.values())
      arr.sort((a, b) => a.start.localeCompare(b.start));
    return m;
  }, [events]);

  // 6주(42칸) 고정 그리드 — 레이아웃 안정. 셀 키는 UTC 산술로 타임존 무관.
  const cells = useMemo(() => {
    const { year, month } = view;
    const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const out: { key: string; day: number; inMonth: boolean }[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(Date.UTC(year, month - 1, 1 + (i - firstDow)));
      const mm = d.getUTCMonth() + 1;
      out.push({
        key: `${d.getUTCFullYear()}-${pad(mm)}-${pad(d.getUTCDate())}`,
        day: d.getUTCDate(),
        inMonth: mm === month && d.getUTCFullYear() === year,
      });
    }
    return out;
  }, [view]);

  // 선택 날짜 변경 시 우측 리스트에서 해당 항목으로 스크롤.
  const activeRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected, tab]);

  // 캘린더 날짜 선택 — 그 날 면접 종류에 맞춰 탭 자동 전환.
  function selectDate(key: string) {
    setSelected(key);
    const evs = byDate.get(key);
    if (evs?.length) setTab(evs[0].past ? "past" : "upcoming");
  }

  function goPrev() {
    setView((v) =>
      v.month === 1
        ? { year: v.year - 1, month: 12 }
        : { year: v.year, month: v.month - 1 }
    );
  }
  function goNext() {
    setView((v) =>
      v.month === 12
        ? { year: v.year + 1, month: 1 }
        : { year: v.year, month: v.month + 1 }
    );
  }
  function goToday() {
    const t = parseKey(todayKey);
    setView({ year: t.year, month: t.month });
    selectDate(todayKey);
  }

  const listItems = tab === "upcoming" ? upcomingEvents : pastEvents;

  return (
    <div className="space-y-6">
      <div className="grid gap-5 lg:grid-cols-3 lg:items-stretch">
        {/* 좌측: 월간 캘린더 (2/3) */}
        <div className="lg:col-span-2">
          <div className="bg-card border border-border-default rounded-2xl shadow-sm overflow-hidden">
            {/* 월 네비 */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
              <h2 className="text-base font-bold text-ink tabular-nums">
                {view.year}년 {view.month}월
              </h2>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={goToday}
                  className="px-2.5 py-1 text-xs font-medium rounded-lg border border-border-default text-ink-soft hover:bg-surface-alt transition-colors"
                >
                  오늘
                </button>
                <button
                  type="button"
                  onClick={goPrev}
                  aria-label="이전 달"
                  className="p-1.5 rounded-lg text-ink-soft hover:bg-surface-alt transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  aria-label="다음 달"
                  className="p-1.5 rounded-lg text-ink-soft hover:bg-surface-alt transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* 요일 헤더 */}
            <div className="grid grid-cols-7 border-b border-border-default bg-surface-alt/40">
              {WEEKDAYS.map((w) => (
                <div
                  key={w}
                  className="py-2 text-center text-[11px] font-semibold text-ink-muted"
                >
                  {w}
                </div>
              ))}
            </div>

            {/* 날짜 그리드 */}
            <div className="grid grid-cols-7">
              {cells.map((c) => {
                const dayEvents = byDate.get(c.key) ?? [];
                const isToday = c.key === todayKey;
                const isSelected = c.key === selected;
                return (
                  <button
                    type="button"
                    key={c.key}
                    onClick={() => selectDate(c.key)}
                    className={
                      "relative min-h-[52px] sm:min-h-[72px] p-1 sm:p-1.5 flex flex-col items-stretch text-left border-b border-r border-border-default/60 [&:nth-child(7n)]:border-r-0 transition-colors " +
                      (c.inMonth
                        ? "bg-card hover:bg-surface-alt/50"
                        : "bg-surface-alt/30") +
                      (isSelected ? " ring-2 ring-inset ring-primary z-10" : "")
                    }
                  >
                    <span
                      className={
                        "inline-flex items-center justify-center w-5 h-5 sm:w-6 sm:h-6 self-start text-[11px] sm:text-xs font-semibold rounded-full " +
                        (isToday
                          ? "bg-primary text-white"
                          : c.inMonth
                            ? "text-ink-soft"
                            : "text-ink-muted/50")
                      }
                    >
                      {c.day}
                    </span>

                    {/* 데스크톱: 시간+이름 칩 (최대 2개 + 나머지 개수) */}
                    <div className="hidden sm:flex flex-col gap-0.5 mt-1 w-full">
                      {dayEvents.slice(0, 2).map((e) => (
                        <span
                          key={e.id}
                          className={
                            "block w-full truncate text-[10px] leading-tight px-1 py-0.5 rounded " +
                            (e.past
                              ? "bg-surface-alt text-ink-muted"
                              : "bg-primary-soft text-primary-deep")
                          }
                        >
                          <span className="tabular-nums font-medium">
                            {kstTime(e.start)}
                          </span>{" "}
                          {e.candidateName}
                        </span>
                      ))}
                      {dayEvents.length > 2 && (
                        <span className="text-[10px] text-ink-muted px-1">
                          +{dayEvents.length - 2}건
                        </span>
                      )}
                    </div>

                    {/* 모바일: 점 (최대 3) */}
                    {dayEvents.length > 0 && (
                      <div className="flex sm:hidden gap-0.5 mt-1 justify-center flex-wrap">
                        {dayEvents.slice(0, 3).map((e) => (
                          <span
                            key={e.id}
                            className={
                              "w-1 h-1 rounded-full " +
                              (e.past ? "bg-ink-muted" : "bg-primary")
                            }
                          />
                        ))}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* 우측: 토글 리스트 (1/3) */}
        <div className="lg:col-span-1">
          <div className="bg-card border border-border-default rounded-2xl shadow-sm flex flex-col lg:h-full overflow-hidden">
            {/* 탭 */}
            <div className="flex border-b border-border-default shrink-0">
              <TabButton
                active={tab === "upcoming"}
                count={upcomingEvents.length}
                onClick={() => setTab("upcoming")}
              >
                예정된 면접
              </TabButton>
              <TabButton
                active={tab === "past"}
                count={pastEvents.length}
                onClick={() => setTab("past")}
              >
                평가 대기
              </TabButton>
            </div>

            {/* 리스트 */}
            <div className="flex-1 overflow-y-auto p-2 space-y-2 max-h-[60vh] lg:max-h-none">
              {listItems.length === 0 ? (
                <div className="py-12 text-center">
                  <p className="text-sm text-ink-muted">
                    {tab === "upcoming"
                      ? "예정된 면접이 없습니다."
                      : "평가 대기 중인 면접이 없습니다."}
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {listItems.map((e) => {
                    const active = kstDateKey(e.start) === selected;
                    return (
                      <ListRow
                        key={e.id}
                        e={e}
                        active={active}
                        innerRef={active ? activeRef : undefined}
                      />
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 일정 협의 중 (시간 미확정 — 캘린더 밖, 풀폭) */}
      {nego.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-ink mb-3">일정 협의 중</h3>
          <ul className="space-y-2">
            {nego.map((n) => (
              <NegotiatingRow key={n.candidateId + ":" + n.round} n={n} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function TabButton({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex-1 px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors inline-flex items-center justify-center gap-1.5 " +
        (active
          ? "border-primary text-primary-deep"
          : "border-transparent text-ink-muted hover:text-ink-soft")
      }
    >
      {children}
      <span
        className={
          "text-[11px] tabular-nums px-1.5 rounded-full " +
          (active ? "bg-primary-soft text-primary-deep" : "bg-surface-alt text-ink-muted")
        }
      >
        {count}
      </span>
    </button>
  );
}

function RoundBadge({ round }: { round: "round1" | "round2" }) {
  return (
    <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-surface-alt text-ink-soft border border-border-default font-medium">
      {roundLabel(round)} 면접
    </span>
  );
}

function Initial({ name, locked }: { name: string; locked: boolean }) {
  return (
    <div className="w-9 h-9 rounded-full bg-surface-alt text-ink-soft flex items-center justify-center text-sm font-bold shrink-0">
      {locked ? "🔒" : name.trim().charAt(0).toUpperCase() || "?"}
    </div>
  );
}

/** 우측 리스트 한 줄 — 날짜+시간 포함, 행 전체가 후보자 상세 링크. 클릭 시 캘린더도 그 날로. */
function ListRow({
  e,
  active,
  innerRef,
}: {
  e: CalEvent;
  active: boolean;
  innerRef?: React.Ref<HTMLLIElement>;
}) {
  return (
    <li
      ref={innerRef}
      className={
        "relative rounded-xl border px-3 py-2.5 transition-colors " +
        (active
          ? "border-primary bg-primary-soft/40 ring-1 ring-primary"
          : "border-border-default bg-card hover:bg-surface-alt/50")
      }
    >
      <Link
        href={`/candidates/${e.candidateId}`}
        aria-label={`${e.candidateName} 면접 상세`}
        className="absolute inset-0 rounded-xl"
      />
      <div className="relative pointer-events-none flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-semibold text-ink tabular-nums">
              {kstShortDate(e.start)} {kstTime(e.start)}
            </span>
            <RoundBadge round={e.round} />
          </div>
          <div className="text-[12px] text-ink-soft truncate mt-1">
            {e.candidateName} · {e.jobTitle}
          </div>
          <div className="flex items-center gap-1 mt-1 text-[11px] text-ink-muted">
            {e.modeOnline ? (
              <>
                <Video className="w-3 h-3" /> 온라인
              </>
            ) : (
              <>
                <MapPin className="w-3 h-3" /> 대면
              </>
            )}
            {!e.modeOnline && e.address && !e.locked && (
              <span className="truncate"> · {e.address}</span>
            )}
          </div>
        </div>
        {/* 예정된 온라인 면접만 빠른 참가 */}
        {!e.past && e.modeOnline && e.onlineMeetingUrl && !e.locked && (
          <a
            href={e.onlineMeetingUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="화상 참가"
            className="relative pointer-events-auto shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg border border-primary/40 text-primary-deep hover:bg-primary-soft transition-colors"
          >
            <Video className="w-4 h-4" />
          </a>
        )}
      </div>
    </li>
  );
}

/** 협의 중 한 줄 — 상태 배지 + 제시한 시간들. */
function NegotiatingRow({ n }: { n: NegoEvent }) {
  const meta =
    n.status === "counter_proposed"
      ? NEGO_META.counter_proposed
      : NEGO_META.pending;
  return (
    <li className="relative bg-card border border-border-default rounded-xl px-4 py-3 hover:bg-surface-alt/50 transition-colors">
      <Link
        href={`/candidates/${n.candidateId}`}
        aria-label={`${n.candidateName} 면접 일정`}
        className="absolute inset-0 rounded-xl"
      />
      <div className="relative pointer-events-none flex items-start gap-3">
        <Initial name={n.candidateName} locked={n.locked} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={`text-[11px] px-2 py-0.5 rounded-md border font-medium ${meta.cls}`}
            >
              {meta.label}
            </span>
            <RoundBadge round={n.round} />
          </div>
          <div className="text-[12px] text-ink-soft truncate mt-0.5">
            {n.candidateName} · {n.jobTitle}
          </div>
          {n.slots.length > 0 && (
            <div className="text-[11px] text-ink-muted mt-1 space-y-0.5">
              {n.slots.slice(0, 3).map((s, i) => (
                <div key={i}>· {formatNegoSlot(s)}</div>
              ))}
              {n.slots.length > 3 && <div>외 {n.slots.length - 3}건</div>}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
