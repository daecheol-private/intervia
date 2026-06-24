"use client";

import { useParams, useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Brain,
  FileText,
  Flag,
  Gauge,
  Loader2,
  type LucideIcon,
  Mail,
  Paperclip,
  Phone,
  Trash2,
  User,
  Users,
} from "lucide-react";
import {
  compositeScore,
  recommendationFromScore,
  formatKstDateTime,
} from "@/lib/utils";
import { STAGE_RANK, STAGE_WAITER, type Stage } from "@/lib/stage-meta";
import { CandidateFavoriteStar } from "@/app/components/CandidateFavoriteStar";
import { confirmDialog, notify } from "@/app/components/Dialog";
import { AppealsPanel } from "./appeals-panel";
import { AttachmentsPanel } from "./attachments-panel";
import { EditCandidateButton } from "./edit-candidate";
import {
  InterviewEvaluationPending,
  InterviewEvaluationRetry,
  InterviewLinkBox,
  InterviewResult,
  TranscriptModal,
} from "./interview-section";
import { InterviewQuestionsPanel } from "./question-sheet";
import {
  BreakdownBars,
  BulletBlock,
  FitHexagon,
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
  displayCandidateName,
  formatPhoneKr,
  recColor,
  scoreColor,
  showRec,
} from "./shared";
import { OutcomeBadge, StagePanel } from "./stage-panel";
import { CandidateTabRail, type TabItem, type TabKey } from "./tab-rail";
import type { Candidate, Job, Schedule, Session } from "./types";

// 면접 종료 후 평가는 complete 요청 안에서 inline 생성된다(실측 약 1분, 최대 1~2분).
// 이 유예시간 안에 evaluation=null 이면 "실패"가 아니라 "생성 중"으로 본다.
const EVAL_GRACE_MS = 3 * 60 * 1000;

/** 종료됐지만 아직 평가가 생성되는 중일 가능성이 높은 세션인지 (유예시간 내). */
function evalLikelyRunning(s: Session | undefined): boolean {
  if (!s || s.status !== "completed" || s.evaluation || !s.completedAt)
    return false;
  return Date.now() - Date.parse(s.completedAt) < EVAL_GRACE_MS;
}

