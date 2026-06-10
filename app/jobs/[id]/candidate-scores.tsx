"use client";

import { compositeScore } from "@/lib/utils";
import { STAGE_LABELS, STAGE_WAITER } from "@/lib/stage-meta";
import type { Candidate } from "./types";

function shortenError(msg: string | null): string {
  if (!msg) return "";
  // 흔한 패턴을 짧고 친화적인 문구로 치환
  if (/503|Service Unavailable|overloaded/i.test(msg)) return "AI 서버 일시 과부하";
  if (/429|quota|rate/i.test(msg)) return "AI 호출 한도 초과";
  if (/timeout|ETIMEDOUT|ECONNRESET|fetch failed/i.test(msg)) return "AI 응답 지연";
  if (/JSON|parse/i.test(msg)) return "AI 응답 형식 오류";
  if (/API key|GOOGLE_API_KEY|GOOGLE_CLOUD_PROJECT|GOOGLE_APPLICATION_CREDENTIALS|UNAUTHENTICATED|invalid key|PERMISSION_DENIED/i.test(msg))
    return "API 키 / 서비스계정 설정 문제 — 관리자 확인 필요";
  if (/스캔 PDF OCR을 활성화|OCR을 활성화/.test(msg)) return "스캔 PDF — OCR 활성화 필요";
  if (/마스킹|텍스트 없음/.test(msg)) return "이력서 텍스트 추출 실패";
  return msg.length > 60 ? msg.slice(0, 60) + "…" : msg;
}

export function CandidateScores({ c }: { c: Candidate }) {
  // 파싱 전(분석 중) — 활성 큐인데 아직 텍스트 추출·마스킹이 안 끝난 상태.
  // 업로드 직후 껍데기 카드가 이 상태로 뜬다 (이름은 파일명 기반).
  if (
    (c.queueStatus === "queued" || c.queueStatus === "processing") &&
    !c.parsed
  ) {
    return (
      <div className="shrink-0 px-2.5 py-1 rounded-md bg-sky-50 text-sky-700 border border-sky-200 text-xs font-medium flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" />
        분석 중
      </div>
    );
  }
  if (c.queueStatus === "queued") {
    // 백오프(재시도 대기 중)면 직전 오류 사유 표시
    const isBackoff = c.queueAttempts >= 1 && !!c.lastError;
    return (
      <div className="shrink-0 flex flex-col items-end gap-1">
        <div
          className={
            "px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 " +
            (isBackoff
              ? "bg-orange-50 text-orange-700 border border-orange-200"
              : "bg-amber-50 text-amber-700")
          }
          title={isBackoff ? c.lastError ?? "" : undefined}
        >
          <span
            className={
              "w-1.5 h-1.5 rounded-full " +
              (isBackoff ? "bg-orange-500" : "bg-amber-500")
            }
          />
          {isBackoff ? `재시도 대기 (${c.queueAttempts}회 시도)` : "대기중"}
        </div>
        {isBackoff && (
          <span className="text-[10px] text-orange-600 max-w-[180px] truncate">
            {shortenError(c.lastError)}
          </span>
        )}
      </div>
    );
  }
  if (c.queueStatus === "processing") {
    return (
      <div className="shrink-0 px-2.5 py-1 rounded-md bg-primary-soft text-primary-deep text-xs font-medium flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
        평가중
      </div>
    );
  }
  // 잔액 0 이하로 일시정지 — 충전되면 워커가 자동 재개 (재시도 버튼 불필요).
  if (c.lastJobStatus === "paused") {
    return (
      <div
        className="shrink-0 px-2.5 py-1 rounded-md bg-amber-50 text-amber-700 border border-amber-200 text-xs font-medium flex items-center gap-1.5"
        title="토큰 잔액이 부족해 평가가 보류되었습니다. 충전하면 자동으로 재개됩니다."
      >
        💳 충전 대기
      </div>
    );
  }
  if (c.lastJobStatus === "failed") {
    return (
      <div className="shrink-0 flex flex-col items-end gap-1">
        <div
          className="px-2.5 py-1 rounded-md bg-danger-soft text-danger border border-danger/30 text-xs font-medium"
          title={c.lastError ?? "오류 사유 정보 없음"}
        >
          평가 실패
        </div>
        {c.lastError && (
          <span className="text-[10px] text-danger max-w-[200px] truncate">
            {shortenError(c.lastError)}
          </span>
        )}
        <span className="text-[10px] text-slate-400">
          체크 후 재평가로 다시 시도
        </span>
      </div>
    );
  }

  const composite = compositeScore(c.screeningScore, c.latestInterviewScore);
  const showComposite = c.latestInterviewScore != null;
  const interview = interviewBadge(c.latestInterviewStatus);

  return (
    <div className="shrink-0 grid grid-cols-3 gap-1.5 sm:gap-3 text-center min-w-[108px] sm:min-w-[200px]">
      <ScoreBlock label="서류" score={c.screeningScore} accent="slate" />
      <ScoreBlock
        label="면접"
        score={c.latestInterviewScore}
        placeholder={interview}
        accent="slate"
      />
      <ScoreBlock
        label="종합"
        score={showComposite ? composite : null}
        accent="blue"
      />
    </div>
  );
}

