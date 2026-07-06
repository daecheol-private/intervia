"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FitHexagon } from "@/app/candidates/[id]/screening-report";
import { HL } from "@/app/candidates/[id]/shared";
import type { Candidate as DetailCandidate } from "@/app/candidates/[id]/types";

type Report = DetailCandidate["screeningReport"];
type Eval = { score: number | null; summary: string | null };

type Cand = {
  id: number;
  name: string;
  stage: string;
  age: number | null;
  careerYears: number | null;
  educationLevel: string | null;
  educationSchool: string | null;
  educationMajor: string | null;
  screeningScore: number | null;
  screeningReport: Report;
  aiInterview: Eval | null;
  offline: { round1: Eval | null; round2: Eval | null };
};

const STAGE_KO: Record<string, string> = {
  applied: "지원",
  screened: "서류평가",
  ai_pending: "AI면접·대기",
  ai_evaluated: "AI면접·평가",
  round1_candidate: "1차·후보",
  round1_scheduling: "1차·스케쥴",
  round1_waiting: "1차·대기",
  round1_passed: "1차 합격",
  round2_passed: "2차 합격",
  hired: "최종 합격",
  rejected: "불합격",
  withdrawn: "지원취소",
};

type CoverageStatus = "direct" | "indirect" | "none";

const normReq = (s: string) => s.replace(/\s+/g, "").toLowerCase();

function fitPct(report: Report): number | null {
  const cov = report?.requirement_coverage;
  if (!cov || cov.length === 0) return null;
  let sum = 0;
  for (const c of cov)
    sum += c.status === "direct" ? 1 : c.status === "indirect" ? 0.5 : 0;
  return Math.round((sum / cov.length) * 100);
}

// 종합평가의견 — 가장 진행된 단계의 요약 우선(대면2 → 대면1 → AI면접 → 서류).
function overallOpinion(
  c: Cand
): { source: string; text: string } | null {
  if (c.offline?.round2?.summary)
    return { source: "대면 2차", text: c.offline.round2.summary };
  if (c.offline?.round1?.summary)
    return { source: "대면 1차", text: c.offline.round1.summary };
  if (c.aiInterview?.summary)
    return { source: "AI면접", text: c.aiInterview.summary };
  if (c.screeningReport?.summary)
    return { source: "서류", text: c.screeningReport.summary };
  return null;
}

