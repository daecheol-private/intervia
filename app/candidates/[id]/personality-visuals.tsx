"use client";

/**
 * 면접 리포트의 인성·역량 비주얼 — 시니어 면접관이 한눈에 읽도록 차트 중심으로 구성.
 * 모두 순수 SVG (차트 의존성 없음). Big Five 점수·행동스타일은 personality.ts 에서 파생된
 * 값만 표시하며 채점·합불에 영향이 없다 (참고 정보).
 */

import {
  MessageSquare,
  Calculator,
  Lightbulb,
  Sprout,
  Boxes,
  Users,
  Search,
  Wrench,
  Building2,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import {
  TRAIT_KEYS,
  type TraitKey,
  type BehaviorStyle,
  type BehaviorStyleKey,
} from "@/lib/personality";
import {
  NCS_COMPETENCY_LABELS,
  sanitizeCompetencies,
  type CompetencyKey,
} from "@/lib/competencies";

type TraitScores = Record<string, { score: number; answered: number }>;

function polar(cx: number, cy: number, r: number, angleDeg: number): [number, number] {
  const a = (angleDeg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

/** 레이더 꼭짓점용 짧은 라벨 — 긴 라벨은 클리핑 나므로 압축 */
const SHORT_TRAIT: Record<TraitKey, string> = {
  openness: "개방성",
  conscientiousness: "성실성",
  extraversion: "외향성",
  agreeableness: "우호성",
  emotionalStability: "정서안정",
};

// ── Big Five 레이더(오각형 스파이더) ─────────────────────────────
export function BigFiveRadar({
  traits,
  jobTraitProfile,
}: {
  traits: TraitScores;
  jobTraitProfile?: Record<string, string> | null;
}) {
  const W = 300;
  const H = 250;
  const cx = W / 2;
  const cy = 120;
  const R = 80;
  const n = TRAIT_KEYS.length;
  const angleOf = (i: number) => -90 + (360 / n) * i;

  const rings = [0.25, 0.5, 0.75, 1];
  const ringPoints = (frac: number) =>
    TRAIT_KEYS.map((_, i) => polar(cx, cy, R * frac, angleOf(i)).join(",")).join(" ");

  const dataPts = TRAIT_KEYS.map((k, i) => {
    const s = traits[k]?.score ?? 0;
    return polar(cx, cy, R * (s / 100), angleOf(i));
  });
  const dataPoly = dataPts.map((p) => p.join(",")).join(" ");

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full max-w-[320px] mx-auto"
      role="img"
      aria-label="Big Five 성향 레이더 차트"
    >
      {/* 그리드 링 */}
      {rings.map((frac) => (
        <polygon
          key={frac}
          points={ringPoints(frac)}
          fill="none"
          stroke="#ddd6fe"
          strokeWidth={1.25}
        />
      ))}
      {/* 스포크 */}
      {TRAIT_KEYS.map((_, i) => {
        const [x, y] = polar(cx, cy, R, angleOf(i));
        return (
          <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#c4b5fd" strokeWidth={1.25} />
        );
      })}

      {/* 데이터 폴리곤 — 채움 진하게 + 선 굵게 */}
      <polygon
        points={dataPoly}
        fill="#8b5cf6"
        fillOpacity={0.32}
        stroke="#6d28d9"
        strokeWidth={3}
        strokeLinejoin="round"
      />

      {/* 꼭짓점 + 라벨 */}
      {TRAIT_KEYS.map((k, i) => {
        const [px, py] = dataPts[i];
        const ang = angleOf(i);
        const [lx, ly] = polar(cx, cy, R + 20, ang);
        const cos = Math.cos((ang * Math.PI) / 180);
        const anchor = cos > 0.3 ? "start" : cos < -0.3 ? "end" : "middle";
        const score = traits[k]?.score ?? 0;
        const desired = jobTraitProfile?.[k] === "high";
        return (
          <g key={k}>
            <circle cx={px} cy={py} r={5} fill="#6d28d9" stroke="#fff" strokeWidth={1.5} />
            <text
              x={lx}
              y={ly - 5}
              textAnchor={anchor}
              className="fill-slate-700"
              style={{ fontSize: 13, fontWeight: 700 }}
            >
              {desired ? "★ " : ""}
              {SHORT_TRAIT[k]}
            </text>
            <text
              x={lx}
              y={ly + 11}
              textAnchor={anchor}
              className={desired ? "fill-emerald-700" : "fill-violet-800"}
              style={{ fontSize: 14, fontWeight: 800 }}
            >
              {score}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── 행동 스타일 4분면 맵 ──────────────────────────────────────
const QUADRANT_AT: Record<"tl" | "tr" | "bl" | "br", BehaviorStyleKey> = {
  tl: "supporter", // 신중 + 사람중심
  tr: "connector", // 적극 + 사람중심
  bl: "analyst", // 신중 + 과업중심
  br: "driver", // 적극 + 과업중심
};

const STYLE_SHORT: Record<BehaviorStyleKey, string> = {
  driver: "목표·추진",
  connector: "관계·협력",
  analyst: "분석·신중",
  supporter: "안정·지원",
};

function QuadrantMap({ style }: { style: BehaviorStyle }) {
  const W = 200;
  const H = 200;
  const m = 24; // 축 라벨 여백
  const lo = m;
  const hi = W - m;
  const mid = (lo + hi) / 2;
  const span = hi - lo;

  const px = lo + (style.assertiveness / 100) * span;
  const py = hi - (style.peopleFocus / 100) * span; // y 반전

  const cellPos: Record<"tl" | "tr" | "bl" | "br", { x: number; y: number }> = {
    tl: { x: (lo + mid) / 2, y: (lo + mid) / 2 },
    tr: { x: (mid + hi) / 2, y: (lo + mid) / 2 },
    bl: { x: (lo + mid) / 2, y: (mid + hi) / 2 },
    br: { x: (mid + hi) / 2, y: (mid + hi) / 2 },
  };

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full max-w-[240px] mx-auto"
      role="img"
      aria-label="행동 스타일 사분면"
    >
      {/* 활성 사분면 배경 */}
      {(["tl", "tr", "bl", "br"] as const).map((q) => {
        const active = QUADRANT_AT[q] === style.key;
        const x = q === "tl" || q === "bl" ? lo : mid;
        const y = q === "tl" || q === "tr" ? lo : mid;
        return (
          <rect
            key={q}
            x={x}
            y={y}
            width={span / 2}
            height={span / 2}
            fill={active ? "#ede9fe" : "#f8fafc"}
            stroke="#cbd5e1"
            strokeWidth={1.25}
          />
        );
      })}

      {/* 중앙 십자선 */}
      <line x1={mid} y1={lo} x2={mid} y2={hi} stroke="#94a3b8" strokeWidth={1.25} />
      <line x1={lo} y1={mid} x2={hi} y2={mid} stroke="#94a3b8" strokeWidth={1.25} />

      {/* 사분면 라벨 */}
      {(["tl", "tr", "bl", "br"] as const).map((q) => {
        const k = QUADRANT_AT[q];
        const active = k === style.key;
        return (
          <text
            key={q}
            x={cellPos[q].x}
            y={cellPos[q].y}
            textAnchor="middle"
            dominantBaseline="middle"
            className={active ? "fill-violet-800" : "fill-slate-500"}
            style={{ fontSize: 13, fontWeight: active ? 800 : 600 }}
          >
            {STYLE_SHORT[k]}
          </text>
        );
      })}

      {/* 축 라벨 */}
      <text x={mid} y={14} textAnchor="middle" className="fill-slate-600" style={{ fontSize: 11, fontWeight: 600 }}>
        사람중심
      </text>
      <text x={mid} y={H - 5} textAnchor="middle" className="fill-slate-600" style={{ fontSize: 11, fontWeight: 600 }}>
        과업중심
      </text>
      <text x={4} y={mid} textAnchor="start" dominantBaseline="middle" className="fill-slate-600" style={{ fontSize: 11, fontWeight: 600 }}>
        신중
      </text>
      <text x={W - 4} y={mid} textAnchor="end" dominantBaseline="middle" className="fill-slate-600" style={{ fontSize: 11, fontWeight: 600 }}>
        적극
      </text>

      {/* 후보자 위치 */}
      <circle cx={px} cy={py} r={11} fill="#7c3aed" fillOpacity={0.2} />
      <circle cx={px} cy={py} r={6} fill="#6d28d9" stroke="#fff" strokeWidth={2.5} />
    </svg>
  );
}

export function BehaviorStyleCard({ style }: { style: BehaviorStyle }) {
  return (
    <div className="rounded-xl border border-violet-200 bg-white px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-wider text-violet-600">
            행동 스타일
          </div>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className="text-xl font-extrabold text-violet-800">
              {style.label}
            </span>
            {style.modifier && (
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-violet-100 text-violet-800 border border-violet-300">
                {style.modifier}
              </span>
            )}
          </div>
          <p className="text-sm text-ink-soft mt-2 leading-relaxed">
            {style.summary}
          </p>
        </div>
      </div>
      <div className="mt-2.5">
        <QuadrantMap style={style} />
      </div>
    </div>
  );
}

// ── NCS 핵심 역량 배지 ────────────────────────────────────────
const COMPETENCY_ICON: Record<CompetencyKey, LucideIcon> = {
  communication: MessageSquare,
  numeracy: Calculator,
  problemSolving: Lightbulb,
  selfDevelopment: Sprout,
  resourceManagement: Boxes,
  interpersonal: Users,
  information: Search,
  technical: Wrench,
  organizationalUnderstanding: Building2,
  workEthics: ShieldCheck,
};

export function CompetencyBadges({ keys }: { keys?: string[] | null }) {
  const valid = sanitizeCompetencies(keys);
  if (valid.length === 0) return null;
  return (
    <div>
      <div className="text-sm font-bold text-violet-800 mb-2.5">
        회사가 중시하는 역량{" "}
        <span className="text-xs font-normal text-ink-muted">
          (NCS 직업기초능력)
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {valid.map((k) => {
          const Icon = COMPETENCY_ICON[k];
          const meta = NCS_COMPETENCY_LABELS[k];
          return (
            <div
              key={k}
              className="flex items-center gap-2.5 rounded-lg border border-violet-200 bg-white px-3 py-2.5"
              title={meta.short}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-violet-100 text-violet-700">
                <Icon size={19} strokeWidth={2.2} />
              </span>
              <span className="text-sm font-bold text-ink truncate">
                {meta.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
