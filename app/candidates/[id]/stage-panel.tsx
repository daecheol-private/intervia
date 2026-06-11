"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { formatKstDateTime } from "@/lib/utils";
import { STAGE_LABELS as STAGE_LABELS_SHARED } from "@/lib/stage-meta";
import { confirmDialog } from "@/app/components/Dialog";
import { ScheduleProposeModal } from "@/app/components/ScheduleProposeModal";
import { ScheduleManualModal } from "@/app/components/ScheduleManualModal";
import { Modal } from "./shared";
import type { Candidate } from "./types";

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

export function StageBadge({ stage }: { stage: string }) {
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
  ai_link_expired: "AI면접 링크 만료 (응시 기한 경과 — AI 평가 결과 아님)",
  schedule_link_expired: "1차 면접 일정 링크 만료",
  resume_unfit: "서류 부적합",
  ai_interview_unfit: "AI면접 평가 부적합",
  round1_unfit: "1차 면접 부적합",
  round2_unfit: "2차 면접 부적합",
  offer_declined: "처우협의 결렬",
  passed_final: "최종 합격 결정",
  other: "기타",
};

export function OutcomeBadge({
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

export function StagePanel({
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
  onChanged: () => void | Promise<void>;
  showFullResume: boolean;
  setShowFullResume: (v: boolean) => void;
  rescreening: boolean;
  screeningPhase: "not_started" | "in_queue" | "done" | "failed";
  screeningActive: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [rescreenBusy, setRescreenBusy] = useState(false);
  const [open, setOpen] = useState<
    null | "decide" | "stage" | "notify" | "schedule" | "schedule2" | "manual1" | "manual2"
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
    if (!r.ok) {
      setRescreenBusy(false);
      setMsg({ kind: "err", text: await r.text() });
      return;
    }
    setMsg({ kind: "ok", text: "재평가를 시작했습니다. 잠시 후 결과가 갱신됩니다." });
    // load 완료까지 busy 스피너("요청 중…")를 유지한 뒤 해제 → 그 사이 서버가 rescreening=true 를
    // 반영하므로 "평가 진행 중…" 표시로 끊김 없이 인계된다(버튼이 잠깐 평범한 "재평가"로 깜빡이는 공백 제거).
    // 이후 부모의 폴링(useEffect)이 4초마다 자동 갱신해 완료 시 점수가 자동 반영된다.
    await onChanged();
    setRescreenBusy(false);
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
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              평가 진행 중...
            </span>
          ) : (
            <button
              onClick={() => void rescreen()}
              disabled={rescreenBusy}
              title="공고/평가 가이드 수정 후, 오류 복구, 또는 결과 재확인 시 다시 평가합니다"
              className="shrink-0 whitespace-nowrap text-xs px-3 py-1.5 max-sm:py-2.5 rounded-md border border-blue-300 text-blue-600 hover:bg-blue-50 disabled:opacity-50 inline-flex items-center justify-center gap-1"
            >
              {rescreenBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
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
            {(candidate.stage === "round1_candidate" ||
              candidate.stage === "round1_scheduling") && (
              <button
                onClick={() => setOpen("manual1")}
                disabled={busy}
                className="shrink-0 whitespace-nowrap text-xs px-3 py-1.5 max-sm:py-2.5 rounded-md border border-accent-deep/40 text-accent-deep hover:bg-accent-soft font-medium disabled:opacity-50 transition-colors"
                title="전화 등으로 이미 협의된 1차 면접 시간을 메일 제시 없이 바로 확정 등록합니다"
              >
                📝 1차 일정 직접 입력
              </button>
            )}
            {candidate.stage === "round1_passed" && (
              <>
                <button
                  onClick={() => setOpen("schedule2")}
                  disabled={busy}
                  className="shrink-0 whitespace-nowrap text-xs px-3 py-1.5 max-sm:py-2.5 rounded-md bg-accent-deep hover:bg-accent text-surface font-medium disabled:opacity-50 transition-colors"
                  title="1차 합격 후보에게 2차 면접 일정을 제시합니다"
                >
                  📅 2차 일정 제시
                </button>
                <button
                  onClick={() => setOpen("manual2")}
                  disabled={busy}
                  className="shrink-0 whitespace-nowrap text-xs px-3 py-1.5 max-sm:py-2.5 rounded-md border border-accent-deep/40 text-accent-deep hover:bg-accent-soft font-medium disabled:opacity-50 transition-colors"
                  title="전화 등으로 이미 협의된 2차 면접 시간을 메일 제시 없이 바로 확정 등록합니다"
                >
                  📝 2차 일정 직접 입력
                </button>
              </>
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

      {(open === "manual1" || open === "manual2") && (
        <ScheduleManualModal
          candidateId={candidate.id}
          candidateName={candidate.name}
          round={open === "manual2" ? "round2" : "round1"}
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
                className="flex-1 px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-white text-sm font-medium disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
              >
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
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
