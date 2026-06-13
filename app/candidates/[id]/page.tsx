"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import {
  compositeScore,
  recommendationFromScore,
  formatKstDateTime,
} from "@/lib/utils";
import { STAGE_RANK, type Stage } from "@/lib/stage-meta";
import { CandidateFavoriteStar } from "@/app/components/CandidateFavoriteStar";
import { confirmDialog, notify } from "@/app/components/Dialog";
import { AppealsPanel } from "./appeals-panel";
import { AttachmentsPanel } from "./attachments-panel";
import { EditCandidateButton } from "./edit-candidate";
import {
  InterviewEvaluationRetry,
  InterviewLinkBox,
  InterviewResult,
  TranscriptModal,
} from "./interview-section";
import { InterviewerNotesPanel } from "./notes-panel";
import { InterviewQuestionsPanel } from "./question-sheet";
import { ScheduleBox } from "./schedule-box";
import {
  BreakdownBlock,
  BulletBlock,
  LevelMatchBadge,
  QualitativeReviewBlock,
  RequirementCoverageBlock,
  RequirementGateBadge,
} from "./screening-report";
import {
  EmailSentBadge,
  HL,
  InfoCell,
  ScoreBar,
  Section,
  displayCandidateName,
  formatPhoneKr,
  recColor,
  scoreColor,
  showRec,
} from "./shared";
import { OutcomeBadge, StageBadge, StagePanel } from "./stage-panel";
import type { Candidate, Job, Schedule, Session } from "./types";

