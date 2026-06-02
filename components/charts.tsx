/**
 * 공용 순수 SVG 차트 프리미티브 (공고 리포트 + 법인 대시보드 공유).
 *
 * 왜 라이브러리(recharts 등) 대신 SVG 인가:
 *   - 공고 리포트는 인쇄/PDF 지향(PrintButton + print: 스타일 다수).
 *     recharts 는 클라이언트 전용이라 print 레이아웃에서 깨지기 쉽다.
 *   - 정적 SVG 는 서버 컴포넌트로 그대로 렌더 → JS 없이 인쇄에 안정적이고
 *     의존성도 늘지 않는다.
 *   - "use client" / 서버 의존성이 없어 서버·클라이언트 컴포넌트 양쪽에서 재사용 가능.
 *
 * 모든 컴포넌트는 상호작용 없음. 툴팁은 <title> 로만.
 */

// 딥그린(#0d4f3c) 테마와 조화되는 팔레트.
export const C = {
  primary: "#0d4f3c", // 합격/긍정 강조
  primarySoft: "#cfe0d8",
  good: "#2f8f6f",
  danger: "#d24d6a", // 불합격
  warn: "#d9930a", // 만료/주의
  muted: "#94a3b8", // 진행중/취소
  mutedSoft: "#e2e8f0",
  blue: "#3b6ea5",
  indigo: "#6366f1",
  ink: "#0f172a",
  grid: "#e2e8f0",
  axis: "#cbd5e1",
} as const;

// 카테고리형 다계열용 팔레트
export const CATEGORICAL = [
  C.primary,
  C.blue,
  C.warn,
  C.good,
  C.indigo,
  C.danger,
  C.muted,
];

function pct(n: number, total: number) {
  return total > 0 ? (n / total) * 100 : 0;
}

/* ─────────────────────────── 도넛 ─────────────────────────── */

