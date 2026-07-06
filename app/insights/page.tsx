import { db } from "@/lib/db";
import { candidates, interviewSessions } from "@/lib/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { candidateOrgFilter } from "@/lib/tenant";
import { redirect } from "next/navigation";
import { Target, TriangleAlert } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * AI 평가 정확도 — "AI 점수·추천이 실제 채용 결정과 얼마나 맞았나".
 *
 * 별도 설문/피드백 UI 없이, 이미 쌓이는 데이터(서류·면접 점수 vs stage/outcome)를
 * 집계만 한다. 점수대별로 최종 합격/불합격/진행중 비율을 보여줘 "점수 높을수록 합격이
 * 많은가"(=예측력)를 눈으로 확인. 개인 식별 없이 카운트/비율만 다룬다(PII 미표시).
 * 법인 단위 스코프(candidateOrgFilter) — system_admin 은 전체.
 */

const BANDS = [
  { label: "90–100", lo: 90, hi: 100 },
  { label: "80–89", lo: 80, hi: 89 },
  { label: "70–79", lo: 70, hi: 79 },
  { label: "60–69", lo: 60, hi: 69 },
  { label: "0–59", lo: 0, hi: 59 },
];

type Row = {
  screeningScore: number | null;
  interviewScore: number | null;
  rec: string | null;
  stage: string;
  outcome: string | null;
};

type Band = {
  label: string;
  n: number;
  hired: number;
  rejected: number;
  pending: number;
};