export default function ComparePage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const idsParam = search.get("ids") ?? "";

  const [data, setData] = useState<Cand[] | null>(null);

  useEffect(() => {
    if (!idsParam) {
      setData([]);
      return;
    }
    void fetch(`/api/jobs/${params.id}/compare?ids=${idsParam}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d ?? []));
  }, [params.id, idsParam]);

  const selected = useMemo<Cand[]>(() => {
    if (!data) return [];
    return [...data].sort(
      (a, b) => (b.screeningScore ?? -1) - (a.screeningScore ?? -1)
    );
  }, [data]);

  const reqUnion = useMemo<{ key: string; label: string }[]>(() => {
    const seen = new Map<string, string>();
    const order: string[] = [];
    for (const c of selected)
      for (const rc of c.screeningReport?.requirement_coverage ?? []) {
        const k = normReq(rc.requirement);
        if (!seen.has(k)) {
          seen.set(k, rc.requirement);
          order.push(k);
        }
      }
    return order.map((k) => ({ key: k, label: seen.get(k)! }));
  }, [selected]);

  const covByCand = useMemo(() => {
    const m = new Map<number, Map<string, CoverageStatus>>();
    for (const c of selected) {
      const inner = new Map<string, CoverageStatus>();
      for (const rc of c.screeningReport?.requirement_coverage ?? [])
        inner.set(normReq(rc.requirement), rc.status);
      m.set(c.id, inner);
    }
    return m;
  }, [selected]);

  if (!data)
    return (
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 text-ink-muted">
        불러오는 중...
      </main>
    );

  if (selected.length === 0) {
    return (
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <Link
          href={`/jobs/${params.id}`}
          className="text-xs text-ink-muted hover:underline"
        >
          ← 공고 상세
        </Link>
        <div className="bg-card border border-border-default rounded-2xl p-10 mt-4 text-center text-ink-muted">
          비교할 후보자가 선택되지 않았습니다.
        </div>
      </main>
    );
  }

  const hasFit = selected.some((c) => fitPct(c.screeningReport) != null);
  const hasAi = selected.some((c) => c.aiInterview?.score != null);
  const hasR1 = selected.some((c) => c.offline?.round1?.score != null);
  const hasR2 = selected.some((c) => c.offline?.round2?.score != null);
  const hasOpinion = selected.some((c) => overallOpinion(c) != null);

  const span = selected.length + 1;

  return (
    <main className="max-w-full mx-auto px-4 sm:px-6 py-6">
      <Link
        href={`/jobs/${params.id}`}
        className="text-xs text-ink-muted hover:underline"
      >
        ← 공고 상세
      </Link>
      <h1 className="text-xl font-bold text-ink mt-2">
        후보자 비교 ({selected.length}명)
      </h1>
      <p className="text-xs text-ink-muted mt-0.5">
        서류·AI면접·대면 평가를 한 화면에 · 서류 적합도 높은 순 정렬
      </p>

      <div className="mt-4 overflow-x-auto rounded-xl border border-border-default w-fit max-w-full">
        <table className="border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-20 bg-surface-alt border-b border-r border-border-default px-2.5 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-ink-muted w-32 min-w-32 align-bottom">
                지표
              </th>
              {selected.map((c, i) => (
                <th
                  key={c.id}
                  className="bg-surface-alt border-b border-l border-border-default px-3 py-2 text-left align-bottom w-[200px] min-w-[200px]"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-semibold text-ink-muted tabular-nums">
                      #{i + 1}
                    </span>
                    <Link
                      href={`/candidates/${c.id}`}
                      className="font-semibold text-ink hover:text-primary truncate"
                    >
                      {c.name}
                    </Link>
                  </div>
                  <div className="text-[11px] text-ink-muted mt-0.5 font-normal">
                    {STAGE_KO[c.stage] ?? c.stage}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* 6축 적합도 레이더 */}
            <tr className="border-b border-border-default">
              <th className="sticky left-0 z-10 bg-card border-r border-border-default px-2.5 py-2 text-left align-top font-medium text-ink">
                공고 적합도
                <span className="block text-[10px] text-ink-muted font-normal mt-0.5">
                  6축
                </span>
              </th>
              {selected.map((c) => {
                const bd = c.screeningReport?.breakdown;
                return (
                  <td
                    key={c.id}
                    className="border-l border-border-default px-1 py-1 align-middle"
                  >
                    {bd ? (
                      <div className="flex justify-center">
                        <FitHexagon breakdown={bd} size={186} />
                      </div>
                    ) : (
                      <div className="h-[120px] flex items-center justify-center text-xs text-ink-muted">
                        서류 미평가
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>

            {/* 평가 점수 — 서류 / AI면접 / 대면 1·2차 */}
            <GroupRow span={span} label="평가 점수" />
            <ScoreRow
              label="서류 적합도"
              selected={selected}
              get={(c) => c.screeningScore}
            />
            {hasAi && (
              <ScoreRow
                label="AI면접"
                selected={selected}
                get={(c) => c.aiInterview?.score ?? null}
              />
            )}
            {hasR1 && (
              <ScoreRow
                label="대면 1차"
                selected={selected}
                get={(c) => c.offline?.round1?.score ?? null}
              />
            )}
            {hasR2 && (
              <ScoreRow
                label="대면 2차"
                selected={selected}
                get={(c) => c.offline?.round2?.score ?? null}
              />
            )}

            {/* 종합평가의견 */}
            {hasOpinion && (
              <>
                <GroupRow span={span} label="종합평가의견" />
                <tr className="border-b border-border-default">
                  <th className="sticky left-0 z-10 bg-card border-r border-border-default px-2.5 py-2" />
                  {selected.map((c) => {
                    const op = overallOpinion(c);
                    return (
                      <td
                        key={c.id}
                        className="border-l border-border-default px-3 py-2 align-top"
                      >
                        {op ? (
                          <div>
                            <span className="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary-soft text-primary mb-1">
                              {op.source}
                            </span>
                            <p className="text-[11px] text-ink-soft leading-snug">
                              <HL text={op.text} />
                            </p>
                          </div>
                        ) : (
                          <span className="text-ink-muted text-xs">-</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              </>
            )}

            {/* 이력 */}
            <GroupRow span={span} label="이력" />
            <TextRow
              label="학력"
              selected={selected}
              get={(c) =>
                [c.educationLevel, c.educationSchool].filter(Boolean).join(" · ") ||
                null
              }
            />
            <TextRow
              label="전공"
              selected={selected}
              get={(c) => c.educationMajor}
            />
            <TextRow
              label="경력"
              selected={selected}
              get={(c) => (c.careerYears != null ? `${c.careerYears}년` : null)}
            />
            <TextRow
              label="나이"
              selected={selected}
              get={(c) => (c.age != null ? `${c.age}세` : null)}
            />

            {/* JD 요건 */}
            {hasFit && (
              <>
                <GroupRow span={span} label="JD 요건" />
                <tr className="border-b border-border-default">
                  <th className="sticky left-0 z-10 bg-card border-r border-border-default px-2.5 py-1.5 text-left font-medium text-ink-soft">
                    JD 충족도
                  </th>
                  {selected.map((c) => {
                    const pct = fitPct(c.screeningReport);
                    return (
                      <td
                        key={c.id}
                        className="border-l border-border-default px-3 py-1.5"
                      >
                        {pct == null ? (
                          <span className="text-ink-muted text-xs">-</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 rounded-full bg-surface-alt overflow-hidden">
                              <div
                                className="h-full rounded-full bg-primary"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="tabular-nums w-9 text-right text-primary font-semibold">
                              {pct}%
                            </span>
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
                {reqUnion.map(({ key, label }) => (
                  <tr key={key} className="border-b border-border-default">
                    <th className="sticky left-0 z-10 bg-card border-r border-border-default px-2.5 py-1.5 text-left font-normal text-[11px] text-ink-soft align-middle leading-snug">
                      {label}
                    </th>
                    {selected.map((c) => (
                      <td
                        key={c.id}
                        className="border-l border-border-default px-3 py-1.5 text-center"
                      >
                        <CoverageBadge status={covByCand.get(c.id)?.get(key)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </>
            )}
          </tbody>
        </table>
      </div>

      {hasFit && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-muted">
          <span>JD 요건:</span>
          <CoverageLegend status="direct" label="직접" />
          <CoverageLegend status="indirect" label="간접" />
          <CoverageLegend status="none" label="근거 없음" />
        </div>
      )}
    </main>
  );
}

/** 점수 한 행 — 후보별 막대 + 숫자, 행 최댓값 강조. */
function ScoreRow({
  label,
  selected,
  get,
}: {
  label: string;
  selected: Cand[];
  get: (c: Cand) => number | null;
}) {
  const values = selected.map(get);
  const max = Math.max(...values.filter((v): v is number => v != null), -Infinity);
  return (
    <tr className="border-b border-border-default">
      <th className="sticky left-0 z-10 bg-card border-r border-border-default px-2.5 py-1.5 text-left font-medium text-ink-soft">
        {label}
      </th>
      {selected.map((c) => {
        const v = get(c);
        const best = v != null && v === max;
        return (
          <td key={c.id} className="border-l border-border-default px-3 py-1.5">
            {v == null ? (
              <span className="text-ink-muted text-xs">-</span>
            ) : (
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 rounded-full bg-surface-alt overflow-hidden">
                  <div
                    className={`h-full rounded-full ${best ? "bg-primary" : "bg-primary/35"}`}
                    style={{ width: `${Math.max(0, Math.min(100, v))}%` }}
                  />
                </div>
                <span
                  className={`tabular-nums w-7 text-right ${
                    best ? "text-primary font-bold" : "text-ink-soft"
                  }`}
                >
                  {v}
                </span>
              </div>
            )}
          </td>
        );
      })}
    </tr>
  );
}

const COVERAGE_META: Record<
  CoverageStatus,
  { glyph: string; cls: string; title: string }
> = {
  direct: { glyph: "✓", cls: "bg-primary text-surface", title: "직접 부합" },
  indirect: { glyph: "~", cls: "bg-info text-surface", title: "간접 부합" },
  none: { glyph: "–", cls: "bg-surface-alt text-ink-muted", title: "근거 없음" },
};

function CoverageBadge({ status }: { status?: CoverageStatus }) {
  if (!status) return <span className="text-ink-muted text-xs">·</span>;
  const m = COVERAGE_META[status];
  return (
    <span
      title={m.title}
      className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold ${m.cls}`}
    >
      {m.glyph}
    </span>
  );
}

function CoverageLegend({
  status,
  label,
}: {
  status: CoverageStatus;
  label: string;
}) {
  const m = COVERAGE_META[status];
  return (
    <span className="flex items-center gap-1">
      <span
        className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-[9px] font-bold ${m.cls}`}
      >
        {m.glyph}
      </span>
      {label}
    </span>
  );
}

function GroupRow({ span, label }: { span: number; label: string }) {
  return (
    <tr>
      <td
        colSpan={span}
        className="sticky left-0 bg-surface-alt border-y border-border-default px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-ink-muted"
      >
        {label}
      </td>
    </tr>
  );
}

function TextRow({
  label,
  selected,
  get,
}: {
  label: string;
  selected: Cand[];
  get: (c: Cand) => string | null;
}) {
  return (
    <tr className="border-b border-border-default">
      <th className="sticky left-0 z-10 bg-card border-r border-border-default px-2.5 py-1.5 text-left font-medium text-ink-soft">
        {label}
      </th>
      {selected.map((c) => (
        <td
          key={c.id}
          className="border-l border-border-default px-3 py-1.5 text-ink-soft text-xs"
        >
          {get(c) ?? <span className="text-ink-muted">-</span>}
        </td>
      ))}
    </tr>
  );
}