export default function CandidateDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [data, setData] = useState<{
    candidate: Candidate;
    job: Job;
    companyName?: string | null;
    jobTraitProfile?: Record<string, string> | null;
    sessions: Session[];
    schedules: Schedule[];
    screeningPhase: "not_started" | "in_queue" | "done" | "failed" | "skipped";
    screeningError?: string | null;
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
    // 발송 결과를 사용자에게 팝업으로 알린다 — 실패해도 링크 자체는 만들어졌으므로
    // InterviewLinkBox 의 "재발송" 버튼으로 수동 재시도 가능.
    const session = (await res.json().catch(() => null)) as
      | { id: number }
      | null;
    const candidateEmail = data?.candidate.email ?? null;
    if (session?.id && candidateEmail) {
      try {
        const sendRes = await fetch(
          `/api/interview-sessions/${session.id}/send-email`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ to: candidateEmail }),
          }
        );
        if (sendRes.ok) {
          notify(`${candidateEmail} 으로 AI 면접 안내 메일을 발송했습니다.`, {
            title: "면접 링크 발송 완료",
            tone: "success",
          });
        } else {
          const sendData = (await sendRes.json().catch(() => ({}))) as {
            message?: string;
          };
          notify(
            sendData.message ??
              "면접 링크는 생성됐지만 메일 발송에 실패했습니다. 아래 '재발송' 버튼으로 다시 시도해 주세요.",
            { title: "메일 발송 실패", tone: "danger" }
          );
        }
      } catch {
        notify(
          "면접 링크는 생성됐지만 메일 발송 중 오류가 발생했습니다. 아래 '재발송' 버튼으로 다시 시도해 주세요.",
          { title: "메일 발송 실패", tone: "danger" }
        );
      }
    } else if (session?.id) {
      // 후보자 이메일이 없어 자동 발송 불가 — 링크는 생성됐음을 안내.
      notify(
        "면접 링크가 생성되었습니다. 후보자 이메일이 없어 자동 발송되지 않았으니, 아래에서 이메일을 입력해 발송해 주세요.",
        { title: "면접 링크 생성됨", tone: "info" }
      );
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
    // 백그라운드 평가 진행 중 폴링은 위 useEffect(screeningPhase==="in_queue") 가 담당.
    // 여기서 별도 setTimeout 체인을 돌리면 같은 엔드포인트를 2중 폴링하게 된다.
    void load();
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
  // 라운드별 면접 일정 확정 여부 — 면접 문제 생성 게이트.
  // 부모 data 에서 직접 계산해 InterviewQuestionsPanel 에 내려준다.
  // (패널 자체 GET 은 마운트 시점 1회뿐이라, 일정 확정 직후엔 stale → 새로고침 필요해짐)
  const round1Confirmed = (schedules ?? []).some(
    (s) => s.round === "round1" && s.status === "selected"
  );
  const round2Confirmed = (schedules ?? []).some(
    (s) => s.round === "round2" && s.status === "selected"
  );
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
          onChanged={() => load()}
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
          ) : screeningPhase === "skipped" ? (
            <span className="text-slate-500">AI 평가 안 함 · 동의 미확보</span>
          ) : (
            <span className="text-slate-400">평가 전</span>
          )
        }
      >
        {screeningPhase === "skipped" ? (
          <div className="space-y-4">
            <div className="text-sm bg-slate-50 border border-slate-200 text-slate-700 rounded-lg p-3 leading-relaxed">
              <strong className="text-slate-800">
                이력서 AI 평가 없이 진행 중입니다.
              </strong>{" "}
              지원자 동의(AI 평가 고지)를 받지 못해, 이 공고는 서류를 AI 로 평가하지
              않습니다. 이력서는 파싱·정리만 되어 있고 채용 담당자가 직접 검토합니다.
              <br />
              나중에 지원자 동의를 확보하면, 공고의{" "}
              <strong>“AI 평가 다시 켜기”</strong> 로 전환한 뒤 아래{" "}
              <strong>“AI 검토 요청”</strong> 으로 평가할 수 있습니다.
            </div>
            {screenErr && (
              <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2">
                {screenErr}
              </div>
            )}
            <button
              onClick={startScreening}
              disabled={screening}
              className="px-5 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 text-sm font-medium disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
            >
              {screening && <Loader2 className="w-4 h-4 animate-spin" />}
              {screening ? "요청 중..." : "AI 검토 요청"}
            </button>
          </div>
        ) : screeningPhase === "not_started" ? (
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
              className="px-5 py-2 rounded-lg bg-primary hover:bg-primary-deep text-white text-sm font-medium disabled:opacity-50 shadow-sm inline-flex items-center justify-center gap-1.5"
            >
              {screening && <Loader2 className="w-4 h-4 animate-spin" />}
              {screening ? "요청 중..." : "AI 검토 요청"}
            </button>
          </div>
        ) : screeningPhase === "in_queue" ? (
          <div className="flex items-center gap-2 text-sm text-primary-deep">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            AI 평가 진행 중...
          </div>
        ) : screeningPhase === "failed" ? (
          /OCR을 활성화/.test(data.screeningError ?? "") ? (
            <div className="text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 space-y-1">
              <div>
                <strong>스캔(이미지) PDF로 보여 텍스트를 추출하지 못했습니다.</strong>
              </div>
              <div>
                법인 설정 &gt; <strong>스캔 PDF OCR</strong> 을 활성화하면 평가할 수 있습니다
                (org_admin 권한 필요). 또는 텍스트가 포함된 PDF로 재업로드하세요.
              </div>
            </div>
          ) : (
            <div className="text-sm text-danger">
              서류 평가 실패. 아래 🔄 재평가 버튼으로 다시 시도하거나 이력서를 재업로드하세요.
              {data.screeningError && (
                <span className="block text-xs text-slate-500 mt-1">
                  사유: {data.screeningError}
                </span>
              )}
            </div>
          )
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
            {candidate.screeningReport.qualitative_review &&
              candidate.screeningReport.qualitative_review.length > 0 && (
                <QualitativeReviewBlock
                  review={candidate.screeningReport.qualitative_review}
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
            ) : candidate.screeningReport || screeningPhase === "skipped" ? (
              <>
                <p className="text-sm text-slate-600 mb-4">
                  아직 면접이 진행되지 않았습니다.
                </p>
                <button
                  data-tour="ai-interview-btn"
                  onClick={createLink}
                  disabled={creating}
                  className="px-5 py-2 rounded-lg bg-primary hover:bg-primary-deep text-white text-sm font-medium disabled:opacity-50 shadow-sm inline-flex items-center justify-center gap-1.5"
                >
                  {creating && <Loader2 className="w-4 h-4 animate-spin" />}
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
            jobTraitProfile={data.jobTraitProfile ?? null}
            onShowTranscript={() => setShowTranscript(true)}
            onRegenerate={createLink}
            onReevaluated={load}
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
            candidateId={candidate.id}
            candidateName={candidate.name}
            onChanged={load}
          />
        </Section>
      )}

      <InterviewQuestionsPanel
        candidateId={candidate.id}
        round="round1"
        scheduleConfirmed={round1Confirmed}
      />
      <InterviewQuestionsPanel
        candidateId={candidate.id}
        round="round2"
        scheduleConfirmed={round2Confirmed}
      />
      <AttachmentsPanel
        candidateId={candidate.id}
        screeningDone={screeningPhase === "done"}
        canModify={
          !candidate.outcome &&
          !!(candidate.resumeFilePath || candidate.resumeMaskedText)
        }
      />
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