function ScoreBlock({
  label,
  score,
  placeholder,
  accent,
}: {
  label: string;
  score: number | null;
  placeholder?: { text: string; bg: string };
  accent: "slate" | "blue";
}) {
  const isBlue = accent === "blue";
  return (
    <div className="flex flex-col items-center">
      <span className="text-[10px] text-slate-500 uppercase tracking-wider">
        {label}
      </span>
      {score != null ? (
        <span
          className={`text-base sm:text-xl font-bold leading-tight ${
            isBlue ? "text-primary" : "text-slate-900"
          }`}
        >
          {score}
        </span>
      ) : placeholder ? (
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded mt-0.5 ${placeholder.bg}`}
        >
          {placeholder.text}
        </span>
      ) : (
        <span className="text-slate-300 text-xl font-bold leading-tight">-</span>
      )}
    </div>
  );
}

const OUTCOME_LABELS: Record<NonNullable<Candidate["outcome"]>, string> = {
  hired: "최종합격",
  rejected: "불합격",
  withdrawn: "지원취소",
};

// 서류평가 상태 라벨 — 카드 배지(CandidateScores)와 동일한 판정. 검색용.
function screeningStatusLabel(c: Candidate): string | null {
  if (
    (c.queueStatus === "queued" || c.queueStatus === "processing") &&
    !c.parsed
  )
    return "분석 중";
  if (c.queueStatus === "queued")
    return c.queueAttempts >= 1 && c.lastError ? "재시도 대기" : "대기중";
  if (c.queueStatus === "processing") return "평가중";
  if (c.lastJobStatus === "paused") return "충전 대기";
  if (c.lastJobStatus === "failed") return "평가 실패";
  return null;
}

// 카드에 드러나는 전형·태그·결과·점수·상태를 검색 대상에 포함. (이름/이메일 등은 기존 haystack)
// 예: "비추천", "서류평가", "면접 진행 결정 대기", "불합격", "평가 실패", "68" 검색 가능.
export function candidateSearchExtras(c: Candidate): string {
  const composite =
    c.latestInterviewScore != null
      ? compositeScore(c.screeningScore, c.latestInterviewScore)
      : null;
  return [
    STAGE_LABELS[c.stage], // 전형: "서류평가" 등
    STAGE_WAITER[c.stage]?.label, // 태그: "면접 진행 결정 대기" 등
    c.screeningReport?.recommendation, // 결과 태그: "강력추천"/"추천"/"보류"/"비추천"
    c.outcome ? OUTCOME_LABELS[c.outcome] : "진행 중", // 결과: "불합격"/"진행 중" 등
    c.screeningScore != null ? `서류 ${c.screeningScore}` : null, // 점수
    c.latestInterviewScore != null ? `면접 ${c.latestInterviewScore}` : null,
    composite != null ? `종합 ${composite}` : null,
    screeningStatusLabel(c), // 서류 상태: "분석 중"/"평가중"/"평가 실패" 등
    `면접 ${interviewBadge(c.latestInterviewStatus).text}`, // 면접 상태: "미시작" 등
  ]
    .filter(Boolean)
    .join(" ");
}

function interviewBadge(status: Candidate["latestInterviewStatus"]): {
  text: string;
  bg: string;
} {
  switch (status) {
    case "pending":
      return { text: "발급됨", bg: "bg-surface-alt text-ink-soft" };
    case "in_progress":
      return { text: "진행중", bg: "bg-warning-soft text-warning" };
    case "completed":
      return { text: "평가중", bg: "bg-primary-soft text-primary-deep" };
    case "expired":
      return { text: "만료", bg: "bg-danger-soft text-danger" };
    default:
      return { text: "미시작", bg: "bg-surface-alt text-ink-muted" };
  }
}