export default function CandidateDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [data, setData] = useState<{
    candidate: Candidate;
    job: Job;
    companyName?: string | null;
    jobTraitProfile?: Record<string, string> | null;
    orgCoreCompetencies?: string[] | null;
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
  const [tab, setTab] = useState<TabKey>("overview");
  // 세로 탭 레일 — 상단 탭바가 사라졌는지 감지(sentinel)해 노출 여부 판정.
  const tabBarRef = useRef<HTMLDivElement>(null);
  // 비동기 fetch 탭(1차/2차/첨부)은 한 번 열면 언마운트하지 않고 숨겨 유지 —
  // 재방문 시 재fetch·빈화면 깜빡임 없음(스크롤 위치도 보존).
  const [visitedTabs, setVisitedTabs] = useState<Set<TabKey>>(
    () => new Set<TabKey>()
  );
  useEffect(() => {
    setVisitedTabs((v) => (v.has(tab) ? v : new Set(v).add(tab)));
  }, [tab]);
  // 탭 전환 시 항상 "점수 상단 + 세로레일 보이는" 위치로 정렬(초기 진입 제외).
  // 콘텐츠 경계(sentinel)를 고정 헤더(액션바, 모바일은 +상단바) 바로 아래로 스크롤 →
  // 가로 탭바가 액션바 뒤로 완전히 숨고 세로 레일이 노출됨. 액션바 높이는 실측.
  const tabAnchorRef = useRef<HTMLDivElement>(null);
  const actionBarRef = useRef<HTMLDivElement>(null);
  // 세로 레일로 탭을 바꿀 때만 초기 위치로 정렬한다(상단 가로 탭 클릭은 스크롤 이동 없음).
  const scrollOnTabChange = useRef(false);
  useEffect(() => {
    if (!scrollOnTabChange.current) return;
    scrollOnTabChange.current = false;
    const anchor = tabAnchorRef.current;
    if (!anchor) return;
    const isLg = window.matchMedia("(min-width: 1024px)").matches;
    const stickyTop = isLg ? 0 : 56; // 모바일 상단바(h-14)
    const abH = actionBarRef.current?.getBoundingClientRect().height ?? 56;
    // 고정 헤더 바로 아래에서 20px 더 내려 가로 탭바를 완전히 숨기고 세로 레일을 노출.
    const target =
      window.scrollY +
      anchor.getBoundingClientRect().top -
      (stickyTop + abH) +
      20;
    window.scrollTo({ top: Math.max(0, target) });
  }, [tab]);

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
    // 백그라운드 탭에서는 폴링 스킵(무거운 응답) — 복귀 시 visibilitychange 가 즉시 재개.
    const t = setTimeout(() => {
      if (document.visibilityState === "visible") void load();
    }, 4000);
    const onVis = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.screeningPhase, data?.rescreening, data?.candidate]);

  // AI 면접 평가가 inline 생성 중인 구간이면 완료/유예만료까지 폴링 → 자동으로 결과 반영.
  // (completedSession 은 아래에서 계산되므로 여기선 data 에서 직접 파생 — 훅 순서 보존.)
  useEffect(() => {
    const cs = data?.sessions?.find((s) => s.status === "completed");
    if (!evalLikelyRunning(cs)) return;
    // 백그라운드 탭에서는 폴링 스킵 — 복귀 시 visibilitychange 가 즉시 재개.
    const t = setTimeout(() => {
      if (document.visibilityState === "visible") void load();
    }, 4000);
    const onVis = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

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
    // 면접 링크 발송으로 온보딩 step4(AI 면접 보내기)가 충족됨 — 플로팅 가이드가
    // 새로고침 없이 즉시 완료 표시되도록 진행 상태 재조회를 요청.
    if (typeof window !== "undefined")
      window.dispatchEvent(new Event("intervia:setup-progress-refresh"));
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
          <div className="rounded-lg border border-border-default bg-card p-6 text-center">
            <div className="text-ink-soft font-medium">삭제된 후보자입니다.</div>
            <div className="mt-1 text-sm text-ink-muted">
              이 후보자는 더 이상 존재하지 않습니다.
            </div>
            <button
              onClick={() => router.back()}
              className="mt-4 px-4 py-2 rounded-lg border border-border-strong text-sm hover:bg-surface-alt"
            >
              뒤로 가기
            </button>
          </div>
        </main>
      );
    if (loadError === "failed")
      return (
        <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="rounded-lg border border-danger/40 bg-danger-soft p-6 text-center">
            <div className="text-danger font-medium">불러오기에 실패했습니다.</div>
            <div className="mt-1 text-sm text-danger">
              네트워크 상태를 확인하고 다시 시도해 주세요.
            </div>
            <button
              onClick={() => {
                setLoadError(null);
                void load();
              }}
              className="mt-4 px-4 py-2 rounded-lg border border-danger/40 text-sm text-danger hover:bg-danger-soft"
            >
              다시 시도
            </button>
          </div>
        </main>
      );
    return (
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8 text-ink-muted">
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
  // 라운드별 활성 일정(확정/대기/역제시) — 각 "N차 면접" 섹션 안에서 표시.
  // 같은 라운드에 여러 건이면 가장 최근(id 큰) 것.
  const activeScheduleForRound = (round: "round1" | "round2") =>
    (schedules ?? [])
      .filter(
        (s) =>
          s.round === round &&
          (s.status === "selected" ||
            s.status === "pending" ||
            s.status === "counter_proposed")
      )
      .sort((a, b) => b.id - a.id)[0] ?? null;
  const round1Schedule = activeScheduleForRound("round1");
  const round2Schedule = activeScheduleForRound("round2");
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

  // 탭 활성화 — 해당 전형이 진행돼야 콘텐츠가 생긴다(안 되면 disable).
  const candidateRank = STAGE_RANK[candidate.stage as Stage] ?? 0;
  const hasAiInterview = sessions.length > 0;
  const hasRound1 =
    candidateRank >= STAGE_RANK.round1_candidate || !!round1Schedule;
  const hasRound2 =
    candidateRank >= STAGE_RANK.round1_passed || !!round2Schedule;

  // 상단 가로 탭 + 좌측 세로 레일이 공유하는 단일 탭 정의(불일치 방지).
  const tabItems: TabItem[] = [
    { key: "overview", label: "종합평가", Icon: Gauge, on: true, hint: "" },
    { key: "screening", label: "서류평가", Icon: FileText, on: true, hint: "" },
    {
      key: "ai",
      label: "AI 면접",
      Icon: Brain,
      on: hasAiInterview,
      hint: "AI 면접 진행 후 활성화됩니다",
    },
    {
      key: "round1",
      label: "1차 면접",
      Icon: User,
      on: hasRound1,
      hint: "1차 면접 단계부터 활성화됩니다",
    },
    {
      key: "round2",
      label: "2차 면접",
      Icon: Users,
      on: hasRound2,
      hint: "1차 합격 후 활성화됩니다",
    },
    { key: "files", label: "첨부파일", Icon: Paperclip, on: true, hint: "" },
  ];

  // 진행단계 스테퍼 — 후보자의 현재 위치를 5단계로. 종결(불합격/취소)도 반영.
  const isHired = candidate.outcome === "hired";
  const isTerminated =
    candidate.outcome === "rejected" || candidate.outcome === "withdrawn";
  const effRank = isHired ? 100 : candidateRank;
  const STEPS: {
    label: string;
    min: number;
    max: number;
    Icon: LucideIcon;
  }[] = [
    { label: "서류평가", min: 10, max: 20, Icon: FileText },
    { label: "AI 면접", min: 30, max: 40, Icon: Brain },
    { label: "1차 면접", min: 50, max: 70, Icon: User },
    { label: "2차 면접", min: 80, max: 80, Icon: Users },
    { label: "종결", min: 100, max: 100, Icon: Flag },
  ];
  const waiterLabel = STAGE_WAITER[candidate.stage as Stage]?.label ?? null;

  // 종합평가 종합 소견 — 전형이 진행될수록 가장 최근(상위) 평가 요약으로 갱신.
  // (서류 → AI 면접 → … 순으로 더 최신 소견이 전체 인상을 대표)
  const overviewSummary =
    completedSession?.evaluation?.summary ??
    (screeningPhase === "done"
      ? candidate.screeningReport?.summary ?? null
      : null);

  return (
    // 토론 채팅 패널이 열리면 CandidateChat 이 --iv-chat-shift 를 음수 px 로 설정해
    // 본문을 왼쪽 여백만큼 민다(채팅창 가림 완화). transform 이 아니라 relative+left 로 미는 건
    // transform 이 자손 fixed(드로어·모달)의 기준을 viewport→본문으로 바꿔 깨뜨리기 때문.
    <main
      data-iv-shiftable
      style={{ left: "var(--iv-chat-shift, 0px)" }}
      className="relative max-w-5xl mx-auto w-full px-4 sm:px-6 py-6 transition-[left] duration-300 ease-out motion-reduce:transition-none"
    >
      <Link
        href={`/jobs/${job.id}`}
        className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
      >
        <span aria-hidden>←</span> {job.title}
      </Link>

      {/* Header — 프로필 카드 (정보 + 진행단계). 액션 바는 아래 sticky 로 분리. */}
      <div className="bg-card border border-border-default rounded-t-2xl border-b-0 shadow-sm mt-3">
        <div className="p-6">
        <div className="flex justify-between items-start gap-4">
          <div className="flex items-start gap-4 min-w-0 flex-1">
            {candidate.photoFilePath ? (
              // 이력서에서 추출한 증명사진(표시 전용). 깨지면 onError 로 이니셜 폴백.
              <img
                src={`/api/uploads/candidate/${candidate.id}/photo`}
                alt=""
                aria-hidden
                className="w-20 h-20 shrink-0 rounded-full object-cover bg-surface-alt"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                  e.currentTarget.nextElementSibling?.classList.remove("hidden");
                }}
              />
            ) : null}
            <div
              className={`w-20 h-20 shrink-0 rounded-full bg-surface-alt text-ink-soft flex items-center justify-center text-2xl font-bold ${candidate.photoFilePath ? "hidden" : ""}`}
              aria-hidden
            >
              {displayCandidateName(candidate.name).trim().charAt(0).toUpperCase() || "?"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-bold text-ink">
                  {displayCandidateName(candidate.name)}
                </h1>
                {candidate.outcome && (
                  <OutcomeBadge outcome={candidate.outcome} reason={candidate.outcomeReason} />
                )}
                {candidate.screeningReport?.recommendation &&
                  showRec(candidate.screeningReport.recommendation) && (
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded-md border ${recColor[candidate.screeningReport.recommendation]}`}
                    >
                      AI {candidate.screeningReport.recommendation}
                    </span>
                  )}
                <EmailSentBadge sentAt={candidate.lastInterviewEmailSentAt} />
              </div>
              {candidate.careerSummary && (
                <p className="mt-1.5 text-sm text-ink-soft leading-snug">
                  {candidate.careerSummary}
                </p>
              )}
              {/* 연락처·이메일 — 아이콘 + 값 (라벨 없이). 이메일이 길어도 줄 전체를
                  쓰도록 라벨 그리드에서 분리. 좁은 화면에선 이메일이 다음 줄로 래핑. */}
              {(formatPhoneKr(candidate.phone) || candidate.email) && (
                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-ink-soft">
                  {formatPhoneKr(candidate.phone) && (
                    <span className="inline-flex items-center gap-1.5">
                      <Phone className="w-4 h-4 shrink-0 text-ink-muted" aria-hidden />
                      <span>{formatPhoneKr(candidate.phone)}</span>
                    </span>
                  )}
                  {candidate.email && (
                    <span className="inline-flex items-center gap-1.5 min-w-0">
                      <Mail className="w-4 h-4 shrink-0 text-ink-muted" aria-hidden />
                      <span className="truncate" title={candidate.email}>
                        {candidate.email}
                      </span>
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <EditCandidateButton
              candidate={candidate}
              onSaved={load}
              variant="icon"
            />
            <CandidateFavoriteStar
              candidateId={candidate.id}
              initial={candidate.favorited ?? false}
              size="md"
              framed
              onToggle={() => void load()}
            />
            <button
              onClick={handleDelete}
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-border-strong text-ink-soft hover:border-danger/50 hover:text-danger hover:bg-danger-soft transition-colors"
              title="후보자 삭제"
              aria-label="후보자 삭제"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
        {/* 기본 정보 — 사진 컬럼 아래 전체 너비로 빼, 진행바·버튼과 좌측 시작점 정렬 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 mt-4">
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
          <InfoCell
            label="경력"
            value={candidate.careerYears != null ? `${candidate.careerYears}년` : null}
          />
          <InfoCell
            label="나이"
            value={candidate.age != null ? `${candidate.age}세` : null}
          />
          <InfoCell
            label="지원일"
            value={formatKstDateTime(candidate.createdAt)}
          />
        </div>
        </div>
        {/* 진행 단계 (컴팩트) — 액션 버튼 영역 위 */}
        <div className="border-t border-border-default px-6 py-3 flex items-center gap-x-3 gap-y-2 text-[11px] flex-wrap">
          <div className="flex items-center gap-1.5">
            {STEPS.map((s, i) => {
              const done = effRank > s.max;
              const current =
                !isTerminated && effRank >= s.min && effRank <= s.max;
              return (
                <Fragment key={s.label}>
                  {i > 0 && (
                    <span
                      className={`h-0.5 w-4 sm:w-7 rounded-full ${effRank >= s.min ? "bg-primary" : "bg-border-default"}`}
                      aria-hidden
                    />
                  )}
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`grid place-items-center w-6 h-6 rounded-full shrink-0 ${
                        done
                          ? "bg-primary text-white"
                          : current
                            ? "bg-primary text-white ring-2 ring-primary/30 ring-offset-2 ring-offset-card"
                            : "bg-surface-alt text-ink-muted"
                      }`}
                    >
                      <s.Icon className="w-3.5 h-3.5" strokeWidth={2.4} />
                    </span>
                    <span
                      className={`whitespace-nowrap ${current ? "font-semibold text-primary-deep" : done ? "text-ink-soft" : "text-ink-muted"}`}
                    >
                      {s.label}
                    </span>
                  </span>
                </Fragment>
              );
            })}
          </div>
          {!isTerminated && waiterLabel && (
            <span className="sm:ml-auto shrink-0 text-[10px] text-primary-deep bg-primary-soft rounded-full px-2 py-0.5">
              {waiterLabel}
            </span>
          )}
          {isTerminated && (
            <span className="sm:ml-auto shrink-0 text-[10px] font-medium text-danger">
              종결 — {candidate.outcome === "rejected" ? "불합격" : "지원취소"}
            </span>
          )}
        </div>
      </div>
      {/* 액션 바 — sticky: 스크롤해도 상단 고정돼 언제든 단계 변경·종결 가능.
          위 헤더 카드(border-b-0 rounded-t)와 시각적으로 한 카드처럼 붙는다.
          마스킹 전체보기를 펼치면 길어져 고정을 해제한다. */}
      <div
        ref={actionBarRef}
        className={showFullResume ? "" : "sticky top-14 lg:top-0 z-30"}
      >
        <div className="bg-card border border-border-default rounded-b-2xl shadow-sm px-6 py-3">
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
      </div>

      {/* Tabs — 안 된 전형 탭은 disable. overflow-x-auto 는 (overflow-y 도 auto 가 돼)
          활성탭 밑줄 1px 가 세로 스크롤바를 유발하므로 제거. 좁은 화면은 wrap 으로 처리. */}
      <div
        ref={tabBarRef}
        className="mt-5 border-b border-border-default flex flex-wrap gap-1"
      >
        {tabItems.map((t) => (
          <button
            key={t.key}
            type="button"
            disabled={!t.on}
            onClick={() => t.on && setTab(t.key)}
            aria-current={tab === t.key ? "page" : undefined}
            title={!t.on ? t.hint : undefined}
            className={
              "inline-flex items-center gap-1.5 px-3.5 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors " +
              (!t.on
                ? "border-transparent text-ink-muted/40 cursor-not-allowed"
                : tab === t.key
                  ? "border-primary text-primary-deep font-semibold"
                  : "border-transparent text-ink-soft hover:text-ink")
            }
          >
            <t.Icon className="w-4 h-4 shrink-0" />
            {t.label}
          </button>
        ))}
      </div>

      {/* 스크롤로 상단 탭이 사라지면 좌측 거터에 뜨는 세로 탭 레일(데스크톱·여백 충분할 때만) */}
      <CandidateTabRail
        items={tabItems}
        current={tab}
        onSelect={(k) => {
          if (k === tab) return;
          scrollOnTabChange.current = true;
          setTab(k);
        }}
        sentinelRef={tabBarRef}
      />

      {/* 탭 전환 스크롤 기준점 — 탭바와 콘텐츠 경계(위 effect 가 여기로 스크롤). */}
      <div ref={tabAnchorRef} aria-hidden />

      {/* ── 종합평가 — 스코어카드 + 진행단계 + 6축 차트 ── */}
      {tab === "overview" && (
        <div className="mt-4 space-y-4 min-h-[calc(100vh-2rem)]">
          <div className="bg-card border border-border-default rounded-2xl shadow-sm p-6">
            <div className="flex flex-col lg:flex-row gap-6">
              {/* 좌: 종합 스코어(+서류/면접 우측 인라인) + 종합 소견 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start gap-6 flex-wrap">
                  <div>
                    <div className="text-[11px] font-bold text-ink-muted uppercase tracking-wider">
                      종합 평가
                    </div>
                    <div className="flex items-baseline gap-1.5 mt-1">
                      <span
                        className={`text-5xl font-bold tabular-nums ${composite != null ? scoreColor(composite) : "text-ink-muted"}`}
                      >
                        {composite != null ? composite : "-"}
                      </span>
                      <span className="text-sm text-ink-muted">/100</span>
                      {rec && showRec(rec) && (
                        <span
                          className={`ml-1 text-[11px] font-semibold px-2 py-0.5 rounded-md border ${recColor[rec]}`}
                        >
                          {rec}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex-1 min-w-[180px] max-w-xs space-y-2 pt-2">
                    <ScoreBar label="서류" score={candidate.screeningScore} />
                    <ScoreBar label="면접" score={interviewScore} />
                  </div>
                </div>

                {/* 종합 소견 — 전형 진행에 따라 최신 평가 기준으로 갱신 */}
                <div className="mt-5">
                  {overviewSummary ? (
                    <p className="text-sm text-ink-soft leading-relaxed">
                      <HL text={overviewSummary} />
                    </p>
                  ) : (
                    <p className="text-sm text-ink-soft leading-relaxed">
                      {screeningPhase === "in_queue"
                        ? "⏳ 서류 평가가 진행 중입니다."
                        : screeningPhase === "failed"
                          ? "서류 평가에 실패했습니다. 이력서 평가 탭에서 재시도할 수 있습니다."
                          : "평가가 진행되면 종합 소견이 여기에 표시됩니다."}
                    </p>
                  )}
                </div>
              </div>

              {/* 우: 6축 적합도 차트 — 중앙 정렬 */}
              {candidate.screeningReport?.breakdown &&
                screeningPhase === "done" && (
                  <div className="lg:w-[330px] shrink-0 lg:border-l lg:border-border-default lg:pl-6 flex flex-col">
                    <div className="text-[11px] font-bold text-ink-muted uppercase tracking-wider mb-1">
                      공고 적합도 (6축)
                    </div>
                    <div className="flex-1 flex items-center justify-center">
                      <FitHexagon
                        breakdown={candidate.screeningReport.breakdown}
                      />
                    </div>
                  </div>
                )}
            </div>
          </div>
        </div>
      )}

      {/* ── 이력서 평가 ── */}
      {tab === "screening" && (
        <div className="mt-4 space-y-4">

      {/* Screening — 타이틀 없이 본문만 (점수+요약으로 시작) */}
      <div className="bg-card border border-border-default rounded-2xl shadow-sm p-6">
        {screeningPhase === "skipped" ? (
          <div className="space-y-4">
            <div className="text-sm bg-surface-alt border border-border-default text-ink-soft rounded-lg p-3 leading-relaxed">
              <strong className="text-ink">
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
              className="px-5 py-2 rounded-lg border border-border-strong text-ink-soft hover:bg-surface-alt text-sm font-medium disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
            >
              {screening && <Loader2 className="w-4 h-4 animate-spin" />}
              {screening ? "요청 중..." : "AI 검토 요청"}
            </button>
          </div>
        ) : screeningPhase === "not_started" ? (
          <div className="space-y-4">
            <div className="text-sm bg-warning-soft border border-warning/40 text-warning rounded-lg p-3">
              <strong>AI 평가가 시작되지 않았습니다.</strong> 보통 업로드 직후 자동으로 시작됩니다.
              잔액이 부족하거나 마스킹 텍스트가 없으면 여기 멈춥니다.
              아래 마스킹을 확인 후 "AI 검토 요청"으로 수동 시작할 수 있습니다.
            </div>

            <div>
              <div className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
                마스킹된 텍스트 (LLM 입력)
              </div>
              <pre className="p-3 border rounded-lg text-xs whitespace-pre-wrap max-h-[60vh] overflow-y-auto font-mono bg-surface-alt border-border-default text-ink-soft">
                {candidate.resumeMaskedText ?? ""}
              </pre>
              <div className="text-xs text-ink-muted mt-1">
                마스킹 {(candidate.resumeMaskedText ?? "").length.toLocaleString()}자
                {!candidate.resumeMaskedText && (
                  <span className="ml-2 text-warning">
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
              className="px-5 py-2 rounded-lg bg-primary hover:bg-primary-deep text-surface text-sm font-medium disabled:opacity-50 shadow-sm inline-flex items-center justify-center gap-1.5"
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
            <div className="text-sm bg-warning-soft border border-warning/40 text-warning rounded-lg p-3 space-y-1">
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
                <span className="block text-xs text-ink-muted mt-1">
                  사유: {data.screeningError}
                </span>
              )}
            </div>
          )
        ) : candidate.screeningReport ? (
          <div className="space-y-4 text-sm" data-tour="screening-report">
            <div className="flex items-baseline gap-3">
              <div
                className={`text-5xl font-bold tabular-nums ${scoreColor(
                  candidate.screeningReport.score,
                )}`}
              >
                {candidate.screeningReport.score}
              </div>
              <span className="text-base text-ink-muted font-medium">/ 100</span>
              {showRec(candidate.screeningReport.recommendation) && (
                <span
                  className={`ml-auto text-xs font-semibold px-2.5 py-1 rounded-md border ${recColor[candidate.screeningReport.recommendation]}`}
                >
                  {candidate.screeningReport.recommendation}
                </span>
              )}
            </div>
            <blockquote className="border-l-4 border-primary/40 bg-primary-soft/30 px-4 py-3 rounded-r-lg text-ink leading-relaxed">
              <HL text={candidate.screeningReport.summary} />
            </blockquote>
            {candidate.screeningReport.breakdown && (
              <BreakdownBars breakdown={candidate.screeningReport.breakdown} />
            )}
            {candidate.screeningReport.requirement_gate && (
              <RequirementGateBadge
                gate={candidate.screeningReport.requirement_gate}
              />
            )}
            {candidate.screeningReport.level_match &&
              candidate.screeningReport.level_match.fit !== "fit" && (
                <LevelMatchBadge match={candidate.screeningReport.level_match} />
              )}
            {candidate.screeningReport.requirement_coverage &&
              candidate.screeningReport.requirement_coverage.length > 0 && (
                <RequirementCoverageBlock
                  coverage={candidate.screeningReport.requirement_coverage}
                />
              )}
            <div className="grid md:grid-cols-2 gap-4">
              <BulletBlock
                title="강점"
                items={candidate.screeningReport.strengths}
                color="emerald"
                emphasizeLead
                emphasis
              />
              <BulletBlock
                title="우려"
                items={candidate.screeningReport.concerns}
                color="amber"
                emphasizeLead
                emphasis
              />
            </div>
            {candidate.screeningReport.qualitative_review &&
              candidate.screeningReport.qualitative_review.length > 0 && (
                <QualitativeReviewBlock
                  review={candidate.screeningReport.qualitative_review}
                />
              )}
            <div>
              <div className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
                매칭 키워드
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {candidate.screeningReport.matched_keywords.map((k) => (
                  <span
                    key={k}
                    className="text-xs px-2 py-0.5 bg-surface-alt text-ink-soft rounded-md"
                  >
                    {k}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-ink-muted">평가 데이터 없음</div>
        )}
      </div>
        </div>
      )}

      {/* ── AI 면접 — 타이틀·구분선 없이 본문만 (서류평가 탭과 동일 구조) ── */}
      {tab === "ai" && (
        <div className="mt-4 space-y-4">
      <div className="bg-card border border-border-default rounded-2xl shadow-sm p-6">
        {!activeSession && (
          <div className="text-center py-8">
            <div className="text-3xl mb-3">💬</div>
            {aiStagePassed ? (
              <p className="text-sm text-ink-muted">
                AI 면접 전형이 종료되었습니다. 이미 다음 전형으로 진행된
                후보자에게는 AI 면접 링크를 생성할 수 없습니다.
              </p>
            ) : candidate.screeningReport || screeningPhase === "skipped" ? (
              <>
                <p className="text-sm text-ink-soft mb-4">
                  아직 면접이 진행되지 않았습니다.
                </p>
                <button
                  data-tour="ai-interview-btn"
                  onClick={createLink}
                  disabled={creating}
                  className="px-5 py-2 rounded-lg bg-primary hover:bg-primary-deep text-surface text-sm font-medium disabled:opacity-50 shadow-sm inline-flex items-center justify-center gap-1.5"
                >
                  {creating && <Loader2 className="w-4 h-4 animate-spin" />}
                  {creating ? "처리 중..." : "AI면접 요청"}
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-ink-soft mb-2">
                  AI 서류평가가 완료되어야 면접 링크를 생성할 수 있습니다.
                </p>
                <p className="text-xs text-ink-muted mb-4">
                  {screeningPhase === "in_queue"
                    ? "현재 서류평가가 진행 중입니다. 잠시만 기다려 주세요."
                    : screeningPhase === "failed"
                    ? "서류평가가 실패했습니다. 위에서 평가를 재시도해 주세요."
                    : "위에서 AI 서류평가를 먼저 실행해 주세요."}
                </p>
                <button
                  disabled
                  className="px-5 py-2 rounded-lg bg-surface-alt text-ink-muted text-sm font-medium cursor-not-allowed"
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
            orgCoreCompetencies={data.orgCoreCompetencies ?? null}
            onShowTranscript={() => setShowTranscript(true)}
            onRegenerate={createLink}
            disabled={aiStagePassed}
          />
        )}
        {completedSession &&
          !completedSession.evaluation &&
          (evalLikelyRunning(completedSession) ? (
            // 종료 직후 ~ 평가 완료 전: "실패" 대신 "생성 중" + 재평가 버튼 미노출.
            <InterviewEvaluationPending
              onShowTranscript={() => setShowTranscript(true)}
            />
          ) : (
            // 유예시간이 지나도 evaluation 이 없으면 실제 실패 → 재평가 허용.
            <InterviewEvaluationRetry
              sessionId={completedSession.id}
              onShowTranscript={() => setShowTranscript(true)}
              onSuccess={load}
            />
          ))}
      </div>
        </div>
      )}

      {/* ── 1차 면접 — 스케줄·문제·녹음 평가 ── */}
      {(tab === "round1" || visitedTabs.has("round1")) && (
        <div
          className={`mt-4 space-y-4 min-h-[calc(100vh-2rem)] ${tab === "round1" ? "" : "hidden"}`}
        >
          <InterviewQuestionsPanel
            candidateId={candidate.id}
            round="round1"
            scheduleConfirmed={round1Confirmed}
            schedule={round1Schedule}
            jobId={candidate.jobId}
            candidateName={candidate.name}
            onScheduleChanged={load}
            canModify={!candidate.outcome}
          />
        </div>
      )}

      {/* ── 2차 면접 — 스케줄·문제·녹음 평가 ── */}
      {(tab === "round2" || visitedTabs.has("round2")) && (
        <div
          className={`mt-4 space-y-4 min-h-[calc(100vh-2rem)] ${tab === "round2" ? "" : "hidden"}`}
        >
          <InterviewQuestionsPanel
            candidateId={candidate.id}
            round="round2"
            scheduleConfirmed={round2Confirmed}
            schedule={round2Schedule}
            jobId={candidate.jobId}
            candidateName={candidate.name}
            onScheduleChanged={load}
            canModify={!candidate.outcome}
          />
        </div>
      )}

      {/* ── 첨부·이의 ── */}
      {(tab === "files" || visitedTabs.has("files")) && (
        <div
          className={`mt-4 space-y-4 min-h-[calc(100vh-2rem)] ${tab === "files" ? "" : "hidden"}`}
        >
      <AttachmentsPanel
        candidateId={candidate.id}
        screeningDone={screeningPhase === "done"}
        canModify={
          !candidate.outcome &&
          !!(candidate.resumeFilePath || candidate.resumeMaskedText)
        }
      />
      <AppealsPanel candidateId={candidate.id} />
        </div>
      )}

      {showTranscript && completedSession && (
        <TranscriptModal
          messages={completedSession.messages}
          onClose={() => setShowTranscript(false)}
        />
      )}
    </main>
  );
}
