"use client";

import type { ReactNode } from "react";
import { PrintButton } from "@/app/jobs/[id]/report/PrintButton";
import {
  BreakdownBars,
  RequirementGateBadge,
  LevelMatchBadge,
  RequirementCoverageBlock,
  BulletBlock,
  ResumeTimelineBlock,
  QualitativeReviewBlock,
} from "@/app/candidates/[id]/screening-report";
import { recColor, showRec, scoreColor, HL } from "@/app/candidates/[id]/shared";
import { STAGE_LABELS } from "@/lib/stage-meta";
import type { Candidate } from "@/app/candidates/[id]/types";
import type {
  SharedReportPayload,
  PublicAiEvaluation,
  PublicRecordedReport,
} from "@/lib/shared-report";

type ScreeningReport = NonNullable<Candidate["screeningReport"]>;

/** 추천 배지 — 강력추천/비추천만 노출(원본 shared.showRec 규칙 재사용). */
function RecBadge({ rec }: { rec: string }) {
  if (!showRec(rec)) return null;
  return (
    <span
      className={`ml-auto text-xs font-semibold px-2.5 py-1 rounded-md border ${
        recColor[rec] ?? ""
      }`}
    >
      {rec}
    </span>
  );
}

/** 세 평가(서류/AI/대면)가 공유하는 점수 + 추천 + 요약 헤더. 원본 서류탭과 동일 톤. */
function EvalHeader({
  score,
  recommendation,
  summary,
}: {
  score: number;
  recommendation: string;
  summary: string;
}) {
  return (
    <>
      <div className="flex items-baseline gap-3">
        <div className={`text-5xl font-bold tabular-nums ${scoreColor(score)}`}>
          {score}
        </div>
        <span className="text-base text-ink-muted font-medium">/ 100</span>
        <RecBadge rec={recommendation} />
      </div>
      <blockquote className="border-l-4 border-primary/40 bg-primary-soft/30 px-4 py-3 rounded-r-lg text-ink leading-relaxed">
        <HL text={summary} />
      </blockquote>
    </>
  );
}

