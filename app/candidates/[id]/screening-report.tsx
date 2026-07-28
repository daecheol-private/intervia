"use client";

import { Briefcase, GraduationCap, Sparkles, BookOpen } from "lucide-react";
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
  size = 300,
}: {
  breakdown: NonNullable<NonNullable<Candidate["screeningReport"]>["breakdown"]>;
  /** 차트 한 변 픽셀. 기본 300(상세). 비교 화면 등 좁은 곳은 축소해 넘긴다.
   *  모든 치수를 size 비율로 파생 → 300 이면 기존과 완전히 동일. */
  size?: number;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.3; // 차트 반지름 (라벨 공간 확보) — 90 @ 300
  const labelGap = size * (22 / 300);
  const fontMain = size * (11 / 300);
  const line2Gap = size * (13 / 300);
  const dotR = size * (3 / 300);
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
            r={dotR}
            fill="rgb(79, 70, 229)"
          />
        );
      })}
      {/* 축 라벨 + 점수 */}
      {SCREENING_AXES.map((a, i) => {
        const p = axisPoint(i, 1);
        const d = breakdown[a.key as BreakdownKey];
        // 라벨을 외곽선에서 22px 더 바깥쪽으로 — 폴리곤과 겹치지 않게.
        const dx = (p.x - cx) * (1 + labelGap / r) + cx - p.x;
        const dy = (p.y - cy) * (1 + labelGap / r) + cy - p.y;
        const lx = p.x + dx;
        const ly = p.y + dy;
        return (
          <g key={i}>
            <text
              x={lx}
              y={ly}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={fontMain}
              fill="#475569"
              fontWeight="600"
            >
              {a.label}
            </text>
            <text
              x={lx}
              y={ly + line2Gap}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={fontMain}
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

/** 6축 한 항목 (라벨·가중치·점수·바·사유) — BreakdownBlock/BreakdownBars 공유. */
function AxisRow({
  axis,
  breakdown,
}: {
  axis: (typeof SCREENING_AXES)[number];
  breakdown: NonNullable<NonNullable<Candidate["screeningReport"]>["breakdown"]>;
}) {
  const { key, label, weight } = axis;
  const d = breakdown[key as BreakdownKey];
  return (
    <div className="py-2 first:pt-0 last:pb-0">
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
          {SCREENING_AXES.map((axis) => (
            <AxisRow key={axis.key} axis={axis} breakdown={breakdown} />
          ))}
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

/** 6축 항목별 바 + 사유 (육각형 차트 제외) — 종합평가엔 차트만, 상세엔 이 바를 둔다. */
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
      {/* 6축을 3:3 으로 2분할 — 좁은 화면에서는 자동으로 한 열로 쌓임. */}
      <div className="grid grid-cols-1 md:grid-cols-2 md:gap-x-8">
        {[SCREENING_AXES.slice(0, 3), SCREENING_AXES.slice(3)].map((col, ci) => (
          <div key={ci} className="divide-y divide-border-default">
            {col.map((axis) => (
              <AxisRow key={axis.key} axis={axis} breakdown={breakdown} />
            ))}
          </div>
        ))}
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

// ─────────────────────────────────────────────────────────────
// 이력 타임라인 — 이력서를 세로 타임라인으로 정리 (좌측 연도 · 아이콘 노드 · 제목/카테고리/상세).
// 마스킹본에서 LLM 이 추출하므로 회사/학교 이름은 없고(개인정보 마스킹), "무슨 일을 했는가" 중심.
// 경력은 프로젝트/회사 단위로 한 항목씩(가장 상세). 학력은 대학 이상만. 점수 무관·표시 전용.
// ─────────────────────────────────────────────────────────────

type TimelineEntry = NonNullable<
  NonNullable<Candidate["screeningReport"]>["timeline"]
>[number];

type Kind = TimelineEntry["kind"];

// soft = 아이콘 박스 배경, fg = 아이콘·연도 색, bullet = 상세 불릿 색.
const KIND_META: Record<
  Kind,
  { label: string; Icon: typeof Briefcase; soft: string; fg: string; bullet: string }
> = {
  career: { label: "경력", Icon: Briefcase, soft: "bg-primary-soft", fg: "text-primary-deep", bullet: "bg-primary" },
  activity: { label: "인턴·대외활동", Icon: Sparkles, soft: "bg-accent-soft", fg: "text-accent-deep", bullet: "bg-accent" },
  training: { label: "교육·자격증", Icon: BookOpen, soft: "bg-surface-alt", fg: "text-ink-soft", bullet: "bg-ink-muted" },
  education: { label: "학력", Icon: GraduationCap, soft: "bg-info-soft", fg: "text-info", bullet: "bg-info" },
};

// 고등학교·검정고시 학력은 제외 (대학 이상만 표시).
const HIGH_SCHOOL_RE = /고\s*교|고등\s*학교|검정\s*고시|high\s*school/i;

/** "2018.03" / "2018" → 소수 연도(2018.166…). 파싱 실패·범위밖은 null. */
function toYear(s?: string | null): number | null {
  if (!s) return null;
  const m = String(s).match(/(\d{4})(?:[.\-/\s]+(\d{1,2}))?/);
  if (!m) return null;
  const y = Number(m[1]);
  if (y < 1950 || y > 2100) return null;
  const mo = m[2] ? Math.min(12, Math.max(1, Number(m[2]))) : 1;
  return y + (mo - 1) / 12;
}

/** 좌측 큰 연도 — 시작연도(없으면 종료연도). */
function bigYear(e: TimelineEntry): string {
  const s = toYear(e.start);
  if (s != null) return String(Math.floor(s));
  const en = toYear(e.end);
  return en != null ? String(Math.floor(en)) : "";
}

/** "2018.03" → 절대 개월 수(2018×12+2). 파싱 실패는 null. */
function toMonths(s?: string | null): number | null {
  const y = toYear(s);
  return y == null ? null : Math.round(y * 12);
}

/** 경력 한 건의 재직 구간 [시작, 끝) — 절대 개월. 기간 미상(마스킹 등)이면 null. */
function careerSpan(e: TimelineEntry, nowM: number): [number, number] | null {
  const s = toMonths(e.start);
  if (s == null) return null;
  const raw = e.ongoing ? nowM : toMonths(e.end);
  if (raw == null) return null;
  // 이력서 관행상 종료월도 재직에 포함 (2023.09~2025.07 = 1년 11개월) → 반개구간으로 +1.
  const end = raw + 1;
  return end > s ? [s, end] : null;
}

/** 개월 → "2년 3개월" / "2년" / "5개월". */
function formatDuration(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m}개월`;
  if (m === 0) return `${y}년`;
  return `${y}년 ${m}개월`;
}

/**
 * 총 경력 개월 — 구간을 병합해서 계산한다.
 * 경력은 프로젝트/회사 단위로 한 항목씩이라 같은 시기가 여러 줄로 겹치는데,
 * 단순 합산하면 실제보다 부풀려진다.
 */
function totalCareerMonths(entries: TimelineEntry[], nowM: number): number {
  const spans = entries
    .filter((e) => e.kind === "career")
    .map((e) => careerSpan(e, nowM))
    .filter((s): s is [number, number] => s !== null)
    .sort((a, b) => a[0] - b[0]);

  let total = 0;
  let curStart = 0;
  let curEnd = -1;
  for (const [s, en] of spans) {
    if (curEnd < 0) {
      curStart = s;
      curEnd = en;
    } else if (s <= curEnd) {
      curEnd = Math.max(curEnd, en);
    } else {
      total += curEnd - curStart;
      curStart = s;
      curEnd = en;
    }
  }
  if (curEnd >= 0) total += curEnd - curStart;
  return total;
}

/** 컴팩트 월 범위 — "09 – 현재" / "01 – 08" / "03 – 2024.02". */
function monthRange(e: TimelineEntry): string {
  const sm = e.start?.match(/(\d{4})(?:[.\-/\s]+(\d{1,2}))?/);
  const startYr = sm?.[1] ?? null;
  const startMo = sm?.[2] ? sm[2].padStart(2, "0") : null;
  let right = "";
  if (e.ongoing) {
    right = "현재";
  } else {
    const em = e.end?.match(/(\d{4})(?:[.\-/\s]+(\d{1,2}))?/);
    if (em) {
      const endYr = em[1];
      const endMo = em[2] ? em[2].padStart(2, "0") : null;
      right = endYr === startYr ? endMo ?? "" : endMo ? `${endYr}.${endMo}` : endYr;
    }
  }
  const left = startMo ?? "";
  if (left && right) return `${left} – ${right}`;
  return left || (right ? `– ${right}` : "");
}

type TimelineRow = { e: TimelineEntry };

/** 세로 타임라인 한 열 — 항목마다 [연도][아이콘 노드+스파인][제목·카테고리·상세]. */
function TimelineColumn({ items, nowM }: { items: TimelineRow[]; nowM: number }) {
  return (
    <ol>
      {items.map(({ e }, i) => {
        const m = KIND_META[e.kind] ?? KIND_META.training;
        const yr = bigYear(e);
        const mr = monthRange(e);
        const last = i === items.length - 1;
        // 재직기간은 경력만. 기간을 못 읽은 항목은 표시하지 않는다.
        const span = e.kind === "career" ? careerSpan(e, nowM) : null;
        const dur = span ? formatDuration(span[1] - span[0]) : null;
        return (
          <li key={i} className="relative flex gap-3">
            {/* 좌: 연도 */}
            <div className="w-11 shrink-0 pt-1 text-right">
              <div
                className={`text-[15px] font-bold leading-none tabular-nums ${m.fg}`}
              >
                {yr}
              </div>
              {mr && (
                <div className="mt-1 text-[10px] leading-tight text-ink-muted tabular-nums">
                  {mr}
                </div>
              )}
            </div>

            {/* 중: 아이콘 노드 + 스파인 */}
            <div className="relative flex w-9 shrink-0 justify-center">
              {!last && (
                <span
                  className="absolute left-1/2 top-9 bottom-0 w-px -translate-x-1/2 bg-border-default"
                  aria-hidden
                />
              )}
              <div
                className={`relative z-10 grid h-9 w-9 place-items-center rounded-xl ${m.soft}`}
              >
                <m.Icon className={`h-[18px] w-[18px] ${m.fg}`} strokeWidth={2.1} />
              </div>
            </div>

            {/* 우: 내용 */}
            <div className="min-w-0 flex-1 pb-4">
              <div className="text-sm font-bold text-ink leading-snug">
                {e.title}
              </div>
              <div className={`mt-0.5 text-[11px] font-semibold ${m.fg}`}>
                {m.label}
                {dur && (
                  <span className="font-bold tabular-nums"> · {dur}</span>
                )}
              </div>
              {e.highlights && e.highlights.length > 0 && (
                <ul className="mt-1.5 space-y-1">
                  {e.highlights.map((h, j) => (
                    <li
                      key={j}
                      className="flex gap-1.5 text-[12px] text-ink-soft leading-snug"
                    >
                      <span
                        className={`mt-[6px] h-1 w-1 shrink-0 rounded-full ${m.bullet}`}
                      />
                      <span>
                        <HL text={h} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function ResumeTimelineBlock({
  timeline,
}: {
  timeline: TimelineEntry[];
}) {
  if (!timeline || timeline.length === 0) return null;

  const now = new Date();
  const nowM = now.getFullYear() * 12 + now.getMonth();
  const careerM = totalCareerMonths(timeline, nowM);

  // 고교 학력 제외 + 시작 시점 내림차순(최신 위). 기간 미상은 원래 순서 유지하며 뒤로.
  const rows = timeline
    .filter((e) => !(e.kind === "education" && HIGH_SCHOOL_RE.test(e.title || "")))
    .map((e, i) => ({ e, i, y: toYear(e.start) ?? toYear(e.end) }))
    .sort((a, b) => {
      const ay = a.y ?? -Infinity;
      const by = b.y ?? -Infinity;
      if (ay !== by) return by - ay;
      return a.i - b.i;
    });
  if (rows.length === 0) return null;

  // 항목이 넉넉하면 좌우 2열로 — 오른쪽 여백을 채우고 세로 길이를 반으로.
  // 두 열 높이가 비슷하도록 "제목 1 + highlights×0.6" 가중치로 분할점을 잡는다.
  // 좁은 컨테이너(@container)에서는 자동으로 1열(전체 시간순)로 접힌다.
  const twoCol = rows.length >= 4;
  let colA: typeof rows = rows;
  let colB: typeof rows = [];
  if (twoCol) {
    const weight = (r: (typeof rows)[number]) =>
      1 + (r.e.highlights?.length ?? 0) * 0.6;
    const total = rows.reduce((s, r) => s + weight(r), 0);
    let acc = 0;
    let idx = rows.length;
    for (let i = 0; i < rows.length; i++) {
      acc += weight(rows[i]);
      if (acc >= total / 2) {
        idx = i + 1;
        break;
      }
    }
    idx = Math.max(1, Math.min(rows.length - 1, idx));
    colA = rows.slice(0, idx);
    colB = rows.slice(idx);
  }

  return (
    <div className="@container space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
          이력 타임라인
        </span>
        {careerM > 0 && (
          <span className="rounded-md bg-primary-soft px-2 py-0.5 text-[11px] font-bold text-primary-deep tabular-nums">
            총 경력 {formatDuration(careerM)}
          </span>
        )}
        <span className="h-px flex-1 bg-border-default" aria-hidden />
      </div>

      {twoCol ? (
        <div className="mt-1 grid grid-cols-1 gap-x-8 @2xl:grid-cols-2">
          <TimelineColumn items={colA} nowM={nowM} />
          <TimelineColumn items={colB} nowM={nowM} />
        </div>
      ) : (
        <div className="mt-1">
          <TimelineColumn items={colA} nowM={nowM} />
        </div>
      )}

      <div className="text-[10px] text-ink-muted/70">
        * 일부 기간은 겹칠 수 있으며, 총 경력은 겹치는 기간을 한 번만 계산한
        값입니다.
      </div>
    </div>
  );
}