export default async function InsightsPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  const candWhere = candidateOrgFilter(me); // system_admin 은 undefined(전체)

  const cands = await db
    .select({
      id: candidates.id,
      screeningScore: candidates.screeningScore,
      rec: sql<string | null>`json_extract(${candidates.screeningReport}, '$.recommendation')`,
      stage: candidates.stage,
      outcome: candidates.outcome,
    })
    .from(candidates)
    .where(candWhere);

  // 최신 완료 면접 세션의 종합 점수 — 후보자별 1건.
  const sessions = await db
    .select({
      candidateId: interviewSessions.candidateId,
      evaluation: interviewSessions.evaluation,
    })
    .from(interviewSessions)
    .innerJoin(candidates, eq(candidates.id, interviewSessions.candidateId))
    .where(
      candWhere
        ? and(eq(interviewSessions.status, "completed"), candWhere)
        : eq(interviewSessions.status, "completed")
    )
    .orderBy(desc(interviewSessions.createdAt));

  const interviewByCand = new Map<number, number>();
  for (const s of sessions) {
    if (interviewByCand.has(s.candidateId)) continue; // desc → 최신 1건만
    const sc = s.evaluation?.overall_score;
    if (typeof sc === "number") interviewByCand.set(s.candidateId, sc);
  }

  const rows: Row[] = cands.map((c) => ({
    screeningScore: c.screeningScore,
    interviewScore: interviewByCand.get(c.id) ?? null,
    rec: c.rec,
    stage: c.stage,
    outcome: c.outcome,
  }));

  const total = rows.length;
  const screenedN = rows.filter((r) => r.screeningScore != null).length;
  const interviewedN = rows.filter((r) => r.interviewScore != null).length;
  const hiredN = rows.filter((r) => r.outcome === "hired").length;
  const rejectedN = rows.filter((r) => r.outcome === "rejected").length;
  const decidedN = hiredN + rejectedN;

  function bands(getScore: (r: Row) => number | null): Band[] {
    return BANDS.map((b) => {
      const inBand = rows.filter((r) => {
        const s = getScore(r);
        return s != null && s >= b.lo && s <= b.hi;
      });
      const hired = inBand.filter((r) => r.outcome === "hired").length;
      const rejected = inBand.filter((r) => r.outcome === "rejected").length;
      return {
        label: b.label,
        n: inBand.length,
        hired,
        rejected,
        pending: inBand.length - hired - rejected,
      };
    }).filter((b) => b.n > 0);
  }

  const screenBands = bands((r) => r.screeningScore);
  const interviewBands = bands((r) => r.interviewScore);

  // AI 추천과 실제 결정이 갈린 지점 — 재검토 후보.
  const advanced = (r: Row) => !["applied", "screened"].includes(r.stage);
  const strongRejected = rows.filter(
    (r) => r.rec === "강력추천" && r.outcome === "rejected"
  ).length;
  const weakHired = rows.filter(
    (r) => r.rec === "비추천" && r.outcome === "hired"
  ).length;
  const weakAdvanced = rows.filter(
    (r) => r.rec === "비추천" && advanced(r) && r.outcome !== "rejected"
  ).length;

  return (
    <main className="max-w-4xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      <div className="flex items-center gap-2">
        <Target className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold text-ink">평가 정확도</h1>
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary-soft text-primary uppercase tracking-wide">
          Beta
        </span>
      </div>
      <p className="text-sm text-ink-soft mt-1">
        AI 점수·추천이 실제 채용 결정과 얼마나 맞았는지 봅니다. 점수대가 높을수록{" "}
        <span className="text-primary font-medium">합격</span> 비중이 크면 AI 평가가
        실제 결정과 정렬된 것입니다.
      </p>

      {total === 0 ? (
        <EmptyCard message="아직 후보자가 없습니다. 이력서를 업로드하고 평가가 쌓이면 여기에 정확도가 표시됩니다." />
      ) : decidedN === 0 ? (
        <EmptyCard message="아직 최종 합격/불합격으로 결정된 후보자가 없어 정확도를 계산할 표본이 없습니다. 채용 결정이 쌓이면 표시됩니다." />
      ) : (
        <>
          {decidedN < 10 && (
            <div className="mt-5 flex items-start gap-2 text-xs text-warning bg-warning-soft border border-warning/30 rounded-xl px-3 py-2.5">
              <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                최종 결정된 표본이 {decidedN}건으로 적습니다. 경향은 참고용으로만
                보세요 — 결정이 더 쌓이면 정확도가 또렷해집니다.
              </span>
            </div>
          )}

          {/* 표본 요약 */}
          <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="전체 후보자" value={total} />
            <Stat label="서류평가 완료" value={screenedN} />
            <Stat label="AI면접 완료" value={interviewedN} />
            <Stat label="최종 결정" value={decidedN} sub={`합격 ${hiredN} · 불합격 ${rejectedN}`} />
          </div>

          {/* 서류 점수대별 결과 */}
          <BandCard
            title="서류 점수 → 실제 결과"
            caption="각 점수대에서 최종 합격/불합격/진행중 비율"
            bands={screenBands}
          />

          {/* 면접 점수대별 결과 */}
          {interviewBands.length > 0 && (
            <BandCard
              title="AI면접 점수 → 실제 결과"
              caption="각 점수대에서 최종 합격/불합격/진행중 비율"
              bands={interviewBands}
            />
          )}

          {/* AI 추천 vs 실제 — 갈린 지점 */}
          <div className="mt-6 bg-card border border-border-default rounded-2xl p-5">
            <h2 className="font-semibold text-ink">AI 추천과 실제가 갈린 지점</h2>
            <p className="text-xs text-ink-muted mt-1">
              AI와 사람의 판단이 엇갈린 케이스 — 프롬프트·평가 기준을 되돌아볼 신호입니다.
            </p>
            <div className="mt-4 divide-y divide-border-default">
              <MismatchRow
                label="AI 강력추천 → 실제 불합격"
                count={strongRejected}
                note="AI가 강하게 밀었지만 탈락한 후보"
              />
              <MismatchRow
                label="AI 비추천 → 실제 합격"
                count={weakHired}
                note="AI가 낮게 봤지만 최종 합격한 후보"
              />
              <MismatchRow
                label="AI 비추천 → 면접 진출"
                count={weakAdvanced}
                note="AI가 낮게 봤지만 면접까지 진행한 후보"
              />
            </div>
          </div>
        </>
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: number;
  sub?: string;
}) {
  return (
    <div className="bg-card border border-border-default rounded-xl px-4 py-3">
      <div className="text-[11px] text-ink-muted">{label}</div>
      <div className="text-2xl font-bold text-ink tabular-nums mt-0.5">{value}</div>
      {sub && <div className="text-[11px] text-ink-muted mt-0.5">{sub}</div>}
    </div>
  );
}

function BandCard({
  title,
  caption,
  bands,
}: {
  title: string;
  caption: string;
  bands: Band[];
}) {
  return (
    <div className="mt-6 bg-card border border-border-default rounded-2xl p-5">
      <h2 className="font-semibold text-ink">{title}</h2>
      <p className="text-xs text-ink-muted mt-1">{caption}</p>
      <div className="mt-4 flex items-center gap-4 text-[11px] text-ink-muted">
        <LegendDot cls="bg-primary" label="합격" />
        <LegendDot cls="bg-danger" label="불합격" />
        <LegendDot cls="bg-surface-alt border border-border-strong" label="진행중" />
      </div>
      <div className="mt-3 space-y-3">
        {bands.map((b) => (
          <div key={b.label} className="flex items-center gap-3">
            <div className="w-16 shrink-0 text-sm font-medium text-ink-soft tabular-nums">
              {b.label}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex h-2.5 rounded-full overflow-hidden bg-surface-alt">
                <div
                  className="bg-primary"
                  style={{ width: `${(b.hired / b.n) * 100}%` }}
                />
                <div
                  className="bg-danger"
                  style={{ width: `${(b.rejected / b.n) * 100}%` }}
                />
              </div>
            </div>
            <div className="w-40 shrink-0 text-right text-[11px] text-ink-muted tabular-nums">
              n={b.n} · 합격 {b.hired} · 불합 {b.rejected} · 진행 {b.pending}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LegendDot({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`w-2.5 h-2.5 rounded-full ${cls}`} />
      {label}
    </span>
  );
}

function MismatchRow({
  label,
  count,
  note,
}: {
  label: string;
  count: number;
  note: string;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="flex-1 min-w-0">
        <div className="text-sm text-ink">{label}</div>
        <div className="text-[11px] text-ink-muted">{note}</div>
      </div>
      <div
        className={`text-xl font-bold tabular-nums shrink-0 ${
          count > 0 ? "text-ink" : "text-ink-muted"
        }`}
      >
        {count}
        <span className="text-xs font-normal text-ink-muted">건</span>
      </div>
    </div>
  );
}

function EmptyCard({ message }: { message: string }) {
  return (
    <div className="mt-6 bg-card border border-border-default rounded-2xl p-10 text-center text-ink-muted text-sm">
      {message}
    </div>
  );
}
