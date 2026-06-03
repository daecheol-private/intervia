"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  compositeScore,
  recommendationFromScore,
  formatKstDateTime,
} from "@/lib/utils";
import { STAGE_LABELS as STAGE_LABELS_SHARED, STAGE_RANK, type Stage } from "@/lib/stage-meta";
import { CandidateFavoriteStar } from "@/app/components/CandidateFavoriteStar";
import { confirmDialog, notify } from "@/app/components/Dialog";
import { ScheduleProposeModal } from "@/app/components/ScheduleProposeModal";

type Confidence = "high" | "medium" | "low";

type Candidate = {
  id: number;
  jobId: number;
  name: string;
  email: string | null;
  phone: string | null;
  age: number | null;
  careerYears: number | null;
  careerSummary: string | null;
  educationLevel: string | null;
  educationSchool: string | null;
  educationMajor: string | null;
  resumeFilePath: string;
  resumeMaskedText: string | null;
  screeningScore: number | null;
  screeningReport: {
    score: number;
    recommendation: string;
    summary: string;
    strengths: string[];
    concerns: string[];
    matched_keywords: string[];
    breakdown?: {
      tech_fit?: { score: number; reason: string; confidence?: Confidence };
      experience_depth?: { score: number; reason: string; confidence?: Confidence };
      role_match?: { score: number; reason: string; confidence?: Confidence };
      achievement?: { score: number; reason: string; confidence?: Confidence };
      stability?: { score: number; reason: string; confidence?: Confidence };
      growth_attitude?: { score: number; reason: string; confidence?: Confidence };
    };
    requirement_gate?: {
      applies?: boolean;
      verdict?: "pass" | "fail" | "unknown";
      severity?: "hard" | "soft";
      missing?: string[];
      reason?: string;
    };
    requirement_coverage?: Array<{
      requirement: string;
      status: "direct" | "indirect" | "none";
      evidence?: string;
    }>;
    level_match?: {
      fit: "under" | "over" | "fit";
      years: number;
      penalty: number;
      reason: string;
    };
    interview_focus?: string[];
  } | null;
  stage: string;
  outcome: "hired" | "rejected" | "withdrawn" | null;
  outcomeReason: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  interviewEmailCount?: number;
  lastInterviewEmailSentAt?: string | null;
  decisionEmailCount?: number;
  favorited?: boolean;
};

type Job = {
  id: number;
  title: string;
  position: string;
  status?: "active" | "closed";
  closesAt?: string | null;
};

type InterviewEvaluation = {
  overall_score: number;
  recommendation: string;
  summary: string;
  scores: Record<string, { score: number; comment: string }>;
  strengths: string[];
  concerns: string[];
  followup_questions: string[];
  llm_assist_note?: string;
  ai_authorship?: {
    likelihood: "낮음" | "보통" | "높음";
    score: number;
    signals: string[];
    note: string;
  };
};

