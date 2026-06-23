"use client";

import { HL, scoreColor, withLeadEmphasis } from "./shared";
import type { Candidate, Confidence } from "./types";

export function LevelMatchBadge({
  match,
}: {
  match: NonNullable<NonNullable<Candidate["screeningReport"]>["level_match"]>;
}) {
  const label =
    match.fit === "over"
      ? "오버스펙 — 직급 미스매치"
      : "언더스펙 — 직급 미스매치";
  // 직급 미스매치는 감점이 아니라 *상한(cap)* — 오버 ≤95 / 언더 ≤90 (lib/screening.ts LEVEL_*_CAP 과 일치).
  const cap = match.fit === "over" ? 95 : 90;
  return (
    <div className="border border-warning/40 bg-warning-soft/60 rounded-lg px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold text-warning">{label}</span>
        <span className="text-xs text-warning tabular-nums">
          후보자 {match.years}년 · 최고 {cap}점 제한
        </span>
      </div>
      {match.reason && (
        <p className="text-xs text-ink-soft mt-1 leading-snug">
          {match.reason}
        </p>
      )}
    </div>
  );
}

export function RequirementGateBadge({
  gate,
}: {
  gate: NonNullable<NonNullable<Candidate["screeningReport"]>["requirement_gate"]>;
}) {
  // 필수 요건 미충족(fail)·판단보류(unknown)만 노출. pass/미해당은 표시 안 함.
  if (!gate.applies || gate.verdict === "pass" || !gate.verdict) return null;
  const isFail = gate.verdict === "fail";
  // soft(학력 등 경력으로 상쇄 가능) 는 결격이 아니라 "참고"로 — danger 대신 warning 톤.
  const isHardFail = isFail && gate.severity !== "soft";
  const isSoftFail = isFail && gate.severity === "soft";
  const wrap = isHardFail
    ? "border-danger/40 bg-danger-soft/60"
    : "border-warning/40 bg-warning-soft/60";
  const titleClr = isHardFail ? "text-danger" : "text-warning";
  const title = isHardFail
    ? "⚠ 필수 요건 미충족 — 결격 가능"
    : isSoftFail
      ? "필수 요건 일부 미충족 — 경력으로 보완 가능"
      : "필수 요건 확인 필요";
  const note = isHardFail ? "점수 상한 적용" : isSoftFail ? "최고 등급 제한" : null;
  return (
    <div className={`border rounded-lg px-4 py-3 ${wrap}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className={`text-sm font-semibold ${titleClr}`}>{title}</span>
        {note && (
          <span className={`text-xs ${titleClr} tabular-nums`}>{note}</span>
        )}
      </div>
      {gate.missing && gate.missing.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {gate.missing.map((m, i) => (
            <li key={i} className="text-xs text-ink-soft leading-snug">
              · {m}
            </li>
          ))}
        </ul>
      )}
      {gate.reason && (
        <p className="text-xs text-ink-soft mt-1 leading-snug">{gate.reason}</p>
      )}
    </div>
  );
}

type CoverageStatus = "direct" | "indirect" | "none";

const COVERAGE_META: Record<
  CoverageStatus,
  {
    label: string;
    icon: string;
    /** 좌측 액센트 보더 */
    accent: string;
    /** 아이콘 원형 배지 */
    badge: string;
    /** 상단 요약 바 세그먼트 */
    bar: string;
    /** 행 배경 (none 은 흐리게) */
    row: string;
  }
> = {
  direct: {
    label: "직접 부합",
    icon: "✓",
    accent: "border-l-primary",
    badge: "bg-primary text-white",
    bar: "bg-primary",
    row: "bg-white",
  },
  indirect: {
    label: "간접 부합",
    icon: "~",
    accent: "border-l-info",
    badge: "bg-info text-white",
    bar: "bg-info",
    row: "bg-white",
  },
  none: {
    label: "근거 없음",
    icon: "–",
    accent: "border-l-slate-300",
    badge: "bg-slate-300 text-white",
    bar: "bg-slate-200",
    row: "bg-slate-50/60",
  },
};

const COVERAGE_ORDER: CoverageStatus[] = ["direct", "indirect", "none"];

/** 요건 충족도 링 게이지 — 숫자 하나를 시각화 (도넛 풀차트 X, 디테일은 리스트가 담당). */
function CoverageRing({ pct }: { pct: number }) {
  const size = 56;
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  const dash = (clamped / 100) * c;
  // 충족도 구간별 색 — 리스트 헤더 텍스트와 동일 기준(70/40).
  const color =
    pct >= 70
      ? "var(--color-primary)"
      : pct >= 40
        ? "var(--color-info)"
        : "var(--color-warning)";
  const textCls =
    pct >= 70 ? "fill-primary-deep" : pct >= 40 ? "fill-info" : "fill-warning";
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="flex-none"
      role="img"
      aria-label={`요건 충족도 ${clamped}%`}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="#e2e8f0"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c - dash}`}
        // 12시 방향에서 시작하도록 -90도 회전.
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        className={`text-[13px] font-bold tabular-nums ${textCls}`}
      >
        {clamped}%
      </text>
    </svg>
  );
}