/** 역량별 점수 + 코멘트 (AI 면접·대면 공통 — scores 구조가 같다). */
function ScoreList({
  scores,
}: {
  scores: Record<
    string,
    { score: number; comment: string; not_assessed?: boolean }
  >;
}) {
  const entries = Object.entries(scores ?? {});
  if (entries.length === 0) return null;
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {entries.map(([k, v]) => (
        <div
          key={k}
          className="border border-border-default rounded-lg p-3 print:break-inside-avoid"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-semibold text-ink">{k}</span>
            {v.not_assessed ? (
              <span className="text-xs text-ink-muted">평가 못함</span>
            ) : (
              <span className="text-sm font-bold tabular-nums text-ink">
                {v.score}
                <span className="text-ink-muted font-normal text-xs"> / 100</span>
              </span>
            )}
          </div>
          {v.comment && (
            <p className="text-xs text-ink-soft mt-1.5 leading-relaxed">
              {v.comment}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

/** 서류평가 — 원본 page.tsx 서류탭과 동일하게 screening-report 블록을 재사용. */
function ScreeningSection({ report }: { report: ScreeningReport }) {
  return (
    <div className="space-y-4 text-sm">
      <EvalHeader
        score={report.score}
        recommendation={report.recommendation}
        summary={report.summary}
      />
      {report.breakdown && <BreakdownBars breakdown={report.breakdown} />}
      {report.requirement_gate && (
        <RequirementGateBadge gate={report.requirement_gate} />
      )}
      {report.level_match && report.level_match.fit !== "fit" && (
        <LevelMatchBadge match={report.level_match} />
      )}
      {report.requirement_coverage &&
        report.requirement_coverage.length > 0 && (
          <RequirementCoverageBlock coverage={report.requirement_coverage} />
        )}
      <div className="grid md:grid-cols-2 gap-4">
        <BulletBlock
          title="강점"
          items={report.strengths}
          color="emerald"
          emphasizeLead
          emphasis
        />
        <BulletBlock
          title="우려"
          items={report.concerns}
          color="amber"
          emphasizeLead
          emphasis
        />
      </div>
      {report.timeline && report.timeline.length > 0 && (
        <ResumeTimelineBlock timeline={report.timeline} />
      )}
      {report.qualitative_review && report.qualitative_review.length > 0 && (
        <QualitativeReviewBlock review={report.qualitative_review} />
      )}
    </div>
  );
}

/** AI 면접 평가 — 점수 헤더 + 역량 점수 + 강점/우려. */
function AiSection({ ev }: { ev: PublicAiEvaluation }) {
  return (
    <div className="space-y-4 text-sm">
      <EvalHeader
        score={ev.overall_score}
        recommendation={ev.recommendation}
        summary={ev.summary}
      />
      <ScoreList scores={ev.scores} />
      <div className="grid md:grid-cols-2 gap-4">
        <BulletBlock
          title="강점"
          items={ev.strengths}
          color="emerald"
          emphasizeLead
          emphasis
        />
        <BulletBlock
          title="우려"
          items={ev.concerns}
          color="amber"
          emphasizeLead
          emphasis
        />
      </div>
    </div>
  );
}

/** 대면 평가 — 강점/우려는 {text} 배열이라 텍스트만 뽑아 BulletBlock 재사용. */
function RecordedSection({ report }: { report: PublicRecordedReport }) {
  return (
    <div className="space-y-4 text-sm">
      <EvalHeader
        score={report.overall_score}
        recommendation={report.recommendation}
        summary={report.summary}
      />
      <ScoreList scores={report.scores} />
      <div className="grid md:grid-cols-2 gap-4">
        <BulletBlock
          title="강점"
          items={report.strengths.map((s) => s.text)}
          color="emerald"
          emphasizeLead
          emphasis
        />
        <BulletBlock
          title="우려"
          items={report.concerns.map((c) => c.text)}
          color="amber"
          emphasizeLead
          emphasis
        />
      </div>
    </div>
  );
}

export function SharedReportView({ data }: { data: SharedReportPayload }) {
  const { candidate, job, screening, aiInterview, recorded } = data;
  const stageLabel =
    STAGE_LABELS[candidate.stage as keyof typeof STAGE_LABELS] ??
    candidate.stage;

  // 준비된 평가만 순서대로 — 없는 단계는 블록 자체가 나오지 않는다.
  const sections: Array<{ key: string; title: string; node: ReactNode }> = [];
  if (screening)
    sections.push({
      key: "screening",
      title: "이력서 평가",
      node: (
        <ScreeningSection
          report={screening.report as unknown as ScreeningReport}
        />
      ),
    });
  if (aiInterview)
    sections.push({
      key: "ai",
      title: "AI 면접 평가",
      node: <AiSection ev={aiInterview} />,
    });
  if (recorded.round1)
    sections.push({
      key: "r1",
      title: "1차 대면 평가",
      node: <RecordedSection report={recorded.round1} />,
    });
  if (recorded.round2)
    sections.push({
      key: "r2",
      title: "2차 대면 평가",
      node: <RecordedSection report={recorded.round2} />,
    });

  return (
    <main
      className="mx-auto max-w-4xl px-4 py-8 sm:py-10 print:py-0 print:px-0 print:max-w-none"
      style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}
    >
      {/* 인쇄 시 A4 + 상위 레이아웃 네비/푸터 숨김. */}
      <style>{`@media print { @page { size: A4; margin: 12mm 10mm; } body > nav, body > footer { display: none !important; } }`}</style>

      <header className="flex items-start justify-between gap-4 border-b border-border-default pb-5 mb-6 print:break-inside-avoid">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
            Intervia 평가 리포트
          </div>
          <h1 className="text-2xl font-bold text-ink mt-1 truncate">
            {candidate.name}
          </h1>
          <p className="text-sm text-ink-muted mt-0.5">
            {job?.title ?? "—"}
            {job?.position ? ` · ${job.position}` : ""}
            <span className="mx-1.5 text-border-strong">·</span>
            {stageLabel}
          </p>
        </div>
        <div className="print:hidden shrink-0">
          <PrintButton />
        </div>
      </header>

      <div className="space-y-5">
        {sections.map((s, i) => (
          <section
            key={s.key}
            className="bg-card border border-border-default rounded-2xl shadow-sm p-6 space-y-4 print:break-inside-avoid print:shadow-none"
          >
            <div className="flex items-center gap-2.5">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary text-surface text-xs font-bold tabular-nums">
                {i + 1}
              </span>
              <h2 className="text-lg font-semibold text-ink">{s.title}</h2>
            </div>
            {s.node}
          </section>
        ))}
      </div>

      <footer className="mt-8 pt-4 border-t border-border-default text-xs text-ink-muted print:break-inside-avoid">
        Intervia 공유 리포트 · 무단 재배포 금지
      </footer>
    </main>
  );
}