type Session = {
  id: number;
  accessToken: string;
  status: "pending" | "in_progress" | "completed" | "expired";
  messages: { role: string; content: string }[];
  evaluation: InterviewEvaluation | null;
  expiresAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

type Schedule = {
  id: number;
  round: "round1" | "round2";
  accessToken: string;
  proposedSlots: Array<{ start: string; end: string }>;
  modeOnline: boolean;
  address: string | null;
  addressDetail: string | null;
  selectedSlot: { start: string; end: string } | null;
  counterSlots: Array<{ start: string; end: string }> | null;
  candidateNote: string | null;
  status:
    | "pending"
    | "selected"
    | "counter_proposed"
    | "withdrawn"
    | "cancelled";
  onlineMeetingUrl: string | null;
  onlineMeetingNote: string | null;
  meetingLinkSentAt: string | null;
  expiresAt: string;
  respondedAt: string | null;
  createdAt: string;
};

const recColor: Record<string, string> = {
  강력추천: "bg-primary text-surface border-primary",
  비추천: "bg-danger-soft text-danger border-danger/30",
};
/** 강력추천/비추천만 노출. 중간 단계는 점수로 판단. */
const showRec = (rec: string) => rec === "강력추천" || rec === "비추천";

// Low — 후보자 이름이 비어있거나 파일명으로 폴백된 경우 "(이름 미식별)" 표시.
// PII 추출 실패의 fingerprint: 이름이 null/빈문자 또는 .pdf/.docx/.txt 등 확장자 포함.
function displayCandidateName(name: string | null | undefined): string {
  if (!name) return "(이름 미식별)";
  if (/\.(pdf|docx?|hwpx?|txt|rtf|odt)$/i.test(name.trim())) return "(이름 미식별)";
  return name;
}

// Low — 한국 휴대전화 포맷. 입력이 숫자만이면 010-XXXX-XXXX/0XX-XXX-XXXX 등 자동 표기.
// 이미 -·.·공백 포함되어 있으면 그대로 둠. 국제번호(+82) 도 그대로.
function formatPhoneKr(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  if (!trimmed) return null;
  if (/[\s\-+.]/.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("010"))
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10 && digits.startsWith("10"))
    return `0${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`;
  if (digits.length === 10 && digits.startsWith("02"))
    return `02-${digits.slice(2, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && /^01[016-9]/.test(digits))
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 9 && digits.startsWith("02"))
    return `02-${digits.slice(2, 5)}-${digits.slice(5)}`;
  return trimmed;
}

/** 점수대별 강조 색 — 점수 큰 숫자에 적용. */
function scoreColor(score: number): string {
  if (score >= 85) return "text-primary-deep";
  if (score >= 70) return "text-primary";
  if (score >= 55) return "text-warning";
  return "text-danger";
}

/** LLM 이 **단어** 로 감싼 토큰을 <strong> 으로 렌더. 마크다운은 bold 만 처리. */
function HL({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = /^\*\*([^*]+)\*\*$/.exec(p);
        if (m)
          return (
            <strong key={i} className="font-semibold text-ink">
              {m[1]}
            </strong>
          );
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

export default function CandidateDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [data, setData] = useState<{
    candidate: Candidate;
    job: Job;
    companyName?: string | null;
    sessions: Session[];
    schedules: Schedule[];
    screeningPhase: "not_started" | "in_queue" | "done" | "failed";
    rescreening?: boolean;
    screeningActive?: boolean;
  } | null>(null);
  const [loadError, setLoadError] = useState<"not_found" | "failed" | null>(null);
  const [showFullResume, setShowFullResume] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [screening, setScreening] = useState(false);
  const [screenErr, setScreenErr] = useState("");

  const load = async () => {
    try {
      const r = await fetch(`/api/candidates/${id}`);
      if (r.status === 403) {
        const d = await r.json();
        if (d.jobId) {
          router.replace(`/jobs/${d.jobId}`);
          return;
        }
      }
      if (r.status === 404) {
        setLoadError("not_found");
        return;
      }
      if (!r.ok) {
        setLoadError("failed");
        return;
      }
      setLoadError(null);
      setData(await r.json());
    } catch {
      setLoadError("failed");
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // 평가/재평가가 진행 중(큐 대기 또는 처리중)이면 완료될 때까지 폴링.
  useEffect(() => {
    if (data?.screeningPhase !== "in_queue" && !data?.rescreening) return;
    const t = setTimeout(() => void load(), 4000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.screeningPhase, data?.rescreening, data?.candidate]);

  const createLink = async () => {
    setCreating(true);
    const res = await fetch(`/api/candidates/${id}/interview-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days: 7 }),
    });
    if (!res.ok) {
      setCreating(false);
      const ct = res.headers.get("content-type") ?? "";
      const msg = ct.includes("application/json")
        ? ((await res.json().catch(() => ({}))).error ?? "발급 실패")
        : await res.text();
      notify(msg, { title: "발급 실패", tone: "danger" });
      return;
    }
    // 링크 생성 직후 후보자 이메일이 있으면 자동 발송 (UX 한 스텝 축소).
    // 발송 실패해도 링크 자체는 만들어졌으므로 사용자가 InterviewLinkBox 의
    // "재발송" 버튼으로 수동 재시도 가능.
    const session = (await res.json().catch(() => null)) as
      | { id: number }
      | null;
    const candidateEmail = data?.candidate.email ?? null;
    if (session?.id && candidateEmail) {
      try {
        await fetch(`/api/interview-sessions/${session.id}/send-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to: candidateEmail }),
        });
      } catch {
        /* 발송 실패는 silent — UI 의 재발송 버튼으로 수동 처리 */
      }
    }
    setCreating(false);
    void load();
  };

  const startScreening = async () => {
    setScreening(true);
    setScreenErr("");
    const res = await fetch(`/api/candidates/${id}/screen`, { method: "POST" });
    setScreening(false);
    if (!res.ok) {
      setScreenErr(await res.text());
      return;
    }
    void load();
    // 백그라운드 평가 진행 중 → polling
    const tick = () => {
      void (async () => {
        const r = await fetch(`/api/candidates/${id}`);
        if (!r.ok) return;
        const d = await r.json();
        setData(d);
        if (d.screeningPhase === "in_queue") setTimeout(tick, 4000);
      })();
    };
    setTimeout(tick, 4000);
  };

  const handleDelete = async () => {
    if (
      !(await confirmDialog("후보자와 면접 기록을 모두 삭제합니다. 진행할까요?", {
        title: "후보자 삭제",
        tone: "danger",
        confirmText: "삭제",
      }))
    )
      return;
    const res = await fetch(`/api/candidates/${id}`, { method: "DELETE" });
    if (res.ok) router.push(`/jobs/${data!.job.id}`);
  };

  if (!data) {
    if (loadError === "not_found")
      return (
        <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-center">
            <div className="text-slate-700 font-medium">삭제된 후보자입니다.</div>
            <div className="mt-1 text-sm text-slate-500">
              이 후보자는 더 이상 존재하지 않습니다.
            </div>
            <button
              onClick={() => router.back()}
              className="mt-4 px-4 py-2 rounded-lg border border-slate-300 text-sm hover:bg-slate-50"
            >
              뒤로 가기
            </button>
          </div>
        </main>
      );
    if (loadError === "failed")
      return (
        <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-6 text-center">
            <div className="text-rose-700 font-medium">불러오기에 실패했습니다.</div>
            <div className="mt-1 text-sm text-rose-600">
              네트워크 상태를 확인하고 다시 시도해 주세요.
            </div>
            <button
              onClick={() => {
                setLoadError(null);
                void load();
              }}
              className="mt-4 px-4 py-2 rounded-lg border border-rose-300 text-sm text-rose-700 hover:bg-rose-100"
            >
              다시 시도
            </button>
          </div>
        </main>
      );
    return (
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8 text-slate-500">
        불러오는 중...
      </main>
    );
  }

  const { candidate, job, companyName, sessions, schedules, screeningPhase } = data;

  // 공고가 만료(closesAt 지났고 active) 상태면 후보자 상세 진입 차단.
  // 목록 페이지에서의 일괄 합/불 결정·삭제는 가능하지만 상세 페이지에서의 단일 액션은 잠금.
  const jobExpired =
    job.status === "active" &&
    !!job.closesAt &&
    new Date(job.closesAt).getTime() < Date.now();
  if (jobExpired) {
    return (
      <main className="max-w-md mx-auto w-full px-6 py-12">
        <div className="bg-card border border-warning/30 rounded-2xl p-8 text-center shadow-sm">
          <div className="text-4xl mb-3">⏰</div>
          <h1 className="text-base font-bold text-ink mb-2">
            공고 종결일이 지났습니다
          </h1>
          <p className="text-xs text-ink-soft leading-relaxed mb-5">
            만료된 공고의 후보자 상세 보기는 잠겨 있습니다.<br />
            공고를 연장 또는 종결한 뒤 다시 확인해 주세요.<br />
            <span className="text-ink-muted">
              (목록에서 일괄 합/불 결정·삭제는 가능합니다)
            </span>
          </p>
          <Link
            href={`/jobs/${job.id}`}
            className="inline-block px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-surface text-sm font-medium transition-colors"
          >
            공고로 돌아가기
          </Link>
        </div>
      </main>
    );
  }

  const activeSession = sessions[0] ?? null;
  // AI 면접 전형이 지났는지 — 종결됐거나 1차 면접 이상 단계로 진행된 경우.
  // 이 경우 AI 면접 링크 생성/재발송 차단 (스킵된 전형 재개 방지).
  const aiStagePassed =
    !!candidate.outcome ||
    STAGE_RANK[candidate.stage as Stage] > STAGE_RANK.ai_evaluated;
  // active 일정이 여러 개(예: 1차 selected + 2차 pending)면 가장 최근(id 큰) 것을 표시.
  const activeSchedule =
    (schedules ?? [])
      .filter(
        (s) =>
          s.status === "selected" ||
          s.status === "pending" ||
          s.status === "counter_proposed"
      )
      .sort((a, b) => b.id - a.id)[0] ?? null;
  const completedSession = sessions.find((s) => s.status === "completed");
  const interviewScore = completedSession?.evaluation?.overall_score ?? null;
  const composite = compositeScore(candidate.screeningScore, interviewScore);
  const rec = composite != null ? recommendationFromScore(composite) : null;

  return (
    <main className="max-w-4xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      <Link
        href={`/jobs/${job.id}`}
        className="text-sm text-slate-500 hover:text-slate-900"
      >
        ← {job.title}
      </Link>

      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 mt-3 shadow-sm">
        <div className="flex justify-between items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-slate-900">
                {displayCandidateName(candidate.name)}
              </h1>
              {candidate.outcome !== "hired" && <StageBadge stage={candidate.stage} />}
              {candidate.outcome && <OutcomeBadge outcome={candidate.outcome} reason={candidate.outcomeReason} />}
              <EmailSentBadge sentAt={candidate.lastInterviewEmailSentAt} />
              <EditCandidateButton candidate={candidate} onSaved={load} />
            </div>
            {/* 이메일은 길어 잘리기 쉬워 2배 폭 할당. 나이·경력은 짧은 텍스트라 auto.
                모바일은 2열로 wrap. */}
            <div className="grid grid-cols-2 sm:grid-cols-[1fr_2fr_auto_auto] gap-x-4 gap-y-3 mt-4">
              <InfoCell label="연락처" value={formatPhoneKr(candidate.phone)} />
              <InfoCell label="이메일" value={candidate.email} />
              <InfoCell
                label="나이"
                value={candidate.age != null ? `${candidate.age}세` : null}
              />
              <InfoCell
                label="경력"
                value={
                  candidate.careerYears != null
                    ? `${candidate.careerYears}년`
                    : null
                }
              />
              <InfoCell
                label="최종학력"
                value={
                  candidate.educationLevel ||
                  candidate.educationSchool ||
                  candidate.educationMajor
                    ? [
                        candidate.educationSchool,
                        candidate.educationMajor,
                        candidate.educationLevel,
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : null
                }
              />
            </div>
            {candidate.careerSummary && (
              <div className="mt-3 text-sm text-slate-600 border-l-2 border-slate-200 pl-3">
                {candidate.careerSummary}
              </div>
            )}
            <div className="text-xs text-slate-400 mt-4">
              {formatKstDateTime(candidate.createdAt)} 업로드
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <CandidateFavoriteStar
              candidateId={candidate.id}
              initial={candidate.favorited ?? false}
              size="md"
              onToggle={() => void load()}
            />
            <button
              onClick={handleDelete}
              className="px-2 py-1.5 rounded-lg text-ink-muted hover:text-danger hover:bg-danger-soft text-xs transition-colors"
              title="후보자 삭제"
              aria-label="후보자 삭제"
            >
              🗑 삭제
            </button>
          </div>
        </div>
        <StagePanel
          candidate={candidate}
          jobTitle={job.title}
          companyName={companyName ?? null}
          onChanged={() => void load()}
          showFullResume={showFullResume}
          setShowFullResume={setShowFullResume}
          rescreening={!!data.rescreening}
          screeningPhase={data.screeningPhase}
          screeningActive={!!data.screeningActive}
        />
      </div>

      {/* Composite */}
      <Section
        title="종합 점수"
        collapsible={false}
        summary={
          composite != null ? (
            <span className="flex items-center gap-2">
              <span className={`font-bold tabular-nums ${scoreColor(composite)}`}>
                {composite}
              </span>
              <span className="text-slate-400">/100</span>
              {rec && showRec(rec) && (
                <span
                  className={`text-[11px] font-semibold px-2 py-0.5 rounded-md border ${recColor[rec]}`}
                >
                  {rec}
                </span>
              )}
              <span className="text-slate-400">
                · 서류 {candidate.screeningScore ?? "-"} / 면접 {interviewScore ?? "-"}
              </span>
            </span>
          ) : (
            <span className="text-slate-400">평가 미완료</span>
          )
        }
      >
        <div className="flex items-center gap-6 flex-wrap">
          <div>
            <div className="text-xs text-slate-500">종합</div>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-4xl font-bold text-slate-900">
                {composite != null ? composite : "-"}
              </span>
              <span className="text-sm text-slate-400">/ 100</span>
            </div>
            {rec && showRec(rec) && (
              <span
                className={`inline-block mt-2 text-xs font-medium px-2 py-0.5 rounded-md border ${recColor[rec]}`}
              >
                {rec}
              </span>
            )}
          </div>
          <div className="flex-1 space-y-2 min-w-[240px]">
            <ScoreBar label="서류" score={candidate.screeningScore} />
            <ScoreBar label="면접" score={interviewScore} />
          </div>
        </div>
      </Section>

      {/* Screening */}
      <Section
        title="서류 평가"
        defaultOpen={false}
        summary={
          candidate.screeningScore != null ? (
            <span className="flex items-center gap-2">
              <span className={`font-bold tabular-nums ${scoreColor(candidate.screeningScore)}`}>
                {candidate.screeningScore}
              </span>
              <span className="text-slate-400">/100</span>
              {candidate.screeningReport?.recommendation &&
                showRec(candidate.screeningReport.recommendation) && (
                  <span
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded-md border ${recColor[candidate.screeningReport.recommendation]}`}
                  >
                    {candidate.screeningReport.recommendation}
                  </span>
                )}
              {candidate.screeningReport?.summary && (
                <span className="text-slate-500 truncate">
                  · {candidate.screeningReport.summary}
                </span>
              )}
            </span>
          ) : screeningPhase === "in_queue" ? (
            <span className="text-blue-600">⏳ 평가 진행 중</span>
          ) : screeningPhase === "failed" ? (
            <span className="text-danger">평가 실패</span>
          ) : (
            <span className="text-slate-400">평가 전</span>
          )
        }
      >
        {screeningPhase === "not_started" ? (
          <div className="space-y-4">
            <div className="text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3">
              <strong>AI 평가가 시작되지 않았습니다.</strong> 보통 업로드 직후 자동으로 시작됩니다.
              잔액이 부족하거나 마스킹 텍스트가 없으면 여기 멈춥니다.
              아래 마스킹을 확인 후 "AI 검토 요청"으로 수동 시작할 수 있습니다.
            </div>

            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                마스킹된 텍스트 (LLM 입력)
              </div>
              <pre className="p-3 border rounded-lg text-xs whitespace-pre-wrap max-h-[60vh] overflow-y-auto font-mono bg-slate-50 border-slate-200 text-slate-700">
                {candidate.resumeMaskedText ?? ""}
              </pre>
              <div className="text-xs text-slate-400 mt-1">
                마스킹 {(candidate.resumeMaskedText ?? "").length.toLocaleString()}자
                {!candidate.resumeMaskedText && (
                  <span className="ml-2 text-amber-600">
                    ⚠️ 마스킹 데이터 없음 (재업로드 필요)
                  </span>
                )}
              </div>
            </div>

            {screenErr && (
              <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2">
                {screenErr}
              </div>
            )}
            <button
              onClick={startScreening}
              disabled={screening}
              className="px-5 py-2 rounded-lg bg-primary hover:bg-primary-deep text-white text-sm font-medium disabled:opacity-50 shadow-sm"
            >
              {screening ? "요청 중..." : "AI 검토 요청"}
            </button>
          </div>
        ) : screeningPhase === "in_queue" ? (
          <div className="flex items-center gap-2 text-sm text-primary-deep">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            AI 평가 진행 중...
          </div>
        ) : screeningPhase === "failed" ? (
          <div className="text-sm text-danger">
            서류 평가 실패. 아래 🔄 재평가 버튼으로 다시 시도하거나 이력서를 재업로드하세요.
          </div>
        ) : candidate.screeningReport ? (
          <div className="space-y-4 text-sm">
            <div className="flex items-baseline gap-3">
              <div
                className={`text-5xl font-bold tabular-nums ${scoreColor(
                  candidate.screeningReport.score
                )}`}
              >
                {candidate.screeningReport.score}
              </div>
              <span className="text-base text-slate-400 font-medium">/ 100</span>
              {showRec(candidate.screeningReport.recommendation) && (
                <span
                  className={`ml-auto text-xs font-semibold px-2.5 py-1 rounded-md border ${recColor[candidate.screeningReport.recommendation]}`}
                >
                  {candidate.screeningReport.recommendation}
                </span>
              )}
            </div>
            <blockquote className="border-l-4 border-primary/40 bg-primary-soft/30 px-4 py-3 rounded-r-lg text-slate-800 leading-relaxed">
              <HL text={candidate.screeningReport.summary} />
            </blockquote>
            {candidate.screeningReport.requirement_gate && (
              <RequirementGateBadge
                gate={candidate.screeningReport.requirement_gate}
              />
            )}
            {candidate.screeningReport.level_match &&
              candidate.screeningReport.level_match.fit !== "fit" && (
                <LevelMatchBadge match={candidate.screeningReport.level_match} />
              )}
            {candidate.screeningReport.breakdown && (
              <BreakdownBlock breakdown={candidate.screeningReport.breakdown} />
            )}
            {candidate.screeningReport.requirement_coverage &&
              candidate.screeningReport.requirement_coverage.length > 0 && (
                <RequirementCoverageBlock
                  coverage={candidate.screeningReport.requirement_coverage}
                />
              )}
            <BulletBlock
              title="강점"
              items={candidate.screeningReport.strengths}
              color="emerald"
            />
            <BulletBlock
              title="우려"
              items={candidate.screeningReport.concerns}
              color="amber"
            />
            {candidate.screeningReport.interview_focus &&
              candidate.screeningReport.interview_focus.length > 0 && (
                <BulletBlock
                  title="🎯 면접에서 확인할 주제 (우선순위 1)"
                  items={candidate.screeningReport.interview_focus}
                  color="blue"
                  emphasis
                />
              )}
            <div>
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                매칭 키워드
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {candidate.screeningReport.matched_keywords.map((k) => (
                  <span
                    key={k}
                    className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded-md"
                  >
                    {k}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-slate-500">평가 데이터 없음</div>
        )}
      </Section>

      {/* Interview */}
      <Section
        title="AI 면접"
        defaultOpen={false}
        summary={(() => {
          const latest = sessions[0];
          if (!latest) return <span className="text-slate-400">세션 없음</span>;
          if (latest.status === "completed") {
            const score = latest.evaluation?.overall_score;
            const rec = latest.evaluation?.recommendation;
            return (
              <span className="flex items-center gap-2">
                {score != null ? (
                  <>
                    <span className={`font-bold tabular-nums ${scoreColor(score)}`}>
                      {score}
                    </span>
                    <span className="text-slate-400">/100</span>
                  </>
                ) : (
                  <span className="text-slate-500">완료</span>
                )}
                {rec && showRec(rec) && (
                  <span
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded-md border ${recColor[rec]}`}
                  >
                    {rec}
                  </span>
                )}
                {latest.evaluation?.summary && (
                  <span className="text-slate-500 truncate">
                    · {latest.evaluation.summary}
                  </span>
                )}
              </span>
            );
          }
          if (latest.status === "in_progress")
            return <span className="text-blue-600">🟢 면접 진행 중</span>;
          if (latest.status === "pending")
            return <span className="text-amber-600">⏳ 후보자 응답 대기</span>;
          if (latest.status === "expired")
            return <span className="text-slate-400">만료</span>;
          return null;
        })()}
      >
        {!activeSession && (
          <div className="text-center py-8">
            <div className="text-3xl mb-3">💬</div>
            {aiStagePassed ? (
              <p className="text-sm text-slate-500">
                AI 면접 전형이 종료되었습니다. 이미 다음 전형으로 진행된
                후보자에게는 AI 면접 링크를 생성할 수 없습니다.
              </p>
            ) : candidate.screeningReport ? (
              <>
                <p className="text-sm text-slate-600 mb-4">
                  아직 면접이 진행되지 않았습니다.
                </p>
                <button
                  onClick={createLink}
                  disabled={creating}
                  className="px-5 py-2 rounded-lg bg-primary hover:bg-primary-deep text-white text-sm font-medium disabled:opacity-50 shadow-sm"
                >
                  {creating ? "처리 중..." : "AI면접 요청"}
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-slate-600 mb-2">
                  AI 서류평가가 완료되어야 면접 링크를 생성할 수 있습니다.
                </p>
                <p className="text-xs text-slate-500 mb-4">
                  {screeningPhase === "in_queue"
                    ? "현재 서류평가가 진행 중입니다. 잠시만 기다려 주세요."
                    : screeningPhase === "failed"
                    ? "서류평가가 실패했습니다. 위에서 평가를 재시도해 주세요."
                    : "위에서 AI 서류평가를 먼저 실행해 주세요."}
                </p>
                <button
                  disabled
                  className="px-5 py-2 rounded-lg bg-slate-200 text-slate-400 text-sm font-medium cursor-not-allowed"
                  title="AI 서류평가 후 활성화됩니다"
                >
                  AI면접 요청
                </button>
              </>
            )}
          </div>
        )}
        {activeSession && activeSession.status !== "completed" && (
          <InterviewLinkBox
            session={activeSession}
            candidateEmail={candidate.email}
            onRegenerate={createLink}
            disabled={aiStagePassed}
          />
        )}
        {completedSession && completedSession.evaluation && (
          <InterviewResult
            session={completedSession}
            onShowTranscript={() => setShowTranscript(true)}
            onRegenerate={createLink}
            disabled={aiStagePassed}
          />
        )}
        {completedSession && !completedSession.evaluation && (
          <InterviewEvaluationRetry
            sessionId={completedSession.id}
            onShowTranscript={() => setShowTranscript(true)}
            onSuccess={load}
          />
        )}
      </Section>

      {activeSchedule && (
        <Section
          title={`${activeSchedule.round === "round2" ? "2차" : "1차"} 면접 일정`}
          collapsible={false}
          summary={
            activeSchedule.status === "selected" && activeSchedule.selectedSlot ? (
              <span className="flex items-center gap-2">
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-primary-soft text-primary-deep border border-primary/30">
                  확정
                </span>
                <span className="text-slate-700">
                  {formatKstDateTime(activeSchedule.selectedSlot.start)}
                </span>
                <span className="text-slate-400">
                  · {activeSchedule.modeOnline ? "온라인" : "오프라인"}
                </span>
              </span>
            ) : activeSchedule.status === "counter_proposed" ? (
              <span className="text-amber-600">🔄 후보자 대안 일정 제안</span>
            ) : (
              <span className="text-amber-600">⏳ 후보자 응답 대기</span>
            )
          }
        >
          <ScheduleBox
            schedule={activeSchedule}
            jobId={candidate.jobId}
            onChanged={load}
          />
        </Section>
      )}

      <InterviewQuestionsPanel candidateId={candidate.id} />
      <AttachmentsPanel candidateId={candidate.id} />
      <InterviewerNotesPanel candidateId={candidate.id} currentStage={candidate.stage} />
      <AppealsPanel candidateId={candidate.id} />

      {showTranscript && completedSession && (
        <TranscriptModal
          messages={completedSession.messages}
          onClose={() => setShowTranscript(false)}
        />
      )}
    </main>
  );
}

function InfoCell({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-slate-500 uppercase tracking-wider">
        {label}
      </div>
      <div
        className="text-sm font-medium text-slate-900 mt-0.5 truncate"
        title={value ?? undefined}
      >
        {value ?? <span className="text-slate-300">-</span>}
      </div>
    </div>
  );
}

type Attachment = {
  id: number;
  kind: "resume" | "career_history" | "portfolio" | "cover_letter" | "other";
  originalName: string;
  mime: string | null;
  sizeBytes: number;
  createdAt: string;
};

// ── 1차 대면 면접 질문지 ──────────────────────────────────────────
// 1차 면접 일정 확정 후 면접관 누구나 생성. 이후 팝업으로 열람.
type QuestionSheet = {
  strategy: string;
  sections: Array<{
    title: string;
    focus: string;
    questions: Array<{
      question: string;
      intent: string;
      followups?: string[];
      basis?: string;
    }>;
  }>;
  red_flags?: string[];
};
type QuestionSheetResp = {
  scheduleConfirmed: boolean;
  sheet: {
    questions: QuestionSheet;
    basedOnScreening: boolean;
    basedOnInterview: boolean;
    generatedByName: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
};

function InterviewQuestionsPanel({ candidateId }: { candidateId: number }) {
  const [data, setData] = useState<QuestionSheetResp | null>(null);
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = async () => {
    const r = await fetch(`/api/candidates/${candidateId}/interview-questions`);
    if (r.ok) setData(await r.json());
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateId]);

  const generate = async () => {
    setGenerating(true);
    setErr(null);
    try {
      const r = await fetch(
        `/api/candidates/${candidateId}/interview-questions`,
        { method: "POST" }
      );
      if (!r.ok) {
        setErr(await r.text());
        return;
      }
      const body = (await r.json()) as { sheet: QuestionSheetResp["sheet"] };
      setData((prev) => ({
        scheduleConfirmed: prev?.scheduleConfirmed ?? true,
        sheet: body.sheet,
      }));
      setOpen(true);
    } catch {
      setErr("네트워크 오류가 발생했습니다.");
    } finally {
      setGenerating(false);
    }
  };

  const sheet = data?.sheet ?? null;
  const confirmed = data?.scheduleConfirmed ?? false;

  return (
    <Section
      title="면접 문제 (1차)"
      defaultOpen={false}
      summary={
        sheet ? (
          <span className="text-primary-deep">생성됨 · 클릭하여 열람</span>
        ) : confirmed ? (
          <span className="text-slate-500">생성 가능</span>
        ) : (
          <span className="text-slate-400">1차 일정 확정 후 활성화</span>
        )
      }
    >
      {!confirmed && !sheet && (
        <div className="text-center py-6">
          <div className="text-3xl mb-3">📝</div>
          <p className="text-sm text-slate-600 mb-1">
            1차 면접 일정이 확정되면 면접 문제를 생성할 수 있습니다.
          </p>
          <p className="text-xs text-slate-500">
            이력서 · 서류평가 · AI 면접 평가를 종합해 맞춤 질문지를 만듭니다.
          </p>
        </div>
      )}

      {(confirmed || sheet) && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            이력서 · 서류평가 · AI 면접 평가를 종합해 1차 대면 면접용 맞춤
            질문지를 생성합니다. 면접관 누구나 생성·열람할 수 있습니다.
          </p>

          {sheet && (
            <div className="flex items-center gap-2 flex-wrap text-[11px]">
              <span className="px-2 py-0.5 rounded-md border bg-primary-soft text-primary-deep border-primary/30">
                {sheet.basedOnScreening ? "서류평가 반영" : "서류평가 없음"}
              </span>
              <span className="px-2 py-0.5 rounded-md border bg-accent-soft text-accent-deep border-accent/30">
                {sheet.basedOnInterview ? "AI면접 평가 반영" : "AI면접 평가 없음"}
              </span>
              <span className="text-slate-400">
                {sheet.generatedByName ? `${sheet.generatedByName} · ` : ""}
                {formatKstDateTime(sheet.updatedAt)} 생성
              </span>
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            {sheet && (
              <button
                onClick={() => setOpen(true)}
                className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-white text-sm font-medium shadow-sm"
              >
                면접 문제 보기
              </button>
            )}
            <button
              onClick={generate}
              disabled={generating}
              className={`px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 ${
                sheet
                  ? "border border-slate-300 text-slate-700 hover:bg-slate-50"
                  : "bg-primary hover:bg-primary-deep text-white shadow-sm"
              }`}
            >
              {generating
                ? "생성 중... (최대 1분)"
                : sheet
                  ? "다시 생성"
                  : "면접 문제 생성"}
            </button>
          </div>

          {err && <p className="text-sm text-danger">{err}</p>}
        </div>
      )}

      {open && sheet && (
        <QuestionSheetModal
          sheet={sheet.questions}
          onClose={() => setOpen(false)}
        />
      )}
    </Section>
  );
}

function QuestionSheetModal({
  sheet,
  onClose,
}: {
  sheet: QuestionSheet;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 flex items-start justify-center overflow-y-auto p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl max-w-2xl w-full my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-100 sticky top-0 bg-white rounded-t-2xl">
          <h3 className="text-base font-bold text-slate-900">
            1차 면접 질문지
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-xl leading-none"
            aria-label="닫기"
          >
            ×
          </button>
        </div>
        <div className="px-6 py-5 space-y-6">
          {sheet.strategy && (
            <div className="border-l-4 border-primary/40 bg-primary-soft/30 px-4 py-3 rounded-r-lg text-sm text-slate-800 leading-relaxed">
              <div className="text-[11px] font-semibold text-primary-deep uppercase tracking-wider mb-1">
                면접 전략
              </div>
              <HL text={sheet.strategy} />
            </div>
          )}

          {sheet.sections.map((sec, si) => (
            <div key={si}>
              <h4 className="text-sm font-bold text-slate-900">
                {si + 1}. {sec.title}
              </h4>
              {sec.focus && (
                <p className="text-xs text-slate-500 mt-0.5 mb-3">
                  <HL text={sec.focus} />
                </p>
              )}
              <ol className="space-y-3">
                {sec.questions.map((q, qi) => (
                  <li
                    key={qi}
                    className="rounded-lg border border-slate-200 px-4 py-3"
                  >
                    <p className="text-sm text-slate-800 font-medium">
                      <HL text={q.question} />
                    </p>
                    {q.intent && (
                      <p className="text-xs text-slate-500 mt-1.5">
                        🎯 <HL text={q.intent} />
                      </p>
                    )}
                    {q.followups && q.followups.length > 0 && (
                      <ul className="mt-2 space-y-1 pl-3 border-l-2 border-slate-100">
                        {q.followups.map((f, fi) => (
                          <li key={fi} className="text-xs text-slate-600">
                            ↳ <HL text={f} />
                          </li>
                        ))}
                      </ul>
                    )}
                    {q.basis && (
                      <p className="text-[11px] text-slate-400 mt-2">
                        근거: {q.basis}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          ))}

          {sheet.red_flags && sheet.red_flags.length > 0 && (
            <div className="rounded-lg border border-danger/30 bg-danger-soft/40 px-4 py-3">
              <div className="text-[11px] font-semibold text-danger uppercase tracking-wider mb-2">
                반드시 확인할 우려 신호
              </div>
              <ul className="space-y-1">
                {sheet.red_flags.map((r, ri) => (
                  <li key={ri} className="text-sm text-slate-700">
                    ⚠️ <HL text={r} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AttachmentsPanel({ candidateId }: { candidateId: number }) {
  const [list, setList] = useState<Attachment[] | null>(null);
  useEffect(() => {
    void fetch(`/api/candidates/${candidateId}/attachments`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setList(d as Attachment[]));
  }, [candidateId]);

  if (list == null) return null;

  // 메인 이력서는 별도 섹션에서 노출되므로 첨부 패널엔 제외
  const extras = list.filter((a) => a.kind !== "resume");
  if (extras.length === 0) return null;

  const kindLabel = {
    career_history: "경력기술서",
    portfolio: "포트폴리오",
    cover_letter: "자기소개서",
    other: "기타",
  } as const;
  const kindColor = {
    career_history: "bg-primary-soft text-primary-deep border-primary/40",
    portfolio: "bg-accent-soft text-accent-deep border-accent/40",
    cover_letter: "bg-info-soft text-info border-info/30",
    other: "bg-surface-alt text-ink-soft border-border-default",
  } as const;

  return (
    <Section title="첨부 파일" collapsible={false}>
      <p className="text-xs text-slate-500 mb-3">
        업로드 시 함께 올라온 경력기술서·자기소개서·포트폴리오 등. 텍스트 추출이 가능한 문서(경력기술서·자기소개서 등)는 AI 서류평가에 함께 반영되며, 이미지 등 추출 불가 파일은 사람 면접관 참고용입니다.
      </p>
      <ul className="space-y-2">
        {extras.map((a) => {
          const k = a.kind as
            | "career_history"
            | "portfolio"
            | "cover_letter"
            | "other";
          return (
            <li
              key={a.id}
              className="flex items-center justify-between gap-3 px-3 py-2 border border-slate-200 rounded-lg hover:bg-slate-50"
            >
              <div className="min-w-0 flex items-center gap-2">
                <span
                  className={`text-[10px] font-medium px-2 py-0.5 rounded-md border ${kindColor[k]}`}
                >
                  {kindLabel[k]}
                </span>
                <a
                  href={`/api/uploads/candidate/${candidateId}/attachment/${a.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline truncate"
                  title={a.originalName}
                >
                  📎 {a.originalName}
                </a>
              </div>
              <span className="text-[11px] text-slate-400 shrink-0">
                {formatBytes(a.sizeBytes)}
              </span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}

function Section({
  title,
  children,
  defaultOpen = true,
  summary,
  collapsible = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  summary?: React.ReactNode;
  collapsible?: boolean;
}) {
  const storageKey = `cand-section:${title}`;
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    if (!collapsible) return;
    if (typeof window === "undefined") return;
    const v = window.localStorage.getItem(storageKey);
    if (v === "0") setOpen(false);
    else if (v === "1") setOpen(true);
  }, [storageKey, collapsible]);
  const toggle = () => {
    if (!collapsible) return;
    setOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        /* private mode 등 */
      }
      return next;
    });
  };
  return (
    <section className="mt-4">
      <div
        className={`bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden transition-shadow ${open ? "" : "hover:shadow-md"}`}
      >
        <button
          type="button"
          onClick={toggle}
          disabled={!collapsible}
          aria-expanded={open}
          className={`w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left ${collapsible ? "hover:bg-slate-50 cursor-pointer" : "cursor-default"} transition-colors`}
        >
          <span className="flex items-center gap-3 min-w-0 flex-1">
            <span className="text-sm font-bold text-slate-900 shrink-0">
              {title}
            </span>
            {summary && (
              <span className="text-xs text-slate-500 truncate">{summary}</span>
            )}
          </span>
          {collapsible && (
            <span
              className={`text-slate-400 text-xs transition-transform shrink-0 ${open ? "rotate-90" : ""}`}
              aria-hidden
            >
              ▶
            </span>
          )}
        </button>
        {open && (
          <div className="border-t border-slate-100 px-6 py-5">{children}</div>
        )}
      </div>
    </section>
  );
}

function LevelMatchBadge({
  match,
}: {
  match: NonNullable<NonNullable<Candidate["screeningReport"]>["level_match"]>;
}) {
  const label =
    match.fit === "over"
      ? "오버스펙 — 직급 미스매치"
      : "언더스펙 — 직급 미스매치";
  return (
    <div className="border border-warning/40 bg-warning-soft/60 rounded-lg px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold text-warning">{label}</span>
        <span className="text-xs text-warning tabular-nums">
          후보자 {match.years}년 · 점수 보정 {match.penalty}점
        </span>
      </div>
      {match.reason && (
        <p className="text-xs text-slate-700 mt-1 leading-snug">
          {match.reason}
        </p>
      )}
    </div>
  );
}

function RequirementGateBadge({
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
            <li key={i} className="text-xs text-slate-700 leading-snug">
              · {m}
            </li>
          ))}
        </ul>
      )}
      {gate.reason && (
        <p className="text-xs text-slate-600 mt-1 leading-snug">{gate.reason}</p>
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

function RequirementCoverageBlock({
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
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
        JD 요건별 충족
      </div>

      {/* 상단 요약 — 링 게이지(전체 충족도) + 상태별 개수 범례 */}
      <div className="flex items-center gap-4">
        <CoverageRing pct={fitPct} />
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {COVERAGE_ORDER.map((s) => (
            <span
              key={s}
              className="flex items-center gap-1.5 text-xs text-slate-500"
            >
              <span className={`w-2.5 h-2.5 rounded-sm ${COVERAGE_META[s].bar}`} />
              {COVERAGE_META[s].label}
              <span className="tabular-nums font-semibold text-slate-700">
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
              className={`flex items-start gap-2.5 rounded-md border border-slate-100 border-l-[3px] ${m.accent} ${m.row} px-3 py-2`}
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
                    dim ? "text-slate-500" : "text-slate-800 font-medium"
                  }`}
                >
                  {c.requirement}
                </div>
                {c.evidence ? (
                  <div className="text-[11px] text-slate-500 leading-snug mt-0.5">
                    {c.evidence}
                  </div>
                ) : (
                  dim && (
                    <div className="text-[11px] text-slate-400 leading-snug mt-0.5 italic">
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

const SCHEDULE_STATUS_LABEL: Record<Schedule["status"], string> = {
  pending: "후보자 응답 대기",
  selected: "확정",
  counter_proposed: "후보자 역제시",
  withdrawn: "지원 취소",
  cancelled: "취소됨",
};
const SCHEDULE_STATUS_COLOR: Record<Schedule["status"], string> = {
  pending: "bg-warning-soft text-warning border-warning/30",
  selected: "bg-primary-soft text-primary-deep border-primary/30",
  counter_proposed: "bg-warning-soft text-warning border-warning/30",
  withdrawn: "bg-slate-100 text-slate-500 border-slate-200",
  cancelled: "bg-slate-100 text-slate-500 border-slate-200",
};

function formatSlot(s: { start: string; end: string }): string {
  const start = formatKstDateTime(s.start);
  const e = new Date(s.end);
  const eh = e.getHours().toString().padStart(2, "0");
  const em = e.getMinutes().toString().padStart(2, "0");
  return `${start} ~ ${eh}:${em}`;
}

function ScheduleBox({
  schedule,
  jobId,
  onChanged,
}: {
  schedule: Schedule;
  jobId: number;
  onChanged: () => void;
}) {
  const selected = schedule.selectedSlot;
  const [confirming, setConfirming] = useState<string | null>(null); // 진행 중인 slot 의 start
  const [confirmErr, setConfirmErr] = useState<string | null>(null);

  // 후보자가 counter 제시한(또는 HR 가 처음 제시한) 슬롯을 확정.
  const confirmSlot = async (slot: { start: string; end: string }) => {
    if (
      !(await confirmDialog(
        `${formatSlot(slot)} 으로 확정하시겠습니까?\n후보자와 면접관에게 확정 메일이 발송됩니다.`,
        { title: "일정 확정", confirmText: "확정" }
      ))
    )
      return;
    setConfirming(slot.start);
    setConfirmErr(null);
    try {
      const r = await fetch(`/api/schedules/${schedule.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot }),
      });
      if (!r.ok) {
        setConfirmErr(await r.text());
        return;
      }
      onChanged();
    } finally {
      setConfirming(null);
    }
  };

  const canConfirm =
    schedule.status === "counter_proposed" || schedule.status === "pending";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span
          className={`text-xs px-2 py-0.5 rounded-full border ${SCHEDULE_STATUS_COLOR[schedule.status]}`}
        >
          {SCHEDULE_STATUS_LABEL[schedule.status]}
        </span>
        <span className="text-xs text-slate-500">
          {schedule.round === "round1" ? "1차" : "2차"} 면접
        </span>
      </div>

      {selected ? (
        <div className="bg-primary-soft/50 border border-primary/20 rounded-xl p-4">
          <div className="text-xs text-primary-deep font-semibold mb-1">
            확정 일시
          </div>
          <div className="text-base font-semibold text-slate-900">
            {formatSlot(selected)}
          </div>
        </div>
      ) : (
        <div>
          <div className="text-xs font-semibold text-slate-500 mb-2">
            제시된 시간
          </div>
          <ul className="text-sm text-slate-700 space-y-1">
            {schedule.proposedSlots.map((s, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-2"
              >
                <span>· {formatSlot(s)}</span>
                {canConfirm && (
                  <button
                    onClick={() => void confirmSlot(s)}
                    disabled={confirming !== null}
                    className="text-[11px] px-2 py-0.5 rounded-md border border-primary/40 text-primary-deep hover:bg-primary-soft disabled:opacity-50"
                  >
                    {confirming === s.start ? "확정 중..." : "이 시간으로 확정"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {schedule.counterSlots && schedule.counterSlots.length > 0 && !selected && (
        <div>
          <div className="text-xs font-semibold text-warning mb-2">
            후보자 역제시
          </div>
          <ul className="text-sm text-slate-700 space-y-1">
            {schedule.counterSlots.map((s, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span>· {formatSlot(s)}</span>
                {canConfirm && (
                  <button
                    onClick={() => void confirmSlot(s)}
                    disabled={confirming !== null}
                    className="text-[11px] px-2 py-0.5 rounded-md bg-primary text-surface hover:bg-primary-deep disabled:opacity-50"
                  >
                    {confirming === s.start ? "확정 중..." : "이 시간으로 확정"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {confirmErr && (
        <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2">
          {confirmErr}
        </div>
      )}

      {canConfirm && (
        <div className="text-[11px] text-slate-500 pt-1">
          위 시간이 모두 안 맞으면{" "}
          <Link
            href={`/jobs/${jobId}`}
            className="text-primary-deep hover:underline font-medium"
          >
            공고 페이지에서 새 시간 다시 제시
          </Link>
          하세요.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
        <div>
          <div className="text-xs text-slate-500">방식</div>
          <div className="text-slate-900">
            {schedule.modeOnline ? "온라인" : "오프라인"}
          </div>
        </div>
        {!schedule.modeOnline && schedule.address && (
          <div className="sm:col-span-2">
            <div className="text-xs text-slate-500">주소</div>
            <div className="text-slate-900">
              {schedule.address}
              {schedule.addressDetail ? ` ${schedule.addressDetail}` : ""}
            </div>
          </div>
        )}
      </div>

      {schedule.modeOnline && schedule.status === "selected" && (
        <MeetingLinkPanel schedule={schedule} onChanged={onChanged} />
      )}

      {schedule.candidateNote && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
          <div className="text-xs text-slate-500 mb-1">후보자 메모</div>
          <div className="text-sm text-slate-700 whitespace-pre-wrap">
            {schedule.candidateNote}
          </div>
        </div>
      )}

      <div className="text-xs text-slate-400">
        {schedule.respondedAt
          ? `후보자 응답: ${formatKstDateTime(schedule.respondedAt)}`
          : `링크 만료: ${formatKstDateTime(schedule.expiresAt)}`}
      </div>
    </div>
  );
}

function MeetingLinkPanel({
  schedule,
  onChanged,
}: {
  schedule: Schedule;
  onChanged: () => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [url, setUrl] = useState(schedule.onlineMeetingUrl ?? "");
  const [note, setNote] = useState(schedule.onlineMeetingNote ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const hasLink = !!schedule.onlineMeetingUrl;

  const submit = async () => {
    const trimmed = url.trim();
    if (!trimmed.startsWith("https://")) {
      setErr("미팅 링크는 https:// 로 시작해야 합니다.");
      return;
    }
    if (trimmed.length > 100) {
      setErr("100자 이내로 입력해 주세요.");
      return;
    }
    if (/\s/.test(trimmed)) {
      setErr("URL 에 공백이 있습니다.");
      return;
    }
    setBusy(true);
    setErr("");
    const r = await fetch(`/api/schedules/${schedule.id}/meeting-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meetingUrl: trimmed, note: note.trim() || null }),
    });
    setBusy(false);
    if (!r.ok) {
      setErr(await r.text());
      return;
    }
    setModalOpen(false);
    onChanged();
  };

  if (!hasLink) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
        <div className="text-2xl shrink-0" aria-hidden>
          🎥
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-amber-900">
            온라인 미팅 링크가 아직 등록되지 않았습니다
          </div>
          <div className="text-xs text-amber-800 mt-0.5 leading-relaxed">
            Zoom · Google Meet · Teams 등에서 미팅을 먼저 만든 뒤, 링크를 붙여넣어
            후보자에게 안내해 주세요. 캘린더 초대(.ics) 가 자동으로 첨부됩니다.
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="mt-3 px-3 py-1.5 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-lg"
          >
            + 미팅 링크 추가
          </button>
        </div>
        {modalOpen && (
          <MeetingLinkModal
            url={url}
            note={note}
            setUrl={setUrl}
            setNote={setNote}
            err={err}
            busy={busy}
            onSubmit={submit}
            onCancel={() => {
              setModalOpen(false);
              setErr("");
            }}
            title="온라인 미팅 링크 추가"
            submitLabel="저장 및 발송"
          />
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
      <div className="flex items-start gap-3">
        <div className="text-2xl shrink-0" aria-hidden>
          ✅
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-emerald-900">
            미팅 링크 등록 완료
          </div>
          <a
            href={schedule.onlineMeetingUrl!}
            target="_blank"
            rel="noopener noreferrer"
            className="block mt-1 text-xs text-emerald-800 hover:text-emerald-900 underline break-all"
          >
            {schedule.onlineMeetingUrl}
          </a>
          {schedule.onlineMeetingNote && (
            <div className="mt-2 text-xs text-slate-700 bg-white border border-slate-200 rounded p-2 whitespace-pre-wrap">
              {schedule.onlineMeetingNote}
            </div>
          )}
          {schedule.meetingLinkSentAt && (
            <div className="mt-2 text-[11px] text-emerald-700">
              📧 발송 완료 · {formatKstDateTime(schedule.meetingLinkSentAt)}
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => setModalOpen(true)}
              className="px-2.5 py-1 text-xs bg-white border border-emerald-300 hover:bg-emerald-50 text-emerald-700 rounded"
            >
              수정 · 재발송
            </button>
          </div>
        </div>
      </div>
      {modalOpen && (
        <MeetingLinkModal
          url={url}
          note={note}
          setUrl={setUrl}
          setNote={setNote}
          err={err}
          busy={busy}
          onSubmit={submit}
          onCancel={() => {
            setModalOpen(false);
            setErr("");
          }}
          title="미팅 링크 수정 및 재발송"
          submitLabel="저장 및 재발송"
        />
      )}
    </div>
  );
}

function MeetingLinkModal({
  url,
  note,
  setUrl,
  setNote,
  err,
  busy,
  onSubmit,
  onCancel,
  title,
  submitLabel,
}: {
  url: string;
  note: string;
  setUrl: (v: string) => void;
  setNote: (v: string) => void;
  err: string;
  busy: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  title: string;
  submitLabel: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-lg font-bold text-slate-900">{title}</div>
        <div className="mt-1 text-xs text-slate-500">
          Zoom · Google Meet · Teams 등에서 미팅을 먼저 만든 뒤 링크를
          붙여넣어주세요. https:// 로 시작하는 100자 이내 URL.
        </div>
        <label className="block mt-4">
          <span className="text-xs text-slate-600 font-medium">미팅 URL</span>
          <input
            type="url"
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://zoom.us/j/..."
            className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </label>
        <label className="block mt-3">
          <span className="text-xs text-slate-600 font-medium">
            추가 안내 (선택)
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="예) 10분 전 접속해 카메라·마이크 점검 부탁드립니다. 회의실 비번: 12345"
            className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
          />
        </label>
        <div className="mt-3 text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded p-2">
          📅 저장 시 후보자와 면접관에게 미팅 정보 + 캘린더 초대 파일(.ics) 이
          즉시 발송됩니다.
        </div>
        {err && (
          <div className="mt-2 text-xs text-danger bg-danger-soft border border-danger/30 rounded px-2 py-1.5">
            {err}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-2 text-sm text-slate-600 hover:text-slate-900"
          >
            취소
          </button>
          <button
            onClick={onSubmit}
            disabled={busy || url.trim().length === 0}
            className="px-4 py-2 text-sm font-semibold bg-primary hover:bg-primary-deep text-white rounded-lg disabled:opacity-50"
          >
            {busy ? "저장 중..." : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function ScoreBar({ label, score }: { label: string; score: number | null }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-10 text-xs text-slate-500">{label}</span>
      <span className="w-10 text-right font-bold text-slate-900">
        {score != null ? score : "-"}
      </span>
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        {score != null && (
          <div
            className="h-full bg-gradient-to-r from-primary to-primary-deep rounded-full transition-all"
            style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
          />
        )}
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

function FitHexagon({
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
          fill="rgb(16, 185, 129)"
          fillOpacity={0.2}
          stroke="rgb(16, 185, 129)"
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
            fill="rgb(16, 185, 129)"
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

function BreakdownBlock({
  breakdown,
}: {
  breakdown: NonNullable<NonNullable<Candidate["screeningReport"]>["breakdown"]>;
}) {
  const hasNewAxes =
    breakdown.achievement != null || breakdown.stability != null;
  return (
    <div className="space-y-3">
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
        공고 적합도 (6축)
      </div>
      {/* 좌: 육각형 차트 (고정폭). 우: 6축 사유 리스트 (남은 폭 채움).
          모바일/좁은 화면에서는 자동으로 위아래로 쌓임. */}
      <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-x-6 gap-y-4 items-center">
        <div className="flex justify-center md:justify-start">
          <FitHexagon breakdown={breakdown} />
        </div>
        <div className="divide-y divide-slate-100">
          {SCREENING_AXES.map(({ key, label, weight }) => {
            const d = breakdown[key as BreakdownKey];
            return (
              <div key={key} className="py-2 first:pt-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <span className="text-sm font-medium text-slate-800">
                    {label}
                    <span className="text-[10px] text-slate-400 ml-1.5 font-normal">
                      {weight}
                    </span>
                  </span>
                  <span
                    className={`text-base font-bold tabular-nums ${
                      d ? scoreColor(d.score) : "text-slate-300"
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
                  <p className="text-[11px] text-slate-500 mt-1 leading-snug flex items-start gap-1.5">
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
        <div className="text-[11px] text-slate-400 text-center">
          구버전 평가 데이터 — 성과 임팩트 / 재직 안정성 축은 재평가 후
          채워집니다.
        </div>
      )}
    </div>
  );
}

function BulletBlock({
  title,
  items,
  color,
  emphasis,
}: {
  title: string;
  items: string[];
  color: "emerald" | "amber" | "slate" | "blue";
  /** true 면 카드 배경 강조 (예: 면접에서 확인할 주제는 더 눈에 띄게) */
  emphasis?: boolean;
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
          <li key={i} className="flex gap-2 text-slate-700">
            <span
              className={`w-1.5 h-1.5 rounded-full ${palette.dot} mt-2 shrink-0`}
            />
            <span className="leading-relaxed">
              <HL text={s} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function InterviewLinkBox({
  session,
  candidateEmail,
  onRegenerate,
  disabled = false,
}: {
  session: Session;
  candidateEmail: string | null;
  onRegenerate: () => void;
  disabled?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [emailInput, setEmailInput] = useState(candidateEmail ?? "");
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [sendError, setSendError] = useState<{
    kind: "smtp_not_configured" | "other";
    text: string;
  } | null>(null);
  const url =
    typeof window !== "undefined"
      ? `${window.location.origin}/interview/${session.accessToken}`
      : `/interview/${session.accessToken}`;

  const copy = () => {
    void navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const send = async (to: string) => {
    setSending(true);
    setSent(null);
    setSendError(null);
    const res = await fetch(
      `/api/interview-sessions/${session.id}/send-email`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to }),
      }
    );
    setSending(false);
    if (!res.ok) {
      // JSON 구조화 응답 ({code, message}) 우선, 실패 시 plain text fallback
      const ct = res.headers.get("content-type") ?? "";
      let kind: "smtp_not_configured" | "other" = "other";
      let text = "";
      if (ct.includes("application/json")) {
        const data = (await res.json().catch(() => null)) as
          | { code?: string; message?: string }
          | null;
        if (data?.code === "smtp_not_configured") kind = "smtp_not_configured";
        text = data?.message ?? "발송에 실패했습니다.";
      } else {
        text = await res.text();
      }
      setSendError({ kind, text });
      return;
    }
    const data = await res.json();
    setSent(data.to);
    setShowEmailForm(false);
    setTimeout(() => setSent(null), 4000);
  };

  const handleSendClick = () => {
    if (candidateEmail) {
      void send(candidateEmail);
    } else {
      setShowEmailForm(true);
    }
  };

  const statusLabel: Record<string, { text: string; cls: string }> = {
    pending: { text: "미접속", cls: "bg-surface-alt text-ink-soft" },
    in_progress: { text: "진행 중", cls: "bg-warning-soft text-warning" },
    expired: { text: "만료", cls: "bg-danger-soft text-danger" },
  };
  const sl = statusLabel[session.status] ?? statusLabel.pending;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded-md ${sl.cls}`}
        >
          {sl.text}
        </span>
        <span className="text-xs text-slate-500">
          만료 {formatKstDateTime(session.expiresAt)}
        </span>
      </div>
      <div className="flex gap-2">
        <input
          readOnly
          value={url}
          className="flex-1 border border-slate-300 rounded-lg px-3 py-2 bg-slate-50 text-xs font-mono text-slate-700"
        />
        <button
          onClick={copy}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            copied
              ? "bg-primary text-surface"
              : "bg-ink hover:bg-ink-soft text-surface"
          }`}
        >
          {copied ? "복사됨" : "복사"}
        </button>
        <button
          onClick={handleSendClick}
          disabled={sending || disabled}
          title={
            disabled
              ? "AI 면접 전형이 종료되어 재발송할 수 없습니다."
              : undefined
          }
          className="px-4 py-2 rounded-lg text-sm font-medium bg-primary hover:bg-primary-deep text-surface disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {sending ? "발송 중..." : "📧 재발송"}
        </button>
      </div>
      {sent && (
        <div className="text-xs text-primary-deep bg-primary-soft border border-primary/30 rounded-lg px-3 py-2">
          ✅ {sent} 으로 발송되었습니다.
        </div>
      )}
      {sendError && (
        <div
          className={`text-xs rounded-lg px-3 py-2.5 border ${
            sendError.kind === "smtp_not_configured"
              ? "bg-warning-soft border-warning/30 text-warning"
              : "bg-danger-soft border-danger/30 text-danger"
          }`}
        >
          <div className="flex items-start gap-2">
            <span className="shrink-0">
              {sendError.kind === "smtp_not_configured" ? "📮" : "⚠️"}
            </span>
            <div className="flex-1">
              <div className="font-medium">
                {sendError.kind === "smtp_not_configured"
                  ? "메일 서버가 등록되지 않았습니다"
                  : "이메일 발송 실패"}
              </div>
              <div className="mt-0.5 leading-relaxed">{sendError.text}</div>
              {sendError.kind === "smtp_not_configured" && (
                <div className="mt-2 flex gap-2">
                  <Link
                    href="/org/smtp"
                    className="inline-flex items-center px-2.5 py-1 rounded-md bg-amber-600 text-white font-medium hover:bg-amber-700"
                  >
                    메일서버 설정으로 이동
                  </Link>
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(url);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                    className="inline-flex items-center px-2.5 py-1 rounded-md border border-amber-300 text-amber-800 hover:bg-amber-100"
                  >
                    링크 복사로 직접 전달
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {showEmailForm && (
        <div className="flex gap-2">
          <input
            type="email"
            placeholder="후보자 이메일 주소 입력"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && emailInput && send(emailInput)}
            className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm"
            autoFocus
          />
          <button
            onClick={() => emailInput && send(emailInput)}
            disabled={sending || !emailInput}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-primary hover:bg-primary-deep text-white disabled:opacity-50"
          >
            보내기
          </button>
          <button
            onClick={() => setShowEmailForm(false)}
            className="px-3 py-2 rounded-lg text-sm border border-slate-300 hover:bg-slate-50"
          >
            취소
          </button>
        </div>
      )}
      <button
        onClick={onRegenerate}
        className="text-xs text-slate-500 hover:text-slate-900 underline"
      >
        링크 새로 발급
      </button>
    </div>
  );
}

/** M3 — 면접 종료됐는데 evaluation=null 인 케이스(LLM 평가 실패). 토큰은 H3에서 환불됐고,
 *  재시도 시 본 라우트가 다시 차감 후 재평가. 실패하면 또 환불 (멱등). */
function InterviewEvaluationRetry({
  sessionId,
  onShowTranscript,
  onSuccess,
}: {
  sessionId: number;
  onShowTranscript: () => void;
  onSuccess: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null
  );
  const retry = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(
        `/api/interview-sessions/${sessionId}/reevaluate`,
        { method: "POST" }
      );
      // 본문은 성공/LLM실패 시 JSON, 가드 거부(404/403/409 등) 시 평문 — 둘 다 처리.
      const raw = await res.text();
      let data: { ok?: boolean; error?: string; detail?: string } | null = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = null;
      }
      if (res.ok && data?.ok) {
        setMsg({ kind: "ok", text: "재평가 성공. 잠시 후 결과가 반영됩니다." });
        onSuccess();
      } else if (res.status === 409) {
        // 409 = 이미 평가됨 또는 미종료 — 화면 상태가 DB 와 어긋난 것. 새로고침으로 해소.
        setMsg({
          kind: "err",
          text: `${raw || "재평가할 수 없는 상태입니다."}\n화면을 새로고침합니다.`,
        });
        onSuccess();
      } else {
        // JSON 이면 error/detail, 평문이면 raw 본문을 사유로 노출.
        const base =
          data?.error ??
          raw ??
          `재평가 실패 (HTTP ${res.status}). 잠시 후 다시 시도해 주세요.`;
        setMsg({
          kind: "err",
          // detail = 실제 LLM 실패 원인 (빈 응답·차단·파싱 실패 등). 진단용으로 함께 노출.
          text: data?.detail ? `${base}\n(원인: ${data.detail})` : base,
        });
      }
    } catch (e) {
      setMsg({
        kind: "err",
        text: `재평가 요청 중 오류: ${e instanceof Error ? e.message : String(e)}`,
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3 text-sm">
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 mb-1">
          AI 평가 생성 실패
        </div>
        <p className="text-amber-900 leading-relaxed">
          면접은 정상 종료되었으나 AI 평가 JSON 생성에 실패했습니다. 사용된 토큰은
          자동 환불되었습니다. 아래 버튼으로 재평가를 요청하면 토큰이 다시 차감되며,
          또 실패하면 환불됩니다.
        </p>
      </div>
      <div className="flex gap-2">
        <button
          onClick={retry}
          disabled={busy}
          className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-white text-sm font-medium disabled:opacity-50"
        >
          {busy ? "재평가 중..." : "🔄 AI 평가 재시도"}
        </button>
        <button
          onClick={onShowTranscript}
          className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm"
        >
          대화록 보기
        </button>
      </div>
      {msg && (
        <div
          className={`text-xs px-3 py-2 rounded-lg border whitespace-pre-wrap ${
            msg.kind === "ok"
              ? "bg-primary-soft border-primary/30 text-primary-deep"
              : "bg-danger-soft border-danger/30 text-danger"
          }`}
        >
          {msg.text}
        </div>
      )}
    </div>
  );
}

function InterviewResult({
  session,
  onShowTranscript,
  onRegenerate,
  disabled = false,
}: {
  session: Session;
  onShowTranscript: () => void;
  onRegenerate: () => void;
  disabled?: boolean;
}) {
  const ev = session.evaluation!;
  return (
    <div className="space-y-5 text-sm">
      <div className="flex items-baseline gap-3 flex-wrap">
        <div className={`text-5xl font-bold tabular-nums ${scoreColor(ev.overall_score)}`}>
          {ev.overall_score}
        </div>
        <span className="text-base text-slate-400 font-medium">/ 100</span>
        {showRec(ev.recommendation) && (
          <span
            className={`text-xs font-semibold px-2.5 py-1 rounded-md border ${recColor[ev.recommendation]}`}
          >
            {ev.recommendation}
          </span>
        )}
        <span className="ml-auto text-xs text-slate-500">
          면접 {session.completedAt ? formatKstDateTime(session.completedAt) : "-"}
        </span>
      </div>
      <blockquote className="border-l-4 border-primary/40 bg-primary-soft/30 px-4 py-3 rounded-r-lg text-slate-800 leading-relaxed">
        <HL text={ev.summary} />
      </blockquote>

      <div className="grid grid-cols-2 gap-3">
        {Object.entries(ev.scores ?? {}).map(([k, v]) => (
          <div
            key={k}
            className="border border-slate-200 rounded-xl p-3 bg-slate-50/50"
          >
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-slate-500">{k}</span>
              <span className={`font-bold tabular-nums ${scoreColor(v.score)}`}>
                {v.score}
              </span>
            </div>
            <div className="text-xs text-slate-600 mt-1.5 leading-relaxed">
              <HL text={v.comment} />
            </div>
          </div>
        ))}
      </div>

      <BulletBlock title="강점" items={ev.strengths} color="emerald" />
      <BulletBlock title="우려" items={ev.concerns} color="amber" />
      <BulletBlock
        title="다음 단계 추가 검증 질문"
        items={ev.followup_questions}
        color="slate"
      />
      {ev.llm_assist_note && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 mt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-700">
            외부 LLM 보조 분석
          </div>
          <div className="text-sm text-amber-900 mt-1 leading-relaxed">
            <HL text={ev.llm_assist_note} />
          </div>
          <div className="text-[11px] text-amber-700 mt-2">
            ※ 객관 입력 패턴(붙여넣기 비율·탭 이탈·복사 시도) 기반 추정입니다.
            단정 금물 — 정당 사용 가능성도 있으니 다음 면접에서 본인 발언으로 재확인 권장.
          </div>
        </div>
      )}

      {ev.ai_authorship && (
        <div
          className={`rounded-xl border px-4 py-3 mt-3 ${
            ev.ai_authorship.likelihood === "높음"
              ? "border-rose-200 bg-rose-50"
              : ev.ai_authorship.likelihood === "보통"
                ? "border-amber-200 bg-amber-50"
                : "border-slate-200 bg-slate-50"
          }`}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
              AI 답변 자동 판별 (문체 분석)
            </div>
            <span
              className={`text-xs font-bold px-2 py-0.5 rounded-md border ${
                ev.ai_authorship.likelihood === "높음"
                  ? "border-rose-300 bg-rose-100 text-rose-800"
                  : ev.ai_authorship.likelihood === "보통"
                    ? "border-amber-300 bg-amber-100 text-amber-800"
                    : "border-slate-300 bg-slate-100 text-slate-700"
              }`}
            >
              가능성 {ev.ai_authorship.likelihood} · {ev.ai_authorship.score}/100
            </span>
          </div>
          {ev.ai_authorship.signals?.length > 0 && (
            <ul className="list-disc pl-5 mt-2 space-y-0.5 text-sm text-slate-700">
              {ev.ai_authorship.signals.map((s, i) => (
                <li key={i}>
                  <HL text={s} />
                </li>
              ))}
            </ul>
          )}
          {ev.ai_authorship.note && (
            <div className="text-sm text-slate-800 mt-2 leading-relaxed">
              <HL text={ev.ai_authorship.note} />
            </div>
          )}
          <div className="text-[11px] text-slate-500 mt-2">
            ※ 답변 텍스트의 문체만 본 LLM 추정입니다. 행동 신호(위)와 별개 —
            단정 금물, 면접 자리에서 본인 발언으로 재확인 권장.
          </div>
        </div>
      )}

      <div className="flex gap-3 pt-3 border-t border-slate-100">
        <button
          onClick={onShowTranscript}
          className="text-xs text-primary hover:underline"
        >
          면접 대화록 보기 →
        </button>
        {!disabled && (
          <button
            onClick={onRegenerate}
            className="text-xs text-slate-500 hover:text-slate-900 underline"
          >
            재면접 링크 발급
          </button>
        )}
      </div>
    </div>
  );
}

function TranscriptModal({
  messages,
  onClose,
}: {
  messages: { role: string; content: string }[];
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-slate-200 flex justify-between items-center">
          <h3 className="font-bold text-slate-900">면접 대화록</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition-colors"
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto p-5 space-y-3 bg-slate-50">
          {messages
            .filter((m, i) => !(i === 0 && m.role === "user"))
            .map((m, i) => (
              <div
                key={i}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                    m.role === "user"
                      ? "bg-primary text-white"
                      : "bg-white text-slate-900 border border-slate-200"
                  }`}
                >
                  {m.content.replace("[INTERVIEW_END]", "")}
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

type Appeal = {
  id: number;
  candidateId: number;
  interviewSessionId: number;
  email: string;
  reason: string;
  status: "pending" | "reviewed" | "resolved" | "rejected";
  response: string | null;
  createdAt: string;
  reviewedAt: string | null;
};

function AppealsPanel({ candidateId }: { candidateId: number }) {
  const [list, setList] = useState<Appeal[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const load = async () => {
    const r = await fetch(`/api/candidates/${candidateId}/appeals`);
    if (!r.ok) return;
    setList(await r.json());
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateId]);

  if (!list || list.length === 0) return null;

  const update = async (
    appealId: number,
    body: { status?: Appeal["status"]; response?: string }
  ) => {
    setBusy(appealId);
    const r = await fetch(
      `/api/candidates/${candidateId}/appeals/${appealId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    setBusy(null);
    if (!r.ok) {
      notify(await r.text(), { tone: "danger" });
      return;
    }
    void load();
  };

  const fmt = (s: string | null) =>
    s ? new Date(s).toLocaleString("ko-KR") : "-";
  const statusColor: Record<Appeal["status"], string> = {
    pending: "bg-warning-soft text-warning",
    reviewed: "bg-info-soft text-info",
    resolved: "bg-primary-soft text-primary-deep",
    rejected: "bg-surface-alt text-ink-soft",
  };

  return (
    <Section title="자동화 의사결정 이의제기" collapsible={false}>
      <div className="text-xs text-slate-500 mb-3">
        PIPA §37의2 에 따라 영업일 기준 7일 이내 답변 회신 의무. 상태를 변경하면
        후보자에게 통지되지 않으니 별도 이메일로 답변을 보내야 합니다.
      </div>
      <ul className="space-y-3">
        {list.map((a) => (
          <li
            key={a.id}
            className="bg-amber-50 border border-amber-200 rounded-xl p-4"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`text-[11px] px-2 py-0.5 rounded-md font-medium ${statusColor[a.status]}`}
              >
                {a.status === "pending"
                  ? "검토 대기"
                  : a.status === "reviewed"
                    ? "검토 중"
                    : a.status === "resolved"
                      ? "해결됨"
                      : "기각"}
              </span>
              <span className="text-xs text-slate-700 font-medium">
                {a.email}
              </span>
              <span className="text-[11px] text-slate-500">
                · 접수 {fmt(a.createdAt)}
              </span>
              {a.reviewedAt && (
                <span className="text-[11px] text-slate-500">
                  · 처리 {fmt(a.reviewedAt)}
                </span>
              )}
            </div>
            <div className="mt-3 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed bg-white border border-slate-200 rounded-lg p-3">
              {a.reason}
            </div>
            <details className="mt-3">
              <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-900">
                내부 메모 / 상태 변경
              </summary>
              <div className="mt-2 space-y-2">
                <textarea
                  defaultValue={a.response ?? ""}
                  onBlur={(e) => {
                    if (e.target.value !== (a.response ?? ""))
                      void update(a.id, { response: e.target.value });
                  }}
                  rows={3}
                  placeholder="검토 내용 / 후보자에게 보낼 답변 초안 (내부 메모)"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs"
                />
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      "reviewed",
                      "resolved",
                      "rejected",
                      "pending",
                    ] as Appeal["status"][]
                  )
                    .filter((s) => s !== a.status)
                    .map((s) => (
                      <button
                        key={s}
                        onClick={() => update(a.id, { status: s })}
                        disabled={busy === a.id}
                        className="text-xs px-3 py-1 rounded-md border border-slate-300 hover:bg-slate-100 disabled:opacity-50"
                      >
                        {s === "reviewed"
                          ? "검토중으로"
                          : s === "resolved"
                            ? "해결됨으로"
                            : s === "rejected"
                              ? "기각으로"
                              : "대기로 되돌리기"}
                      </button>
                    ))}
                </div>
              </div>
            </details>
          </li>
        ))}
      </ul>
    </Section>
  );
}

const STAGE_LABEL = STAGE_LABELS_SHARED as Record<string, string>;
// 색상은 STAGE_META.color (border 포함) 의 본문만 추출. 상세 페이지는 border 없이 사용.
// jobs/[id]/page.tsx pipelineCells 와 일관: 중립 → 포레스트 → 정보 → 애프리콧 → 포레스트 → 솔리드
const STAGE_COLOR: Record<string, string> = {
  applied: "bg-surface-alt text-ink-soft",
  screened: "bg-primary-soft text-primary-deep",
  ai_pending: "bg-info-soft text-info",
  ai_evaluated: "bg-info-soft text-info",
  round1_candidate: "bg-accent-soft text-accent-deep",
  round1_scheduling: "bg-accent-soft text-accent-deep",
  round1_waiting: "bg-accent-soft text-accent-deep",
  round1_passed: "bg-primary-soft text-primary-deep",
  round2_passed: "bg-primary-soft text-primary",
  hired: "bg-primary text-surface",
  rejected: "bg-danger-soft text-danger",
  withdrawn: "bg-surface-alt text-ink-muted",
};

// 수동 진행 다음 단계 매핑 — 버튼 노출 가드와 모달 안 버튼이 공유.
// M7 — 단계별로 1개 옵션만 노출되던 문제 해결. 정상 진행 외에 스킵·되돌리기 등
// 추가 옵션을 함께 노출하여 실 사용자 흐름을 막지 않게 함. 가장 일반적인 단계를
// "권장"으로 첫 번째에 배치, 그 외는 "기타" 그룹으로 표시.
type StageOption = { stage: string; label?: string; variant?: "primary" | "secondary" };
const STAGE_TRANSITIONS_MAP: Record<string, StageOption[]> = {
  applied: [
    { stage: "screened", variant: "primary" },
    { stage: "ai_pending", label: "서류 스킵하고 AI면접 대기로", variant: "secondary" },
  ],
  screened: [
    { stage: "ai_pending", variant: "primary" },
    { stage: "round1_candidate", label: "AI면접 스킵하고 1차 후보로", variant: "secondary" },
  ],
  ai_pending: [
    { stage: "ai_evaluated", label: "AI면접 강제 완료로 표시", variant: "secondary" },
  ],
  ai_evaluated: [
    { stage: "round1_candidate", variant: "primary" },
    { stage: "round2_passed", label: "1차 면접 스킵하고 2차 합격으로", variant: "secondary" },
  ],
  round1_candidate: [
    { stage: "round1_scheduling", label: "📅 1차 면접 일정 제안 (슬롯·메일 발송)", variant: "primary" },
    { stage: "round1_passed", label: "1차 면접 합격으로 (스킵)", variant: "secondary" },
  ],
  round1_scheduling: [
    { stage: "round1_waiting", label: "1차 면접 응시 대기", variant: "primary" },
    { stage: "round1_scheduling", label: "📅 일정 다시 제안", variant: "secondary" },
    { stage: "round1_candidate", label: "일정 취소 — 1차 후보로 되돌리기", variant: "secondary" },
    { stage: "round1_passed", label: "1차 면접 합격", variant: "secondary" },
  ],
  round1_waiting: [
    { stage: "round1_passed", variant: "primary" },
    { stage: "round1_scheduling", label: "일정 재조정", variant: "secondary" },
  ],
  round1_passed: [
    { stage: "round2_passed", variant: "primary" },
  ],
  round2_passed: [],
};

// 하위호환 — 외부 노출 가드 (button visibility) 용.
const STAGE_NEXT_MAP: Record<string, string | null> = Object.fromEntries(
  Object.entries(STAGE_TRANSITIONS_MAP).map(([k, v]) => [k, v[0]?.stage ?? null])
);

/** 현재 단계 기준 다음으로 진행할 단계를 모두 노출. 권장은 강조 표시. */
function ProgressiveStageButtons({
  currentStage,
  busy,
  onMove,
}: {
  currentStage: string;
  busy: boolean;
  onMove: (s: string) => void;
}) {
  const opts = STAGE_TRANSITIONS_MAP[currentStage] ?? [];
  if (opts.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        다음 단계가 없습니다. 종결 결정으로 마무리해 주세요.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {opts.map((o) => {
        const isPrimary = (o.variant ?? "primary") === "primary";
        return (
          <button
            key={o.stage}
            onClick={() => onMove(o.stage)}
            disabled={busy}
            className={
              isPrimary
                ? "w-full px-4 py-3 rounded-lg border border-primary/40 bg-primary-soft hover:bg-primary-soft text-primary-deep text-sm font-semibold disabled:opacity-50 transition-colors"
                : "w-full px-4 py-2.5 rounded-lg border border-border-default bg-card hover:bg-surface-alt text-ink-soft text-sm font-medium disabled:opacity-50 transition-colors"
            }
          >
            → {o.label ?? STAGE_LABEL[o.stage] ?? o.stage}
          </button>
        );
      })}
      <p className="text-[11px] text-slate-400 pt-1">
        반려·합격·취소 등 종결은 우측 "종결 결정"을 사용해 주세요.
      </p>
    </div>
  );
}

function StageBadge({ stage }: { stage: string }) {
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-md font-medium ${
        STAGE_COLOR[stage] ?? "bg-slate-100 text-slate-600"
      }`}
    >
      {STAGE_LABEL[stage] ?? stage}
    </span>
  );
}

const OUTCOME_META: Record<
  NonNullable<Candidate["outcome"]>,
  { label: string; color: string }
> = {
  hired:     { label: "최종합격", color: "bg-primary text-surface border border-primary" },
  rejected:  { label: "불합격",   color: "bg-danger-soft text-danger border border-danger/30" },
  withdrawn: { label: "지원취소", color: "bg-surface-alt text-ink-soft border border-border-default" },
};

const OUTCOME_REASON_LABEL: Record<string, string> = {
  candidate_withdrew: "지원자가 지원 취소",
  ai_link_expired: "AI면접 링크 만료",
  schedule_link_expired: "1차 면접 일정 링크 만료",
  resume_unfit: "서류 부적합",
  ai_interview_unfit: "AI면접 평가 부적합",
  round1_unfit: "1차 면접 부적합",
  round2_unfit: "2차 면접 부적합",
  offer_declined: "처우협의 결렬",
  passed_final: "최종 합격 결정",
  other: "기타",
};

function OutcomeBadge({
  outcome,
  reason,
}: {
  outcome: NonNullable<Candidate["outcome"]>;
  reason: string | null;
}) {
  const m = OUTCOME_META[outcome];
  const rl = reason ? OUTCOME_REASON_LABEL[reason] : null;
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-md font-semibold ${m.color}`}
      title={rl ?? undefined}
    >
      {m.label}
      {rl && <span className="ml-1 opacity-70 font-normal">· {rl}</span>}
    </span>
  );
}

// lib/candidate-stage.ts 의 buildDecisionEmail 본문과 동일한 기본 템플릿.
// 변경 시 양쪽을 함께 수정해야 사용자가 본 미리보기와 실제 발송 본문이 일치.
function defaultDecisionBody(
  decision: "hired" | "rejected",
  candidateName: string,
  jobTitle: string,
  companyName?: string | null
): string {
  const coName = companyName?.trim() ?? "";
  const co = coName && !jobTitle.includes(coName) ? `${coName} ` : "";
  return decision === "hired"
    ? `${candidateName}님, ${co}${jobTitle} 포지션 최종 합격을 진심으로 축하드립니다.\n\n곧 채용 담당자가 별도로 연락드려 입사 절차를 안내해 드릴 예정입니다.\n감사합니다.`
    : `${candidateName}님, ${co}${jobTitle} 포지션에 지원해 주셔서 진심으로 감사드립니다.\n\n신중히 검토한 결과, 이번 채용에서는 함께하기 어렵게 되었음을 안내드립니다. 좋은 인연으로 다시 만날 기회가 있기를 기대하며, 앞으로의 여정에 좋은 결과 있으시기를 응원합니다.`;
}

function StagePanel({
  candidate,
  jobTitle,
  companyName,
  onChanged,
  showFullResume,
  setShowFullResume,
  rescreening,
  screeningPhase,
  screeningActive,
}: {
  candidate: Candidate;
  jobTitle: string;
  companyName?: string | null;
  onChanged: () => void;
  showFullResume: boolean;
  setShowFullResume: (v: boolean) => void;
  rescreening: boolean;
  screeningPhase: "not_started" | "in_queue" | "done" | "failed";
  screeningActive: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [rescreenBusy, setRescreenBusy] = useState(false);
  const [open, setOpen] = useState<
    null | "decide" | "stage" | "notify" | "schedule" | "schedule2"
  >(null);
  const [decision, setDecision] = useState<"hired" | "rejected">("rejected");
  const [reason, setReason] = useState<string>("");
  const [note, setNote] = useState("");
  const [customMessage, setCustomMessage] = useState(() =>
    defaultDecisionBody("rejected", candidate.name, jobTitle, companyName)
  );
  // 사용자가 한 번이라도 본문을 직접 수정하면 더 이상 decision 변경 시 덮어쓰지 않음.
  const [messageEdited, setMessageEdited] = useState(false);
  // 메일 발송 기본값 false — 의도하지 않은 메일 발송 방지. 본문 미리보기는 항상 노출.
  const [sendMail, setSendMail] = useState(false);

  // decide 모달: decision 또는 후보자 정보 바뀌면 기본 템플릿 재생성 (사용자가 직접 수정하지 않은 경우만).
  useEffect(() => {
    if (open === "decide" && !messageEdited) {
      setCustomMessage(defaultDecisionBody(decision, candidate.name, jobTitle, companyName));
    }
  }, [open, decision, candidate.name, jobTitle, companyName, messageEdited]);

  // notify 모달 열 때 — 이미 확정된 outcome 기반으로 기본 템플릿 채움 + edit 플래그 리셋.
  const openNotify = () => {
    if (candidate.outcome === "hired" || candidate.outcome === "rejected") {
      setCustomMessage(
        defaultDecisionBody(candidate.outcome, candidate.name, jobTitle, companyName)
      );
      setMessageEdited(false);
    }
    setOpen("notify");
  };
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null
  );

  const isTerminal = candidate.outcome != null;

  // outcome 별 선택 가능 사유. 사용자가 outcome 바꿀 때 default reason 자동 선택.
  // 지원취소(withdrawn)는 후보자 본인이 면접 링크/일정 페이지에서 처리 — HR 모달에서 제외.
  const REASONS_BY_OUTCOME: Record<"hired" | "rejected", string[]> = {
    hired: ["passed_final"],
    rejected: [
      "resume_unfit",
      "ai_interview_unfit",
      "round1_unfit",
      "round2_unfit",
      "offer_declined",
      "other",
    ],
  };
  // 불합격 default 사유 — 현재 후보자의 stage 에 따라 추정.
  const defaultRejectReasonForStage = (stage: string): string => {
    if (stage === "applied" || stage === "screened") return "resume_unfit";
    if (stage === "ai_pending" || stage === "ai_evaluated")
      return "ai_interview_unfit";
    if (
      stage === "round1_candidate" ||
      stage === "round1_scheduling" ||
      stage === "round1_waiting" ||
      stage === "round1_passed"
    )
      return "round1_unfit";
    // 2차 합격은 이미 2차 면접을 통과한 상태 → 이후 불합격은 처우협의 결렬이 기본.
    if (stage === "round2_passed") return "offer_declined";
    return "resume_unfit";
  };
  const reasonsAvail = REASONS_BY_OUTCOME[decision];
  useEffect(() => {
    if (!reasonsAvail.includes(reason)) {
      const next =
        decision === "rejected"
          ? defaultRejectReasonForStage(candidate.stage)
          : reasonsAvail[0];
      setReason(reasonsAvail.includes(next) ? next : reasonsAvail[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decision, reason, reasonsAvail]);

  const move = async (newStage: string) => {
    // round1_scheduling 진입은 단순 상태 변경이 아니라 "일정 제안" 이라는 실제 행위가
    // 필요하다. 슬롯·면접방식 입력 + 후보자 메일 발송을 하는 schedule-propose 가 정식
    // 진입점이고, 그 API 가 성공 시 stage 를 round1_scheduling 으로 전환한다.
    // 여기서 plain PATCH 로 stage 만 바꾸면 일정 없는 "조율 중" 상태에 갇힌다 (버그).
    if (newStage === "round1_scheduling") {
      setOpen("schedule");
      return;
    }
    setBusy(true);
    setMsg(null);
    const r = await fetch(`/api/candidates/${candidate.id}/stage`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage: newStage }),
    });
    if (!r.ok) {
      setBusy(false);
      setMsg({ kind: "err", text: await r.text() });
      return;
    }
    // ai_pending 진입 시 — AI면접 링크 자동 생성 + 후보자 자동 발송
    // (서류 평가 화면의 "AI면접 요청" 버튼과 동일한 흐름).
    // 발송 실패는 silent — 사용자가 InterviewLinkBox 의 재발송 버튼으로 수동 대응 가능.
    if (newStage === "ai_pending") {
      try {
        const linkRes = await fetch(
          `/api/candidates/${candidate.id}/interview-link`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ days: 7 }),
          }
        );
        if (linkRes.ok && candidate.email) {
          const session = (await linkRes.json().catch(() => null)) as
            | { id: number }
            | null;
          if (session?.id) {
            await fetch(`/api/interview-sessions/${session.id}/send-email`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ to: candidate.email }),
            });
          }
        } else if (!linkRes.ok) {
          // 링크 생성 자체가 실패했으면 사용자에게 알림 — 단계는 이미 바뀐 상태.
          const ct = linkRes.headers.get("content-type") ?? "";
          const msg = ct.includes("application/json")
            ? ((await linkRes.json().catch(() => ({}))).error ??
              "면접 링크 생성 실패")
            : await linkRes.text();
          setMsg({
            kind: "err",
            text: `단계는 변경됐으나 면접 링크 생성에 실패했습니다: ${msg}`,
          });
        }
      } catch {
        /* 발송 실패는 silent */
      }
    }
    setBusy(false);
    setOpen(null);
    onChanged();
  };

  const decide = async () => {
    setBusy(true);
    setMsg(null);
    const r = await fetch(`/api/candidates/${candidate.id}/stage`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        outcome: decision,
        outcomeReason: reason || undefined,
        note,
        sendNotification: sendMail,
        customMessage: customMessage || undefined,
      }),
    });
    setBusy(false);
    if (!r.ok) {
      setMsg({ kind: "err", text: await r.text() });
      return;
    }
    const data = (await r.json()) as {
      purged: boolean;
      mail: { sent: boolean; error?: string };
    };
    const outcomeLabelMap = { hired: "최종합격", rejected: "불합격" } as const;
    const parts: string[] = [];
    parts.push(`결과: ${outcomeLabelMap[decision]}`);
    if (data.purged) parts.push("이력서 본문·파일 즉시 폐기됨 (PIPA)");
    if (sendMail) {
      parts.push(data.mail.sent ? "메일 발송 완료" : `메일 실패: ${data.mail.error}`);
    }
    setMsg({ kind: "ok", text: parts.join(" · ") });
    setOpen(null);
    setNote("");
    setCustomMessage("");
    onChanged();
  };

  const sendDecisionMail = async () => {
    setBusy(true);
    setMsg(null);
    const r = await fetch(`/api/candidates/${candidate.id}/decision-mail`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customMessage: customMessage || undefined }),
    });
    setBusy(false);
    if (!r.ok) {
      setMsg({ kind: "err", text: await r.text() });
      return;
    }
    setMsg({ kind: "ok", text: "결정 통보 메일 발송 완료" });
    setOpen(null);
    setCustomMessage("");
    onChanged();
  };

  // 재평가 — 공고/평가가이드 수정 후 또는 재확인용. 기존 결과는 새 평가가 끝나면 덮어쓴다.
  // 과금은 평가가 성공 완료될 때 1건 차감(오류면 과금 안 됨).
  const rescreen = async () => {
    const overwriteNote = candidate.screeningReport
      ? "기존 평가 결과는 새 결과로 대체됩니다.\n"
      : "";
    if (
      !(await confirmDialog(
        `이 후보자를 다시 AI 서류평가합니다.\n${overwriteNote}평가가 정상 완료되면 토큰이 차감됩니다 (오류 시 과금 없음).`,
        { title: "재평가", confirmText: "재평가" }
      ))
    )
      return;
    setRescreenBusy(true);
    setMsg(null);
    const r = await fetch(`/api/candidates/${candidate.id}/screen`, {
      method: "POST",
    });
    setRescreenBusy(false);
    if (!r.ok) {
      setMsg({ kind: "err", text: await r.text() });
      return;
    }
    setMsg({ kind: "ok", text: "재평가를 시작했습니다. 잠시 후 결과가 갱신됩니다." });
    onChanged();
  };

  return (
    <>
      <div className="mt-4 pt-4 border-t border-slate-100 flex items-center gap-1.5 sm:gap-2 flex-nowrap sm:flex-wrap overflow-x-auto sm:overflow-visible text-sm">
        {candidate.decidedAt && (
          <span className="text-xs text-slate-500 shrink-0 whitespace-nowrap">
            결정 {formatKstDateTime(candidate.decidedAt)}
          </span>
        )}
        {candidate.resumeFilePath && (
          <a
            href={`/api/uploads/candidate/${candidate.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 whitespace-nowrap text-xs px-3 py-1.5 max-sm:py-2.5 rounded-md border border-slate-300 hover:bg-slate-50 text-slate-700 inline-flex items-center gap-1"
          >
            📎 이력서
          </a>
        )}
        {candidate.resumeMaskedText && (
          <button
            onClick={() => setShowFullResume(!showFullResume)}
            className="shrink-0 whitespace-nowrap text-xs px-3 py-1.5 max-sm:py-2.5 rounded-md border border-slate-300 hover:bg-slate-50 text-slate-600"
          >
            {showFullResume ? "마스킹 접기" : "마스킹 보기"}
          </button>
        )}
        {/* 재평가 — 평가 완료/실패/재시도 대기 후보 모두 대상(공고·가이드 수정, 오류 복구, 재확인).
            워커가 실제 처리중일 때만 버튼 숨기고 진행 표시. (not_started 는 위 평가 영역의 "AI 검토 요청" 사용) */}
        {screeningPhase !== "not_started" &&
          (screeningActive || rescreening ? (
            <span className="shrink-0 whitespace-nowrap text-xs px-3 py-1.5 rounded-md border border-blue-200 bg-blue-50 text-blue-600 inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
              평가 진행 중...
            </span>
          ) : (
            <button
              onClick={() => void rescreen()}
              disabled={rescreenBusy}
              title="공고/평가 가이드 수정 후, 오류 복구, 또는 결과 재확인 시 다시 평가합니다"
              className="shrink-0 whitespace-nowrap text-xs px-3 py-1.5 max-sm:py-2.5 rounded-md border border-blue-300 text-blue-600 hover:bg-blue-50 disabled:opacity-50"
            >
              {rescreenBusy ? "요청 중..." : "🔄 재평가"}
            </button>
          ))}
        {!candidate.resumeFilePath && !candidate.resumeMaskedText && (
          <span className="text-xs text-slate-500 italic shrink-0 whitespace-nowrap">
            🔒 보존기간 경과로 이력서 원본 폐기됨
          </span>
        )}
        {!isTerminal && (
          <div className="flex gap-1.5 sm:gap-2 shrink-0 sm:ml-auto">
            {candidate.stage === "ai_evaluated" && (
              <button
                onClick={() => void move("round1_candidate")}
                disabled={busy}
                className="shrink-0 whitespace-nowrap text-xs px-3 py-1.5 max-sm:py-2.5 rounded-md bg-accent-deep hover:bg-accent text-surface font-medium disabled:opacity-50 transition-colors"
                title="1차 면접 후보로 지정 — 공고 목록 상단 별도 섹션으로 이동"
              >
                ⭐ 1차 면접 후보로 지정
              </button>
            )}
            {candidate.stage === "round1_passed" && (
              <button
                onClick={() => setOpen("schedule2")}
                disabled={busy}
                className="shrink-0 whitespace-nowrap text-xs px-3 py-1.5 max-sm:py-2.5 rounded-md bg-accent-deep hover:bg-accent text-surface font-medium disabled:opacity-50 transition-colors"
                title="1차 합격 후보에게 2차 면접 일정을 제시합니다"
              >
                📅 2차 일정 제시
              </button>
            )}
            {STAGE_NEXT_MAP[candidate.stage] && (
              <button
                onClick={() => setOpen("stage")}
                disabled={busy}
                className="shrink-0 whitespace-nowrap text-xs px-3.5 py-1.5 max-sm:py-2.5 rounded-md bg-primary hover:bg-primary-deep text-surface font-semibold disabled:opacity-50 transition-colors shadow-sm"
                title="다음 단계로 진행"
              >
                ▶ 단계 변경
              </button>
            )}
            <button
              onClick={() => setOpen("decide")}
              disabled={busy}
              className="shrink-0 whitespace-nowrap text-xs px-3 py-1.5 max-sm:py-2.5 rounded-md border border-border-strong text-ink-soft hover:bg-surface-alt hover:text-ink transition-colors"
              title="최종합격·불합격·지원취소로 종결"
            >
              종결 결정
            </button>
          </div>
        )}
        {isTerminal &&
          (candidate.outcome === "hired" || candidate.outcome === "rejected") &&
          (candidate.decisionEmailCount ?? 0) === 0 &&
          candidate.email && (
            <button
              onClick={openNotify}
              disabled={busy}
              className="ml-auto text-xs px-3 py-1.5 rounded-md bg-warning hover:bg-warning/85 text-surface font-medium disabled:opacity-50 transition-colors"
              title="후보자에게 결과 통보 메일이 아직 발송되지 않았습니다"
            >
              📧 결정 통보 보내기
            </button>
          )}
      </div>

      {candidate.decisionNote && (
        <div className="mt-3 text-xs text-ink-soft bg-surface-alt border border-border-default rounded-lg px-3 py-2 whitespace-pre-wrap">
          📝 {candidate.decisionNote}
        </div>
      )}

      {msg && (
        <div
          className={`mt-3 text-xs px-3 py-2 rounded-lg border ${
            msg.kind === "ok"
              ? "bg-primary-soft border-primary/30 text-primary-deep"
              : "bg-danger-soft border-danger/30 text-danger"
          }`}
        >
          {msg.text}
        </div>
      )}

      {open === "stage" && (
        <Modal onClose={() => setOpen(null)} title="단계 변경">
          <ProgressiveStageButtons
            currentStage={candidate.stage}
            busy={busy}
            onMove={(s) => void move(s)}
          />
        </Modal>
      )}

      {open === "schedule" && (
        <ScheduleProposeModal
          jobId={candidate.jobId}
          candidateIds={[candidate.id]}
          nameById={{ [candidate.id]: candidate.name }}
          open
          onClose={() => setOpen(null)}
          onDone={() => {
            setOpen(null);
            onChanged();
          }}
        />
      )}

      {open === "schedule2" && (
        <ScheduleProposeModal
          jobId={candidate.jobId}
          candidateIds={[candidate.id]}
          nameById={{ [candidate.id]: candidate.name }}
          round="round2"
          open
          onClose={() => setOpen(null)}
          onDone={() => {
            setOpen(null);
            onChanged();
          }}
        />
      )}

      {open === "decide" && (
        <Modal onClose={() => setOpen(null)} title="종결 결정">
          <div className="space-y-3">
            <div className="flex gap-2">
              {(
                [
                  ["rejected", "불합격", "bg-danger-soft border-danger/30 text-danger"],
                  ["hired", "최종합격", "bg-primary-soft border-primary/30 text-primary-deep"],
                ] as const
              ).map(([val, label, cls]) => (
                <label
                  key={val}
                  className={`flex-1 px-3 py-2 rounded-lg border cursor-pointer text-center text-sm font-medium ${
                    decision === val ? cls : "bg-card border-border-default text-ink-muted"
                  }`}
                >
                  <input
                    type="radio"
                    name="decision"
                    value={val}
                    checked={decision === val}
                    onChange={() =>
                      setDecision(val)
                    }
                    className="hidden"
                  />
                  {label}
                </label>
              ))}
            </div>

            {reasonsAvail.length > 1 && (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  사유
                </label>
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
                >
                  {reasonsAvail.map((r) => (
                    <option key={r} value={r}>
                      {OUTCOME_REASON_LABEL[r] ?? r}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                내부 메모 (선택 — 후보자에게 노출 X)
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                maxLength={5000}
                placeholder="결정 사유를 기록해 두세요."
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>

            {candidate.email && (decision === "hired" || decision === "rejected") && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sendMail}
                    onChange={(e) => setSendMail(e.target.checked)}
                  />
                  결과 통보 메일을 {candidate.email} 로 발송
                </label>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    발송 본문 미리보기 (수정하면 수정본이 발송됨 — 위 체크 안 하면 발송 X)
                  </label>
                  <textarea
                    value={customMessage}
                    onChange={(e) => {
                      setCustomMessage(e.target.value);
                      setMessageEdited(true);
                    }}
                    rows={8}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm leading-relaxed"
                  />
                  {messageEdited && (
                    <button
                      type="button"
                      onClick={() => {
                        setCustomMessage(
                          defaultDecisionBody(decision, candidate.name, jobTitle, companyName)
                        );
                        setMessageEdited(false);
                      }}
                      className="mt-1 text-[11px] text-slate-500 hover:text-slate-700 underline"
                    >
                      기본 템플릿으로 되돌리기
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="text-[11px] text-slate-500 leading-relaxed bg-amber-50 border border-amber-200 rounded-lg p-2">
              ⚠️ 종결 결정 시 이력서 본문·파일이 즉시 폐기됩니다.
              공고 종결 +14일이 지나면 후보자 정보 전체(점수·평가 포함)가 자동
              삭제됩니다 (PIPA 보유기간 정책).
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={decide}
                disabled={busy}
                className="flex-1 px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-white text-sm font-medium disabled:opacity-50"
              >
                {busy
                  ? "처리 중..."
                  : `${decision === "hired" ? "최종합격" : "불합격"} 처리`}
              </button>
              <button
                onClick={() => setOpen(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm"
              >
                취소
              </button>
            </div>
          </div>
        </Modal>
      )}

      {open === "notify" && candidate.outcome && candidate.outcome !== "withdrawn" && (
        <Modal onClose={() => setOpen(null)} title="결정 통보 메일 발송">
          <div className="space-y-3">
            <div className="text-sm text-slate-700">
              <strong>{candidate.email}</strong> 로 결과 통보 메일을 발송합니다.
              <br />
              결정: <strong>{candidate.outcome === "hired" ? "최종합격" : "불합격"}</strong>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                발송 본문 미리보기 (수정하면 수정본이 발송됨)
              </label>
              <textarea
                value={customMessage}
                onChange={(e) => {
                  setCustomMessage(e.target.value);
                  setMessageEdited(true);
                }}
                rows={8}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm leading-relaxed"
              />
              {messageEdited &&
                (candidate.outcome === "hired" ||
                  candidate.outcome === "rejected") && (
                  <button
                    type="button"
                    onClick={() => {
                      setCustomMessage(
                        defaultDecisionBody(
                          candidate.outcome as "hired" | "rejected",
                          candidate.name,
                          jobTitle,
                          companyName
                        )
                      );
                      setMessageEdited(false);
                    }}
                    className="mt-1 text-[11px] text-slate-500 hover:text-slate-700 underline"
                  >
                    기본 템플릿으로 되돌리기
                  </button>
                )}
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={sendDecisionMail}
                disabled={busy}
                className="flex-1 px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-white text-sm font-medium disabled:opacity-50"
              >
                {busy ? "발송 중..." : "발송"}
              </button>
              <button
                onClick={() => setOpen(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm"
              >
                취소
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showFullResume && candidate.resumeMaskedText && (
        <div className="mt-4 pt-4 border-t border-slate-100">
          <pre className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs whitespace-pre-wrap font-mono text-slate-700 max-h-[50vh] overflow-y-auto">
            {candidate.resumeMaskedText}
          </pre>
        </div>
      )}
    </>
  );
}

function Modal({
  onClose,
  title,
  children,
}: {
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-semibold text-slate-900">{title}</h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

type InterviewerNote = {
  id: number;
  candidateId: number;
  authorUserId: number;
  authorName: string | null;
  round: "round1" | "round2" | null;
  scores: {
    skill?: number | null;
    experience?: number | null;
    collaboration?: number | null;
    fit?: number | null;
  } | null;
  note: string;
  createdAt: string;
  updatedAt: string;
};

function InterviewerNotesPanel({
  candidateId,
  currentStage,
}: {
  candidateId: number;
  currentStage: string;
}) {
  // 후보자 현재 단계에서 면접 차수 기본값 추론 (2차합격이면 2차, 그 외 1차).
  const defaultRound: "round1" | "round2" =
    currentStage === "round2_passed" ? "round2" : "round1";
  const [me, setMe] = useState<{ id: number; name: string } | null>(null);
  const [list, setList] = useState<InterviewerNote[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [round, setRound] = useState<"round1" | "round2">(defaultRound);
  const [skill, setSkill] = useState("");
  const [experience, setExperience] = useState("");
  const [collaboration, setCollaboration] = useState("");
  const [fit, setFit] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");

  // 인라인 수정 — editingId 인 메모만 폼으로 전환.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [eSkill, setESkill] = useState("");
  const [eExperience, setEExperience] = useState("");
  const [eCollaboration, setECollaboration] = useState("");
  const [eFit, setEFit] = useState("");
  const [eNote, setENote] = useState("");
  const [eErr, setEErr] = useState("");

  const load = async () => {
    const [meR, listR] = await Promise.all([
      fetch("/api/auth/status").then((r) => r.json()),
      fetch(`/api/candidates/${candidateId}/notes`).then((r) =>
        r.ok ? r.json() : null
      ),
    ]);
    setMe(meR?.user ?? null);
    if (listR) setList(listR);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateId]);

  const parseScore = (s: string): number | undefined => {
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : undefined;
  };

  const submit = async () => {
    setBusy(true);
    setErr("");
    const r = await fetch(`/api/candidates/${candidateId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        round,
        scores: {
          skill: parseScore(skill),
          experience: parseScore(experience),
          collaboration: parseScore(collaboration),
          fit: parseScore(fit),
        },
        note,
      }),
    });
    setBusy(false);
    if (!r.ok) {
      setErr(await r.text());
      return;
    }
    setRound(defaultRound);
    setSkill("");
    setExperience("");
    setCollaboration("");
    setFit("");
    setNote("");
    setShowForm(false);
    void load();
  };

  const remove = async (nid: number) => {
    if (
      !(await confirmDialog("이 메모를 삭제할까요?", {
        title: "메모 삭제",
        tone: "danger",
        confirmText: "삭제",
      }))
    )
      return;
    setBusy(true);
    const r = await fetch(`/api/candidates/${candidateId}/notes/${nid}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (r.ok) void load();
  };

  const startEdit = (n: InterviewerNote) => {
    setEditingId(n.id);
    setESkill(n.scores?.skill != null ? String(n.scores.skill) : "");
    setEExperience(
      n.scores?.experience != null ? String(n.scores.experience) : ""
    );
    setECollaboration(
      n.scores?.collaboration != null ? String(n.scores.collaboration) : ""
    );
    setEFit(n.scores?.fit != null ? String(n.scores.fit) : "");
    setENote(n.note ?? "");
    setEErr("");
  };

  const saveEdit = async (nid: number) => {
    setBusy(true);
    setEErr("");
    const r = await fetch(`/api/candidates/${candidateId}/notes/${nid}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scores: {
          skill: parseScore(eSkill),
          experience: parseScore(eExperience),
          collaboration: parseScore(eCollaboration),
          fit: parseScore(eFit),
        },
        note: eNote,
      }),
    });
    setBusy(false);
    if (!r.ok) {
      setEErr(await r.text());
      return;
    }
    setEditingId(null);
    void load();
  };

  const avg = (n: InterviewerNote): number | null => {
    const s = n.scores;
    if (!s) return null;
    const vals = [s.skill, s.experience, s.collaboration, s.fit].filter(
      (v): v is number => typeof v === "number"
    );
    if (vals.length === 0) return null;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  };

  const noteSummary = (() => {
    if (list == null) return <span className="text-slate-400">불러오는 중...</span>;
    if (list.length === 0) return <span className="text-slate-400">작성된 메모 없음</span>;
    const avgs = list.map(avg).filter((v): v is number => v != null);
    const overallAvg =
      avgs.length > 0
        ? Math.round(avgs.reduce((a, b) => a + b, 0) / avgs.length)
        : null;
    const authors = new Set(list.map((n) => n.authorUserId));
    const r1 = list.filter((n) => n.round === "round1").length;
    const r2 = list.filter((n) => n.round === "round2").length;
    return (
      <span className="flex items-center gap-2">
        <span className="text-slate-700">{list.length}건</span>
        {r2 > 0 && (
          <span className="text-slate-400">· 1차 {r1} · 2차 {r2}</span>
        )}
        <span className="text-slate-400">· {authors.size}명 작성</span>
        {overallAvg != null && (
          <>
            <span className="text-slate-400">· 평균</span>
            <span className={`font-bold tabular-nums ${scoreColor(overallAvg)}`}>
              {overallAvg}
            </span>
            <span className="text-slate-400">/100</span>
          </>
        )}
      </span>
    );
  })();

  return (
    <Section title="면접관 메모 / 스코어카드" summary={noteSummary} collapsible={false}>
      <div className="flex justify-between items-center mb-3">
        <div className="text-xs text-slate-500">
          같은 법인 멤버 누구나 자기 메모를 작성할 수 있습니다. 본인 메모만
          수정·삭제 가능.
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="text-xs px-3 py-1.5 rounded-md bg-primary hover:bg-primary-deep text-white font-medium shrink-0"
          >
            + 메모 작성
          </button>
        )}
      </div>

      {showForm && (
        <div className="bg-primary-soft border border-primary/30 rounded-xl p-4 mb-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">면접 차수</span>
            <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden text-xs">
              {(["round1", "round2"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRound(r)}
                  className={`px-3 py-1.5 font-medium ${
                    round === r
                      ? "bg-primary text-white"
                      : "bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {r === "round1" ? "1차" : "2차"}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <ScoreInput label="기술역량" value={skill} onChange={setSkill} />
            <ScoreInput
              label="실무경험"
              value={experience}
              onChange={setExperience}
            />
            <ScoreInput
              label="협업"
              value={collaboration}
              onChange={setCollaboration}
            />
            <ScoreInput label="직무적합성" value={fit} onChange={setFit} />
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="자유 메모 (5000자 이내)"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
          />
          {err && (
            <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2">
              {err}
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={submit}
              disabled={busy}
              className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-white text-sm font-medium disabled:opacity-50"
            >
              {busy ? "저장 중..." : "저장"}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {!list ? (
        <div className="text-sm text-slate-500">불러오는 중...</div>
      ) : list.length === 0 ? (
        <div className="text-sm text-slate-400 text-center py-6">
          작성된 메모가 없습니다.
        </div>
      ) : (
        <ul className="space-y-3">
          {list.map((n) => {
            const a = avg(n);
            const isMine = me?.id === n.authorUserId;
            return (
              <li
                key={n.id}
                className="bg-white border border-slate-200 rounded-xl p-4"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  {n.round && (
                    <span
                      className={`text-[11px] px-1.5 py-0.5 rounded font-semibold ${
                        n.round === "round2"
                          ? "bg-indigo-100 text-indigo-700"
                          : "bg-violet-100 text-violet-700"
                      }`}
                    >
                      {n.round === "round2" ? "2차" : "1차"}
                    </span>
                  )}
                  <span className="text-sm font-semibold text-slate-900">
                    {n.authorName ?? `User #${n.authorUserId}`}
                  </span>
                  {a != null && (
                    <span className="text-xs px-2 py-0.5 rounded-md bg-accent-soft text-accent-deep font-medium">
                      평균 {a}
                    </span>
                  )}
                  <span className="text-[11px] text-slate-400">
                    {formatKstDateTime(n.createdAt)}
                  </span>
                  {n.updatedAt !== n.createdAt && (
                    <span className="text-[11px] text-slate-400">(수정됨)</span>
                  )}
                  {isMine && editingId !== n.id && (
                    <div className="ml-auto flex items-center gap-2">
                      <button
                        onClick={() => startEdit(n)}
                        className="text-[11px] text-primary hover:underline"
                      >
                        수정
                      </button>
                      <button
                        onClick={() => remove(n.id)}
                        className="text-[11px] text-danger hover:underline"
                      >
                        삭제
                      </button>
                    </div>
                  )}
                </div>
                {editingId === n.id ? (
                  <div className="mt-3 space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <ScoreInput label="기술역량" value={eSkill} onChange={setESkill} />
                      <ScoreInput
                        label="실무경험"
                        value={eExperience}
                        onChange={setEExperience}
                      />
                      <ScoreInput
                        label="협업"
                        value={eCollaboration}
                        onChange={setECollaboration}
                      />
                      <ScoreInput label="직무적합성" value={eFit} onChange={setEFit} />
                    </div>
                    <textarea
                      value={eNote}
                      onChange={(e) => setENote(e.target.value)}
                      rows={3}
                      placeholder="자유 메모 (5000자 이내)"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                    />
                    {eErr && (
                      <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2">
                        {eErr}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={() => saveEdit(n.id)}
                        disabled={busy}
                        className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-white text-sm font-medium disabled:opacity-50"
                      >
                        {busy ? "저장 중..." : "저장"}
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm"
                      >
                        취소
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {n.scores && (
                      <div className="grid grid-cols-4 gap-2 mt-2 text-center text-xs">
                        <ScoreCell label="기술" value={n.scores.skill} />
                        <ScoreCell label="경험" value={n.scores.experience} />
                        <ScoreCell label="협업" value={n.scores.collaboration} />
                        <ScoreCell label="적합" value={n.scores.fit} />
                      </div>
                    )}
                    {n.note && (
                      <p className="mt-2 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                        {n.note}
                      </p>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function ScoreInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-[11px] text-slate-600 mb-1">{label}</label>
      <input
        type="number"
        min={0}
        max={100}
        value={value}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") {
            onChange("");
            return;
          }
          // 숫자만 허용 + 0~100 범위로 제한 (직접 타이핑한 범위 밖 값 차단)
          const n = Math.floor(Number(raw));
          if (!Number.isFinite(n)) return;
          onChange(String(Math.max(0, Math.min(100, n))));
        }}
        placeholder="0~100"
        className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
      />
    </div>
  );
}

function ScoreCell({
  label,
  value,
}: {
  label: string;
  value: number | null | undefined;
}) {
  return (
    <div className="bg-slate-50 rounded-md py-1.5">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className="text-sm font-semibold text-slate-900">
        {typeof value === "number" ? value : "-"}
      </div>
    </div>
  );
}

type Assignment = {
  id: number;
  userId: number;
  userName: string | null;
  userEmail: string | null;
  createdAt: string;
};
type Member = { id: number; email: string; name: string };

function AssignmentsPanel({ candidateId }: { candidateId: number }) {
  const [list, setList] = useState<Assignment[] | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = async () => {
    setErr("");
    const [aR, mR] = await Promise.all([
      fetch(`/api/candidates/${candidateId}/assignments`),
      fetch(`/api/orgs/members`),
    ]);
    if (aR.ok) setList(await aR.json());
    if (mR.ok) setMembers(await mR.json());
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateId]);

  const add = async () => {
    if (!selected) return;
    setBusy(true);
    setErr("");
    const r = await fetch(`/api/candidates/${candidateId}/assignments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: Number(selected) }),
    });
    setBusy(false);
    if (!r.ok) {
      setErr(await r.text());
      return;
    }
    setSelected("");
    void load();
  };

  const remove = async (aid: number) => {
    if (
      !(await confirmDialog("배정을 해제할까요?", {
        title: "배정 해제",
        tone: "danger",
        confirmText: "해제",
      }))
    )
      return;
    setBusy(true);
    const r = await fetch(`/api/candidates/${candidateId}/assignments/${aid}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (r.ok) void load();
  };

  const assignedIds = new Set((list ?? []).map((a) => a.userId));
  const available = (members ?? []).filter((m) => !assignedIds.has(m.id));

  return (
    <Section title="면접관 배정" collapsible={false}>
      <div className="text-xs text-slate-500 mb-3">
        같은 법인 멤버 중 면접에 참여할 사람을 배정합니다. 배정은 알림·UI 강조용
        — 메모 작성 권한은 같은 법인 누구나 있습니다.
      </div>

      <div className="flex gap-2 mb-3">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="">— 면접관 선택 —</option>
          {available.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.email})
            </option>
          ))}
        </select>
        <button
          onClick={add}
          disabled={busy || !selected}
          className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-white text-sm font-medium disabled:opacity-50"
        >
          배정
        </button>
      </div>

      {err && (
        <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2 mb-3">
          {err}
        </div>
      )}

      {!list || list.length === 0 ? (
        <div className="text-xs text-slate-400 text-center py-4">
          배정된 면접관이 없습니다.
        </div>
      ) : (
        <ul className="space-y-2">
          {list.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2"
            >
              <div className="text-sm">
                <span className="font-medium text-slate-900">
                  {a.userName ?? `User #${a.userId}`}
                </span>
                <span className="text-xs text-slate-500 ml-2">
                  {a.userEmail}
                </span>
              </div>
              <button
                onClick={() => remove(a.id)}
                className="text-xs text-ink-soft hover:text-danger hover:underline transition-colors"
              >
                해제
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}


function EmailSentBadge({ sentAt }: { sentAt: string | null | undefined }) {
  if (!sentAt) return null;
  const days = Math.floor((Date.now() - new Date(sentAt).getTime()) / 86_400_000);
  const tone =
    days >= 14
      ? "bg-danger-soft text-danger border-danger/30"
      : days >= 7
        ? "bg-warning-soft text-warning border-warning/30"
        : "bg-primary-soft text-primary-deep border-primary/30";
  const label = days === 0 ? "오늘 면접메일 발송" : `면접메일 ${days}일 전 발송`;
  return (
    <span
      className={`text-[11px] px-2 py-0.5 rounded-md border ${tone}`}
      title={new Date(sentAt).toLocaleString("ko-KR")}
    >
      📧 {label}
    </span>
  );
}

function EditCandidateButton({
  candidate,
  onSaved,
}: {
  candidate: Candidate;
  onSaved: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(candidate.name);
  const [email, setEmail] = useState(candidate.email ?? "");
  const [phone, setPhone] = useState(candidate.phone ?? "");
  const [eduSchool, setEduSchool] = useState(candidate.educationSchool ?? "");
  const [eduMajor, setEduMajor] = useState(candidate.educationMajor ?? "");
  const [eduLevel, setEduLevel] = useState(candidate.educationLevel ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    setBusy(true);
    setErr("");
    const r = await fetch(`/api/candidates/${candidate.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        educationSchool: eduSchool.trim() || null,
        educationMajor: eduMajor.trim() || null,
        educationLevel: eduLevel.trim() || null,
      }),
    });
    setBusy(false);
    if (!r.ok) {
      setErr(await r.text());
      return;
    }
    setOpen(false);
    await onSaved();
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-[11px] px-2 py-0.5 rounded-md border border-slate-300 hover:bg-slate-100 text-slate-600"
        title="이름·이메일·연락처·최종학력 수정"
      >
        ✎ 정보 수정
      </button>
      {open && (
        <div
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-slate-900">후보자 정보 수정</h3>
            <div className="mt-4 space-y-3 text-sm">
              <Field label="이름" value={name} onChange={setName} />
              <Field
                label="이메일"
                value={email}
                onChange={setEmail}
                type="email"
              />
              <Field label="연락처" value={phone} onChange={setPhone} />
              <div className="pt-1 border-t border-slate-100">
                <span className="text-xs font-medium text-slate-500">최종학력</span>
              </div>
              <Field label="학교" value={eduSchool} onChange={setEduSchool} />
              <Field label="전공/학과" value={eduMajor} onChange={setEduMajor} />
              <Field
                label="학력 (예: 학사 졸업, 석사)"
                value={eduLevel}
                onChange={setEduLevel}
              />
            </div>
            {err && (
              <div className="text-xs text-danger mt-2">{err}</div>
            )}
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setOpen(false)}
                className="flex-1 px-4 py-2 rounded-lg border border-slate-300 text-sm"
              >
                취소
              </button>
              <button
                onClick={submit}
                disabled={busy || name.trim().length === 0}
                className="flex-1 px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-white text-sm font-medium disabled:opacity-50"
              >
                {busy ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
      />
    </label>
  );
}
