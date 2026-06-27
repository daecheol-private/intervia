"use client";

import { memo } from "react";
import Link from "next/link";
import { ExternalLink, MessageSquare } from "lucide-react";

import { formatKstDateTime } from "@/lib/utils";
import { CandidateScores } from "./candidate-scores";
import {
  HL,
  OutcomeBadge,
  RecBadge,
  StageBadge,
  WaitBadge,
  dimIfClosed,
  stageGroupBorder,
} from "./badges";
import type { Candidate } from "./types";

// 카드 전체가 <Link>라 같은 탭으로 이동한다. 이 버튼은 Link 바깥(형제)에 두고
// 새 탭을 백그라운드로 연다. 행 hover 시에만 나타나 평소엔 점수 영역을 가리지 않음.
// window.open 은 항상 새 탭으로 포커스를 옮기므로(전경), 브라우저가 백그라운드 탭을
// 여는 유일한 경로인 Ctrl/⌘+클릭을 합성해 <a> 에 dispatch 한다 (Chrome/Edge 기준).
function OpenInNewTabButton({ candidateId }: { candidateId: number }) {
  return (
    <button
      type="button"
      title="새 탭(백그라운드)에서 열기"
      aria-label="새 탭(백그라운드)에서 열기"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);
        const a = document.createElement("a");
        a.href = `/candidates/${candidateId}`;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.dispatchEvent(
          new MouseEvent("click", {
            ctrlKey: !isMac,
            metaKey: isMac,
            bubbles: false,
            cancelable: true,
            view: window,
          })
        );
      }}
      className="absolute right-2 top-2 z-10 rounded-md border border-border-default bg-card/90 p-1.5 text-ink-muted shadow-sm backdrop-blur transition opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-primary hover:border-primary/40 focus:outline-none"
    >
      <ExternalLink className="w-4 h-4" />
    </button>
  );
}

// 면접관 토론 배지 — 코멘트가 있으면 표시. 내가 안 읽은 남의 글이 있으면 그 개수를 빨강(강조)으로,
// 다 읽었으면 전체 개수를 회색으로. 안읽음 수는 서버 읽음선 기준이라 기기 무관하게 정확하다.
function CommentBadge({
  count,
  unread,
}: {
  count: number;
  unread: number;
}) {
  if (count <= 0) return null;
  const hasUnread = unread > 0;
  return (
    <span
      title={hasUnread ? `읽지 않은 토론 코멘트 ${unread}개` : "면접관 토론 코멘트"}
      className={`inline-flex items-center gap-0.5 text-[10px] rounded-md px-1.5 py-0.5 leading-none tabular-nums ${
        hasUnread
          ? "bg-danger text-surface font-semibold"
          : "bg-surface-alt text-ink-muted border border-border-default"
      }`}
    >
      <MessageSquare className="w-3 h-3" strokeWidth={2} />
      {hasUnread ? (unread > 99 ? "99+" : unread) : count > 99 ? "99+" : count}
    </span>
  );
}

// 카드 외곽(배경·테두리)만 섹션별로 다름. 즐겨찾기=amber, 1차 후보=forest(강조), 기본=중립.
// 그 외 내부 마크업은 세 섹션이 동일하다.
const VARIANT_CLASS = {
  favorite: "bg-card border-2 border-warning/60",
  round1: "bg-card border-2 border-primary/40",
  default: "bg-card border border-border-default",
} as const;

type Props = {
  c: Candidate;
  variant?: keyof typeof VARIANT_CLASS;
  selected: boolean;
  onToggleSelect: (id: number) => void;
};

function CandidateCardImpl({
  c,
  variant = "default",
  selected,
  onToggleSelect,
}: Props) {
  return (
    <li className="relative group">
      <div
        className="absolute left-3 top-4 z-10"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(c.id)}
          className="rounded border-border-strong"
        />
      </div>
      <OpenInNewTabButton candidateId={c.id} />
      <Link
        href={`/candidates/${c.id}`}
        className={`card-hover ${VARIANT_CLASS[variant]} rounded-xl p-4 pl-10 flex flex-col block ${stageGroupBorder(c.stage, c.outcome)} ${dimIfClosed(c.outcome)}`}
      >
        <div className="flex justify-between items-start gap-2 sm:gap-4 w-full">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            {/* 이력서에서 추출한 증명사진(표시 전용). 없으면 이니셜 아바타로 폴백해 정렬 유지. */}
            <div className="shrink-0">
              {c.photoFilePath ? (
                <img
                  src={`/api/uploads/candidate/${c.id}/photo`}
                  alt=""
                  aria-hidden
                  className="w-14 h-14 rounded-full object-cover bg-surface-alt"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                    e.currentTarget.nextElementSibling?.classList.remove("hidden");
                  }}
                />
              ) : null}
              <div
                className={`w-14 h-14 rounded-full bg-surface-alt text-ink-soft flex items-center justify-center text-lg font-bold ${c.photoFilePath ? "hidden" : ""}`}
                aria-hidden
              >
                {c.name.trim().charAt(0).toUpperCase() || "?"}
              </div>
            </div>
            <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-ink">{c.name}</span>
              {c.outcome !== "hired" && <StageBadge stage={c.stage} />}
              {c.outcome ? (
                <OutcomeBadge outcome={c.outcome} />
              ) : (
                <WaitBadge c={c} />
              )}
              {c.outcome === "rejected" &&
                c.decisionEmailCount === 0 &&
                c.email && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning-soft text-warning border border-warning/30 font-medium">
                    📭 통보 미발송
                  </span>
                )}
              {c.screeningReport && (
                <RecBadge rec={c.screeningReport.recommendation} />
              )}
              <CommentBadge count={c.commentCount} unread={c.unreadCommentCount} />
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-muted mt-1.5">
              {c.careerYears != null && <span>경력 {c.careerYears}년</span>}
              {c.age != null && <span>{c.age}세</span>}
              {(c.educationLevel || c.educationSchool || c.educationMajor) && (
                <span className="text-ink-soft">
                  {[c.educationSchool, c.educationMajor, c.educationLevel]
                    .filter(Boolean)
                    .join(" ")}
                </span>
              )}
              {c.phone && <span>{c.phone}</span>}
              {c.email && <span>{c.email}</span>}
            </div>
            {c.careerSummary && (
              <p className="text-xs text-ink-soft mt-1">{c.careerSummary}</p>
            )}
            </div>
          </div>
          <CandidateScores c={c} />
        </div>
        {c.screeningReport?.summary && (
          <p className="text-sm text-ink-soft mt-2 bg-surface-alt border border-border-default rounded-lg px-3 py-2">
            <HL text={c.screeningReport.summary} />
          </p>
        )}
        <div className="text-[11px] text-ink-muted mt-1">
          {formatKstDateTime(c.createdAt)} 업로드
        </div>
      </Link>
    </li>
  );
}

// 폴링·검색·선택 토글로 부모가 리렌더돼도, 같은 후보(c 참조 동일) + 같은 선택상태면
// 카드를 재렌더하지 않는다. c 는 candidatesList 원소라 목록이 실제로 갱신되지 않는 한
// 참조가 유지되므로(검색/필터/정렬은 파생), 후보 수백 명에서도 카드 재렌더가 안 일어난다.
export const CandidateCard = memo(CandidateCardImpl);