export function Donut({
  data,
  size = 132,
  thickness = 20,
  centerTop,
  centerSub,
}: {
  data: { label: string; value: number; color: string }[];
  size?: number;
  thickness?: number;
  centerTop?: string;
  centerSub?: string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="flex items-center gap-4">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="shrink-0"
      >
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={C.mutedSoft}
          strokeWidth={thickness}
        />
        {total > 0 &&
          data.map((d, i) => {
            if (d.value <= 0) return null;
            const len = (d.value / total) * circ;
            const seg = (
              <circle
                key={i}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={d.color}
                strokeWidth={thickness}
                strokeDasharray={`${len} ${circ - len}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${cx} ${cy})`}
              >
                <title>{`${d.label} ${d.value} (${pct(d.value, total).toFixed(1)}%)`}</title>
              </circle>
            );
            offset += len;
            return seg;
          })}
        {(centerTop || centerSub) && (
          <>
            <text
              x={cx}
              y={cy - 1}
              textAnchor="middle"
              className="fill-slate-900"
              style={{ fontSize: 19, fontWeight: 700 }}
            >
              {centerTop}
            </text>
            {centerSub && (
              <text
                x={cx}
                y={cy + 14}
                textAnchor="middle"
                className="fill-slate-400"
                style={{ fontSize: 9 }}
              >
                {centerSub}
              </text>
            )}
          </>
        )}
      </svg>
      <ul className="text-[11px] space-y-1 min-w-0">
        {data.map((d, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-sm shrink-0"
              style={{ background: d.color }}
            />
            <span className="text-slate-600">{d.label}</span>
            <span className="font-semibold text-slate-900 tabular-nums">
              {d.value}
            </span>
            <span className="text-slate-400 tabular-nums">
              ({pct(d.value, total).toFixed(0)}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ─────────────────────────── 레이더 ─────────────────────────── */

export function Radar({
  axes,
  series,
  max = 100,
  size = 200,
}: {
  axes: string[];
  series: { label: string; color: string; values: number[] }[];
  max?: number;
  size?: number;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 26;
  const n = axes.length;
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const point = (i: number, val: number) => {
    const rr = (Math.max(0, Math.min(max, val)) / max) * r;
    return [cx + rr * Math.cos(angle(i)), cy + rr * Math.sin(angle(i))];
  };
  const rings = [0.25, 0.5, 0.75, 1];

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* 그리드 링 */}
        {rings.map((f, ri) => (
          <polygon
            key={ri}
            points={axes
              .map((_, i) => {
                const x = cx + r * f * Math.cos(angle(i));
                const y = cy + r * f * Math.sin(angle(i));
                return `${x},${y}`;
              })
              .join(" ")}
            fill="none"
            stroke={C.grid}
            strokeWidth={1}
          />
        ))}
        {/* 축선 + 라벨 */}
        {axes.map((ax, i) => {
          const [x, y] = [
            cx + r * Math.cos(angle(i)),
            cy + r * Math.sin(angle(i)),
          ];
          const lx = cx + (r + 14) * Math.cos(angle(i));
          const ly = cy + (r + 14) * Math.sin(angle(i));
          return (
            <g key={i}>
              <line x1={cx} y1={cy} x2={x} y2={y} stroke={C.grid} />
              <text
                x={lx}
                y={ly}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-slate-500"
                style={{ fontSize: 9.5 }}
              >
                {ax}
              </text>
            </g>
          );
        })}
        {/* 데이터 다각형 */}
        {series.map((s, si) => {
          const pts = axes
            .map((_, i) => point(i, s.values[i] ?? 0).join(","))
            .join(" ");
          return (
            <g key={si}>
              <polygon
                points={pts}
                fill={s.color}
                fillOpacity={0.14}
                stroke={s.color}
                strokeWidth={1.8}
              />
              {axes.map((_, i) => {
                const [px, py] = point(i, s.values[i] ?? 0);
                return <circle key={i} cx={px} cy={py} r={2.2} fill={s.color} />;
              })}
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] mt-1">
        {series.map((s, i) => (
          <span key={i} className="inline-flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-sm"
              style={{ background: s.color }}
            />
            <span className="text-slate-600">{s.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────── 산점도 ─────────────────────────── */

export function Scatter({
  points,
  xLabel,
  yLabel,
  xMax = 100,
  yMax = 100,
  width = 340,
  height = 260,
}: {
  points: { x: number; y: number; color: string; title?: string }[];
  xLabel: string;
  yLabel: string;
  xMax?: number;
  yMax?: number;
  width?: number;
  height?: number;
}) {
  const padL = 34;
  const padB = 28;
  const padT = 8;
  const padR = 8;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const sx = (x: number) => padL + (x / xMax) * plotW;
  const sy = (y: number) => padT + plotH - (y / yMax) * plotH;
  const ticks = [0, 25, 50, 75, 100];

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="max-w-md">
      {/* 그리드 */}
      {ticks.map((t) => (
        <g key={`gx${t}`}>
          <line
            x1={sx((t / 100) * xMax)}
            y1={padT}
            x2={sx((t / 100) * xMax)}
            y2={padT + plotH}
            stroke={C.grid}
          />
          <text
            x={sx((t / 100) * xMax)}
            y={height - 10}
            textAnchor="middle"
            className="fill-slate-400"
            style={{ fontSize: 8 }}
          >
            {Math.round((t / 100) * xMax)}
          </text>
        </g>
      ))}
      {ticks.map((t) => (
        <g key={`gy${t}`}>
          <line
            x1={padL}
            y1={sy((t / 100) * yMax)}
            x2={padL + plotW}
            y2={sy((t / 100) * yMax)}
            stroke={C.grid}
          />
          <text
            x={padL - 5}
            y={sy((t / 100) * yMax) + 3}
            textAnchor="end"
            className="fill-slate-400"
            style={{ fontSize: 8 }}
          >
            {Math.round((t / 100) * yMax)}
          </text>
        </g>
      ))}
      {/* 점 */}
      {points.map((p, i) => (
        <circle
          key={i}
          cx={sx(p.x)}
          cy={sy(p.y)}
          r={4}
          fill={p.color}
          fillOpacity={0.7}
          stroke="#fff"
          strokeWidth={0.8}
        >
          {p.title && <title>{p.title}</title>}
        </circle>
      ))}
      <text
        x={padL + plotW / 2}
        y={height - 0.5}
        textAnchor="middle"
        className="fill-slate-500"
        style={{ fontSize: 9 }}
      >
        {xLabel}
      </text>
      <text
        x={-(padT + plotH / 2)}
        y={9}
        transform="rotate(-90)"
        textAnchor="middle"
        className="fill-slate-500"
        style={{ fontSize: 9 }}
      >
        {yLabel}
      </text>
    </svg>
  );
}

/* ─────────────────── 세로 막대 (히스토그램, 누적 강조) ─────────────────── */

export function VBars({
  bars,
  height = 150,
  color = C.blue,
  hiColor = C.primary,
  hiLabel,
  baseLabel,
  unit = "명",
}: {
  // value = 전체 높이, hi = 그중 강조(예: 합격) 누적분(하단)
  bars: { label: string; value: number; hi?: number }[];
  height?: number;
  color?: string;
  hiColor?: string;
  hiLabel?: string;
  baseLabel?: string;
  unit?: string;
}) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  const hasHi = bars.some((b) => (b.hi ?? 0) > 0);
  return (
    <div>
      <div className="flex items-end gap-1.5" style={{ height }}>
        {bars.map((b, i) => {
          const h = (b.value / max) * (height - 18);
          const hiH = ((b.hi ?? 0) / max) * (height - 18);
          return (
            <div
              key={i}
              className="flex-1 flex flex-col items-center justify-end h-full min-w-0"
              title={`${b.label}: ${b.value}${unit}${
                b.hi != null ? ` (강조 ${b.hi})` : ""
              }`}
            >
              <span className="text-[9px] text-slate-500 tabular-nums mb-0.5">
                {b.value || ""}
              </span>
              <div
                className="w-full rounded-t relative"
                style={{ height: Math.max(b.value > 0 ? 2 : 0, h), background: color }}
              >
                {hiH > 0 && (
                  <div
                    className="absolute bottom-0 left-0 w-full rounded-t"
                    style={{ height: hiH, background: hiColor }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-1.5 mt-1">
        {bars.map((b, i) => (
          <div
            key={i}
            className="flex-1 text-center text-[8.5px] text-slate-400 leading-tight min-w-0 truncate"
          >
            {b.label}
          </div>
        ))}
      </div>
      {hasHi && (hiLabel || baseLabel) && (
        <div className="flex justify-center gap-4 mt-1.5 text-[10px]">
          <span className="inline-flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-sm"
              style={{ background: color }}
            />
            <span className="text-slate-500">{baseLabel ?? "전체"}</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-sm"
              style={{ background: hiColor }}
            />
            <span className="text-slate-500">{hiLabel ?? "강조"}</span>
          </span>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────── 가로 막대 (라벨 + 수치) ─────────────────────── */

export function HBars({
  rows,
  unit = "",
}: {
  rows: {
    label: string;
    value: number;
    max: number;
    display?: string;
    sub?: string;
    color?: string;
  }[];
  unit?: string;
}) {
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => {
        const w = r.max > 0 ? (r.value / r.max) * 100 : 0;
        return (
          <div key={i} className="flex items-center gap-3 text-xs">
            <span className="w-28 shrink-0 text-slate-600 truncate" title={r.label}>
              {r.label}
            </span>
            <div className="flex-1 bg-slate-100 rounded h-5 relative overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 rounded"
                style={{ width: `${w}%`, background: r.color ?? C.primarySoft }}
              />
              <span className="absolute inset-0 flex items-center px-2 text-[10px] text-slate-700 font-medium tabular-nums">
                {r.display ?? `${r.value}${unit}`}
                {r.sub && <span className="text-slate-400 ml-1">{r.sub}</span>}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ───────────────── 리드타임 추이 (날짜 x · 일수 y 점도표) ───────────────── */

export function DotTrend({
  points,
  yMax,
  yLabel,
  width = 340,
  height = 170,
}: {
  points: { t: number; y: number; color: string; title?: string }[]; // t: 0~1 정규화
  yMax: number;
  yLabel: string;
  width?: number;
  height?: number;
}) {
  const padL = 30;
  const padB = 16;
  const padT = 8;
  const padR = 8;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const sx = (t: number) => padL + t * plotW;
  const sy = (y: number) => padT + plotH - (y / yMax) * plotH;
  const yticks = [0, 0.5, 1];

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} className="max-w-md">
      {yticks.map((f) => (
        <g key={f}>
          <line
            x1={padL}
            y1={sy(f * yMax)}
            x2={padL + plotW}
            y2={sy(f * yMax)}
            stroke={C.grid}
          />
          <text
            x={padL - 4}
            y={sy(f * yMax) + 3}
            textAnchor="end"
            className="fill-slate-400"
            style={{ fontSize: 8 }}
          >
            {Math.round(f * yMax)}
          </text>
        </g>
      ))}
      {points.map((p, i) => (
        <circle
          key={i}
          cx={sx(p.t)}
          cy={sy(Math.min(yMax, p.y))}
          r={3.5}
          fill={p.color}
          fillOpacity={0.7}
          stroke="#fff"
          strokeWidth={0.8}
        >
          {p.title && <title>{p.title}</title>}
        </circle>
      ))}
      <text
        x={padL}
        y={height - 3}
        className="fill-slate-400"
        style={{ fontSize: 8 }}
      >
        ← 먼저 결정
      </text>
      <text
        x={padL + plotW}
        y={height - 3}
        textAnchor="end"
        className="fill-slate-400"
        style={{ fontSize: 8 }}
      >
        최근 결정 →
      </text>
      <text
        x={-(padT + plotH / 2)}
        y={9}
        transform="rotate(-90)"
        textAnchor="middle"
        className="fill-slate-500"
        style={{ fontSize: 9 }}
      >
        {yLabel}
      </text>
    </svg>
  );
}

/* ───────────────── 시계열 영역 차트 (일·주별 추이) ───────────────── */

export function TimeArea({
  points,
  height = 150,
  color = C.primary,
  unit = "건",
}: {
  points: { label: string; value: number }[];
  height?: number;
  color?: string;
  unit?: string;
}) {
  const width = 640;
  const padL = 26;
  const padR = 8;
  const padT = 10;
  const padB = 20;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const n = points.length;
  const max = Math.max(1, ...points.map((p) => p.value));
  const total = points.reduce((s, p) => s + p.value, 0);
  const sx = (i: number) =>
    padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const sy = (v: number) => padT + plotH - (v / max) * plotH;

  const line = points.map((p, i) => `${sx(i)},${sy(p.value)}`).join(" ");
  const area =
    n > 0 ? `${padL},${padT + plotH} ${line} ${sx(n - 1)},${padT + plotH}` : "";
  // x축 라벨은 과밀 방지를 위해 ~6개만
  const labelStep = Math.max(1, Math.ceil(n / 6));
  const peakIdx = points.reduce(
    (best, p, i) => (p.value > points[best].value ? i : best),
    0
  );

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`}>
        {[0, 0.5, 1].map((f) => (
          <line
            key={f}
            x1={padL}
            y1={sy(f * max)}
            x2={padL + plotW}
            y2={sy(f * max)}
            stroke={C.grid}
          />
        ))}
        <text
          x={padL - 4}
          y={sy(max) + 3}
          textAnchor="end"
          className="fill-slate-400"
          style={{ fontSize: 8 }}
        >
          {max}
        </text>
        {area && <polygon points={area} fill={color} fillOpacity={0.12} />}
        {n > 1 && (
          <polyline points={line} fill="none" stroke={color} strokeWidth={1.8} />
        )}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={sx(i)}
            cy={sy(p.value)}
            r={n > 40 ? 0 : 2.2}
            fill={color}
          >
            <title>{`${p.label}: ${p.value}${unit}`}</title>
          </circle>
        ))}
        {n > 0 && max > 0 && (
          <text
            x={sx(peakIdx)}
            y={sy(points[peakIdx].value) - 5}
            textAnchor="middle"
            className="fill-slate-500"
            style={{ fontSize: 8, fontWeight: 600 }}
          >
            {points[peakIdx].value}
          </text>
        )}
        {points.map((p, i) =>
          i % labelStep === 0 || i === n - 1 ? (
            <text
              key={`l${i}`}
              x={sx(i)}
              y={height - 6}
              textAnchor="middle"
              className="fill-slate-400"
              style={{ fontSize: 8 }}
            >
              {p.label}
            </text>
          ) : null
        )}
      </svg>
      <div className="text-[10px] text-slate-400 text-right mt-0.5">
        기간 합계 {total}
        {unit}
      </div>
    </div>
  );
}