export function RequirementCoverageBlock({
  coverage,
}: {
  coverage: NonNullable<
    NonNullable<Candidate["screeningReport"]>["requirement_coverage"]
  >;
}) {
  if (!coverage || coverage.length === 0) return null;
  const total = coverage.length;
  const counts: Record<CoverageStatus, number> = {
    direct: 0,
    indirect: 0,
    none: 0,
  };
  for (const c of coverage) counts[c.status] = (counts[c.status] ?? 0) + 1;
  // 충족도 = (직접 1.0 + 간접 0.5) / 전체
  const fitPct = Math.round(
    ((counts.direct + counts.indirect * 0.5) / total) * 100
  );

  return (
    <div className="space-y-2.5">
      <div className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
        JD 요건별 충족
      </div>

      {/* 상단 요약 — 링 게이지(전체 충족도) + 상태별 개수 범례 */}
      <div className="flex items-center gap-4">
        <CoverageRing pct={fitPct} />
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {COVERAGE_ORDER.map((s) => (
            <span
              key={s}
              className="flex items-center gap-1.5 text-xs text-ink-muted"
            >
              <span className={`w-2.5 h-2.5 rounded-sm ${COVERAGE_META[s].bar}`} />
              {COVERAGE_META[s].label}
              <span className="tabular-nums font-semibold text-ink-soft">
                {counts[s]}
              </span>
            </span>
          ))}
        </div>
      </div>

      {/* 요건 행 — 2컬럼 그리드 (좁은 화면은 1컬럼). 상태별 색 좌측 보더 + 아이콘 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
        {coverage.map((c, i) => {
          const m = COVERAGE_META[c.status] ?? COVERAGE_META.none;
          const dim = c.status === "none";
          return (
            <div
              key={i}
              className={`flex items-start gap-2.5 rounded-md border border-border-default border-l-[3px] ${m.accent} ${m.row} px-3 py-2`}
            >
              <span
                className={`mt-0.5 flex-none w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold leading-none ${m.badge}`}
                title={m.label}
                aria-label={m.label}
              >
                {m.icon}
              </span>
              <div className="flex-1 min-w-0">
                <div
                  className={`text-sm leading-snug ${
                    dim ? "text-ink-muted" : "text-ink font-medium"
                  }`}
                >
                  {c.requirement}
                </div>
                {c.evidence ? (
                  <div className="text-[11px] text-ink-muted leading-snug mt-0.5">
                    {c.evidence}
                  </div>
                ) : (
                  dim && (
                    <div className="text-[11px] text-ink-muted leading-snug mt-0.5 italic">
                      이력서에서 근거를 찾지 못함 — 면접 확인 권장
                    </div>
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 서류평가 6축 정의 — FitHexagon + BreakdownBlock 공유.
// 순서 = 12시부터 시계방향. 가중치 합은 100%.
// LLM 프롬프트(lib/prompts.ts)의 가중치와 일치해야 함.
// weight 라벨은 lib/screening.ts AXIS_WEIGHTS 와 반드시 일치시킬 것.
const SCREENING_AXES = [
  { key: "tech_fit", label: "기술 적합도", weight: "20%" },
  { key: "experience_depth", label: "경험 깊이", weight: "20%" },
  { key: "role_match", label: "직무 매칭도", weight: "25%" },
  { key: "achievement", label: "성과 임팩트", weight: "15%" },
  { key: "stability", label: "재직 안정성", weight: "10%" },
  { key: "growth_attitude", label: "성장·태도", weight: "10%" },
] as const;

type BreakdownKey = (typeof SCREENING_AXES)[number]["key"];

export function FitHexagon({
  breakdown,
}: {
  breakdown: NonNullable<NonNullable<Candidate["screeningReport"]>["breakdown"]>;
}) {
  const size = 300;
  const cx = size / 2;
  const cy = size / 2;
  const r = 90; // 차트 반지름 (라벨 공간 확보)
  const N = SCREENING_AXES.length;

  // i번째 축의 좌표 — 12시부터 시계방향, ratio=0(중심) ~ 1(외곽).
  const axisPoint = (i: number, ratio: number) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / N;
    return {
      x: cx + Math.cos(angle) * r * ratio,
      y: cy + Math.sin(angle) * r * ratio,
    };
  };

  const polyAt = (ratio: number) =>
    Array.from({ length: N }, (_, i) => axisPoint(i, ratio))
      .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(" ");

  // 후보자 점수 폴리곤 — 누락된 축은 0 으로 처리 (구버전 데이터 호환).
  const hasAnyScore = SCREENING_AXES.some(
    (a) => breakdown[a.key as BreakdownKey] != null
  );
  const scoresPoly = SCREENING_AXES.map((a, i) => {
    const d = breakdown[a.key as BreakdownKey];
    const score = d?.score ?? 0;
    const ratio = Math.max(0, Math.min(1, score / 100));
    const p = axisPoint(i, ratio);
    return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }).join(" ");

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="block mx-auto"
      role="img"
      aria-label="서류평가 6축 적합도 차트"
    >
      {/* 배경 격자: 25/50/75/100% 동심육각형 */}
      {[0.25, 0.5, 0.75, 1.0].map((ratio) => (
        <polygon
          key={ratio}
          points={polyAt(ratio)}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth={1}
        />
      ))}
      {/* 축선 (중심에서 외곽까지) */}
      {SCREENING_AXES.map((_, i) => {
        const p = axisPoint(i, 1);
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={p.x}
            y2={p.y}
            stroke="#e2e8f0"
            strokeWidth={1}
          />
        );
      })}
      {/* 후보자 점수 폴리곤 */}
      {hasAnyScore && (
        <polygon
          points={scoresPoly}
          fill="rgb(79, 70, 229)"
          fillOpacity={0.2}
          stroke="rgb(79, 70, 229)"
          strokeWidth={2}
        />
      )}
      {/* 꼭짓점 도트 */}
      {SCREENING_AXES.map((a, i) => {
        const d = breakdown[a.key as BreakdownKey];
        if (!d) return null;
        const ratio = Math.max(0, Math.min(1, d.score / 100));
        const p = axisPoint(i, ratio);
        return (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={3}
            fill="rgb(79, 70, 229)"
          />
        );
      })}
      {/* 축 라벨 + 점수 */}
      {SCREENING_AXES.map((a, i) => {
        const p = axisPoint(i, 1);
        const d = breakdown[a.key as BreakdownKey];
        // 라벨을 외곽선에서 22px 더 바깥쪽으로 — 폴리곤과 겹치지 않게.
        const dx = (p.x - cx) * (1 + 22 / r) + cx - p.x;
        const dy = (p.y - cy) * (1 + 22 / r) + cy - p.y;
        const lx = p.x + dx;
        const ly = p.y + dy;
        return (
          <g key={i}>
            <text
              x={lx}
              y={ly}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="11"
              fill="#475569"
              fontWeight="600"
            >
              {a.label}
            </text>
            <text
              x={lx}
              y={ly + 13}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="11"
              fill={d ? "#0f172a" : "#cbd5e1"}
              fontWeight="700"
              className="tabular-nums"
            >
              {d ? d.score : "—"}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

const CONFIDENCE_META: Record<
  Confidence,
  { label: string; cls: string }
> = {
  high: { label: "근거 충분", cls: "bg-primary-soft/70 text-primary-deep border-primary/30" },
  medium: { label: "근거 보통", cls: "bg-slate-100 text-slate-500 border-slate-200" },
  low: { label: "근거 부족·면접확인", cls: "bg-warning-soft/70 text-warning border-warning/30" },
};

function ConfidenceChip({ c }: { c?: Confidence }) {
  if (!c) return null;
  const m = CONFIDENCE_META[c];
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded border font-medium whitespace-nowrap ${m.cls}`}
    >
      {m.label}
    </span>
  );
}

export function BreakdownBlock({
  breakdown,
}: {
  breakdown: NonNullable<NonNullable<Candidate["screeningReport"]>["breakdown"]>;
}) {
  const hasNewAxes =
    breakdown.achievement != null || breakdown.stability != null;
  return (
    <div className="space-y-3">
      <div className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
        공고 적합도 (6축)
      </div>
      {/* 좌: 육각형 차트 (고정폭). 우: 6축 사유 리스트 (남은 폭 채움).
          모바일/좁은 화면에서는 자동으로 위아래로 쌓임. */}
      <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-x-6 gap-y-4 items-center">
        <div className="flex justify-center md:justify-start">
          <FitHexagon breakdown={breakdown} />
        </div>
        <div className="divide-y divide-border-default">
          {SCREENING_AXES.map(({ key, label, weight }) => {
            const d = breakdown[key as BreakdownKey];
            return (
              <div key={key} className="py-2 first:pt-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <span className="text-sm font-medium text-ink">
                    {label}
                    <span className="text-[10px] text-ink-muted ml-1.5 font-normal">
                      {weight}
                    </span>
                  </span>
                  <span
                    className={`text-base font-bold tabular-nums ${
                      d ? scoreColor(d.score) : "text-ink-muted"
                    }`}
                  >
                    {d ? d.score : "—"}
                  </span>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{
                      width: `${d ? Math.max(0, Math.min(100, d.score)) : 0}%`,
                    }}
                  />
                </div>
                {d?.reason && (
                  <p className="text-[11px] text-ink-muted mt-1 leading-snug flex items-start gap-1.5">
                    <span className="flex-1">{d.reason}</span>
                    <ConfidenceChip c={d.confidence} />
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {!hasNewAxes && (
        <div className="text-[11px] text-ink-muted text-center">
          구버전 평가 데이터 — 성과 임팩트 / 재직 안정성 축은 재평가 후
          채워집니다.
        </div>
      )}
    </div>
  );
}

/** 6축 항목별 바 + 사유 (육각형 차트 제외) — 개요엔 차트만, 상세엔 이 바를 둔다. */
export function BreakdownBars({
  breakdown,
}: {
  breakdown: NonNullable<NonNullable<Candidate["screeningReport"]>["breakdown"]>;
}) {
  const hasNewAxes =
    breakdown.achievement != null || breakdown.stability != null;
  return (
    <div className="space-y-3">
      <div className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
        공고 적합도 (6축)
      </div>
      <div className="divide-y divide-border-default">
        {SCREENING_AXES.map(({ key, label, weight }) => {
          const d = breakdown[key as BreakdownKey];
          return (
            <div key={key} className="py-2 first:pt-0 last:pb-0">
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="text-sm font-medium text-ink">
                  {label}
                  <span className="text-[10px] text-ink-muted ml-1.5 font-normal">
                    {weight}
                  </span>
                </span>
                <span
                  className={`text-base font-bold tabular-nums ${
                    d ? scoreColor(d.score) : "text-ink-muted"
                  }`}
                >
                  {d ? d.score : "—"}
                </span>
              </div>
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{
                    width: `${d ? Math.max(0, Math.min(100, d.score)) : 0}%`,
                  }}
                />
              </div>
              {d?.reason && (
                <p className="text-[11px] text-ink-muted mt-1 leading-snug flex items-start gap-1.5">
                  <span className="flex-1">{d.reason}</span>
                  <ConfidenceChip c={d.confidence} />
                </p>
              )}
            </div>
          );
        })}
      </div>
      {!hasNewAxes && (
        <div className="text-[11px] text-ink-muted text-center">
          구버전 평가 데이터 — 성과 임팩트 / 재직 안정성 축은 재평가 후
          채워집니다.
        </div>
      )}
    </div>
  );
}

export function BulletBlock({
  title,
  items,
  color,
  emphasis,
  emphasizeLead = false,
}: {
  title: string;
  items: string[];
  color: "emerald" | "amber" | "slate" | "blue";
  /** true 면 카드 배경 강조 (예: 면접에서 확인할 주제는 더 눈에 띄게) */
  emphasis?: boolean;
  /** true 면 "리드 구절: 상세" 항목의 리드를 자동으로 굵게 (강점·우려). 배경칠은 안 함. */
  emphasizeLead?: boolean;
}) {
  if (items.length === 0) return null;
  const palette = {
    emerald: {
      titleClr: "text-primary-deep",
      dot: "bg-primary",
      card: "bg-primary-soft/60 border-primary/30",
    },
    amber: {
      titleClr: "text-warning",
      dot: "bg-warning",
      card: "bg-warning-soft/70 border-warning/30",
    },
    slate: {
      titleClr: "text-ink-soft",
      dot: "bg-ink-muted",
      card: "bg-surface-alt border-border-default",
    },
    blue: {
      titleClr: "text-info",
      dot: "bg-info",
      card: "bg-info-soft/60 border-info/30",
    },
  }[color];
  const cardCls = emphasis
    ? `rounded-xl border p-3.5 ${palette.card}`
    : "";
  return (
    <div className={cardCls}>
      <div
        className={`text-xs font-semibold uppercase tracking-wider mb-2 ${palette.titleClr}`}
      >
        {title}
      </div>
      <ul className="space-y-1.5">
        {items.map((s, i) => (
          <li key={i} className="flex gap-2 text-ink-soft">
            <span
              className={`w-1.5 h-1.5 rounded-full ${palette.dot} mt-2 shrink-0`}
            />
            <span className="leading-relaxed">
              {/* 강점·우려는 리드 구절을 자동으로 굵게 — 노란 배경칠은 안 함(bold 만) */}
              <HL text={emphasizeLead ? withLeadEmphasis(s) : s} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 법인 정성 평가 항목 검토 — 무점수. 서류에서 확인된 근거 / 면접 확인 필요만 표시.
 * 점수에 반영되지 않음을 UI 에 명시 (자소서 없는 경력 이력서가 불리해지지 않도록).
 */
export function QualitativeReviewBlock({
  review,
}: {
  review: Array<{
    item: string;
    finding: string;
    evidence?: string;
    needs_interview?: boolean;
  }>;
}) {
  if (review.length === 0) return null;
  // "정성평가 = violet" 시각 정체성 — AI 면접의 정성 블록(CultureFitBlock)과 컨테이너·헤더 색을
  // 동일하게 맞춰, 이력서/AI면접 어디서든 violet 박스면 "정성평가(무점수 참고)"임을 알 수 있게 한다.
  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50/50 px-4 py-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-xs font-bold uppercase tracking-wider text-violet-700">
          법인 정성 평가 항목 검토
        </div>
        <span className="text-[11px] font-medium px-2 py-0.5 rounded border border-violet-200 bg-card text-violet-600">
          참고 정보 — 점수 미반영
        </span>
      </div>
      <ul className="mt-3 space-y-2">
        {review.map((r, i) => (
          <li
            key={i}
            className="bg-card border border-violet-100 rounded-lg px-3 py-2"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-ink">{r.item}</span>
              {r.needs_interview ? (
                <span className="text-[11px] font-bold px-2 py-0.5 rounded border border-amber-300 bg-amber-100 text-amber-800">
                  면접 확인 필요
                </span>
              ) : (
                <span className="text-[11px] font-bold px-2 py-0.5 rounded border border-emerald-300 bg-emerald-100 text-emerald-800">
                  서류 근거 있음
                </span>
              )}
            </div>
            <div className="text-sm text-ink-soft mt-1 leading-relaxed">
              <HL text={r.finding} />
            </div>
            {r.evidence && (
              <div className="text-xs text-ink-muted mt-0.5">
                근거: {r.evidence}
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="text-xs text-ink-soft mt-2.5 leading-relaxed">
        ※ 자기소개서 등 정성 자료가 없는 이력서는 &quot;면접 확인 필요&quot;로
        분류될 뿐 감점되지 않습니다.
      </div>
    </div>
  );
}
