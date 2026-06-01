"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { compositeScore, formatKstDateTime } from "@/lib/utils";

type Candidate = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  age: number | null;
  careerYears: number | null;
  careerSummary: string | null;
  screeningScore: number | null;
  screeningReport: {
    score: number;
    recommendation: string;
    summary: string;
    strengths: string[];
    concerns: string[];
    matched_keywords: string[];
  } | null;
  status: string;
  stage: string;
  createdAt: string;
  latestInterviewStatus: string | null;
  latestInterviewScore: number | null;
  latestInterviewRecommendation: string | null;
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

export default function ComparePage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const idsParam = search.get("ids") ?? "";
  const ids = idsParam
    .split(",")
    .map((s) => Number(s.trim()))
    .filter(Number.isInteger);

  const [all, setAll] = useState<Candidate[] | null>(null);

  useEffect(() => {
    void fetch(`/api/jobs/${params.id}/candidates`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setAll(d));
  }, [params.id]);

  if (!all)
    return (
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 text-slate-500">
        불러오는 중...
      </main>
    );

  const selected = all.filter((c) => ids.includes(c.id));

  if (selected.length === 0) {
    return (
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <Link
          href={`/jobs/${params.id}`}
          className="text-xs text-slate-500 hover:underline"
        >
          ← 공고 상세
        </Link>
        <div className="bg-white border border-slate-200 rounded-2xl p-10 mt-4 text-center text-slate-500">
          비교할 후보자가 선택되지 않았습니다.
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <Link
        href={`/jobs/${params.id}`}
        className="text-xs text-slate-500 hover:underline"
      >
        ← 공고 상세
      </Link>
      <h1 className="text-2xl font-bold text-slate-900 mt-2">
        후보자 비교 ({selected.length}명)
      </h1>
      <p className="text-sm text-slate-500 mt-1">
        선택된 후보자의 평가 점수, 강점, 우려 사항을 나란히 비교합니다.
      </p>

      <div className="mt-6 grid gap-4" style={{ gridTemplateColumns: `repeat(${selected.length}, minmax(220px, 1fr))` }}>
        {selected.map((c) => {
          const composite =
            c.latestInterviewScore != null
              ? compositeScore(c.screeningScore, c.latestInterviewScore)
              : null;
          return (
            <div
              key={c.id}
              className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden"
            >
              <div className="px-4 py-4 border-b border-slate-100 bg-slate-50">
                <Link
                  href={`/candidates/${c.id}`}
                  className="font-semibold text-slate-900 hover:text-primary"
                >
                  {c.name}
                </Link>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {STAGE_KO[c.stage] ?? c.stage}
                </div>
              </div>

              <div className="px-4 py-4 grid grid-cols-3 gap-2 text-center border-b border-slate-100">
                <ScoreBlock label="서류" score={c.screeningScore} />
                <ScoreBlock label="면접" score={c.latestInterviewScore} />
                <ScoreBlock label="종합" score={composite} accent="blue" />
              </div>

              <div className="px-4 py-3 text-xs text-slate-600 space-y-1 border-b border-slate-100">
                {c.careerYears != null && <div>경력 {c.careerYears}년</div>}
                {c.age != null && <div>{c.age}세</div>}
                {c.email && (
                  <div className="text-slate-400 truncate">{c.email}</div>
                )}
              </div>

              {c.careerSummary && (
                <div className="px-4 py-3 text-xs text-slate-700 leading-relaxed border-b border-slate-100">
                  {c.careerSummary}
                </div>
              )}

              {c.screeningReport && (
                <>
                  <div className="px-4 py-3 border-b border-slate-100">
                    <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                      서류 추천
                    </div>
                    <RecBadge rec={c.screeningReport.recommendation} />
                    <p className="text-xs text-slate-700 mt-2 leading-relaxed">
                      {c.screeningReport.summary}
                    </p>
                  </div>

                  <BulletSection
                    title="강점"
                    items={c.screeningReport.strengths}
                    color="emerald"
                  />
                  <BulletSection
                    title="우려"
                    items={c.screeningReport.concerns}
                    color="amber"
                  />
                </>
              )}

              {c.latestInterviewRecommendation && (
                <div className="px-4 py-3 border-t border-slate-200 bg-primary-soft/30">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                    면접 추천
                  </div>
                  <RecBadge rec={c.latestInterviewRecommendation} />
                </div>
              )}

              <div className="px-4 py-2 text-[10px] text-slate-400 bg-slate-50">
                업로드 {formatKstDateTime(c.createdAt)}
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}

function ScoreBlock({
  label,
  score,
  accent = "slate",
}: {
  label: string;
  score: number | null;
  accent?: "slate" | "blue";
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div
        className={`text-xl font-bold ${
          accent === "blue" ? "text-primary" : "text-slate-900"
        }`}
      >
        {score != null ? score : "-"}
      </div>
    </div>
  );
}

function RecBadge({ rec }: { rec: string }) {
  // 강력추천 / 비추천 만 노출. 중간 단계는 점수로 판단.
  const colorMap: Record<string, string> = {
    강력추천: "bg-primary text-surface",
    비추천: "bg-danger-soft text-danger",
  };
  if (!(rec in colorMap)) return null;
  return (
    <span
      className={`text-[11px] px-2 py-0.5 rounded-md font-medium ${colorMap[rec]}`}
    >
      {rec}
    </span>
  );
}

function BulletSection({
  title,
  items,
  color,
}: {
  title: string;
  items: string[];
  color: "emerald" | "amber";
}) {
  if (!items || items.length === 0) return null;
  const dotCls = color === "emerald" ? "bg-primary" : "bg-warning";
  return (
    <div className="px-4 py-3 border-b border-slate-100">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
        {title}
      </div>
      <ul className="space-y-1">
        {items.slice(0, 5).map((it, i) => (
          <li key={i} className="text-xs text-slate-700 flex gap-2">
            <span
              className={`w-1.5 h-1.5 rounded-full ${dotCls} mt-1.5 shrink-0`}
            />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
