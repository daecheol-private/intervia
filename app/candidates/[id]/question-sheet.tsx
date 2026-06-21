"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { formatKstDateTime } from "@/lib/utils";
import { HL, Section } from "./shared";
import {
  RecordedInterviewPanel,
  completedRecordedSummary,
} from "./recorded-interview-section";
import { ScheduleBox } from "./schedule-box";
import type { Schedule } from "./types";

// ── 대면 면접 질문지 (1차 실무 / 2차 임원) ──────────────────────────
// 해당 라운드 면접 일정 확정 후 면접관 누구나 생성. 이후 팝업으로 열람.
// 2차는 법인 컬쳐핏·인재상 기준(설정 시)을 중심 축으로 생성된다.
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
  // 백그라운드 생성 상태 — null=생성 이력 없음. generating 동안 폴링, ready 면 sheet 노출.
  status: "generating" | "ready" | "failed" | null;
  error?: string | null;
  sheet: {
    questions: QuestionSheet;
    basedOnScreening: boolean;
    basedOnInterview: boolean;
    basedOnCultureFit: boolean;
    generatedByName: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
};

export function InterviewQuestionsPanel({
  candidateId,
  scheduleConfirmed,
  round = "round1",
  canModify = true,
  schedule = null,
  jobId,
  candidateName,
  onScheduleChanged,
}: {
  candidateId: number;
  scheduleConfirmed: boolean;
  round?: "round1" | "round2";
  canModify?: boolean;
  // 이 라운드의 활성 면접 일정(확정/대기/역제시) — 섹션 안에 표시. 없으면 null.
  schedule?: Schedule | null;
  jobId: number;
  candidateName: string;
  // 일정 확정·재제안 등으로 일정이 바뀌면 부모(후보자 페이지) 데이터를 다시 불러온다.
  onScheduleChanged?: () => void;
}) {
  const [data, setData] = useState<QuestionSheetResp | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // 이 라운드 대면 평가 완료 메타(모드·길이·일시) 또는 null — 자식(RecordedInterviewPanel)이 콜백으로
  // 올려준다. 완료됐으면 면접은 이미 끝나 평가까지 나온 시점이라 준비용 "면접 문제 생성" UI는 숨기고,
  // 이 메타를 섹션 요약("대면 평가 완료 · …")에 덧붙인다.
  const [recordedSummary, setRecordedSummary] = useState<string | null>(null);
  const recordedDone = recordedSummary !== null;
  // 펼치기 전에 대면 평가 완료 여부를 판정했는지. Section 이 접힘 상태에서 자식(RecordedInterviewPanel)을
  // 언마운트해, 펼치는 순간 자식 fetch 로만 판정하면 일정·문제생성이 잠깐 떴다 사라진다. 일정 미확정
  // 라운드는 완료가 불가능하므로 곧장 판정 완료(true)로 둔다.
  const [recordedChecked, setRecordedChecked] = useState(!scheduleConfirmed);

  const isExec = round === "round2";
  const roundNo = isExec ? "2차" : "1차";
  const apiUrl = `/api/candidates/${candidateId}/interview-questions?round=${round}`;

  const load = async () => {
    const r = await fetch(apiUrl);
    if (r.ok) setData(await r.json());
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateId, round]);

  // 대면 평가 완료 여부 사전 조회 — 이 컴포넌트의 effect 는 Section 접힘과 무관하게 마운트 시 돌아,
  // 펼치기 전에 recordedSummary 를 채워 깜빡임을 없앤다. (자식 RecordedInterviewPanel 은 펼칠 때
  // 마운트돼 라이브 갱신만 담당.) 완료가 가능한 '일정 확정' 라운드만 조회.
  useEffect(() => {
    if (!scheduleConfirmed) {
      setRecordedChecked(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(
          `/api/candidates/${candidateId}/recorded-interview`
        );
        if (cancelled) return;
        if (r.ok) {
          const body = (await r.json()) as {
            interviews: Array<{
              round: "round1" | "round2";
              mode: "upload" | "live";
              status: string;
              durationSeconds: number;
              createdAt: string;
            }>;
          };
          setRecordedSummary(completedRecordedSummary(body.interviews, round));
        }
      } finally {
        if (!cancelled) setRecordedChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [candidateId, round, scheduleConfirmed]);

  const sheet = data?.sheet ?? null;
  const status = data?.status ?? null;
  const generating = status === "generating";
  const failed = status === "failed";

  // 생성 중이면 완료(ready/failed)까지 폴링 — 페이지를 닫거나 새로고침/재방문해도
  // 백그라운드 생성이 끝나면 자동으로 질문지가 반영된다 (사용자가 새로고침할 필요 없음).
  useEffect(() => {
    if (!generating) return;
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
  }, [generating, data]);

  const generate = async () => {
    setSubmitting(true);
    setErr(null);
    try {
      const r = await fetch(apiUrl, { method: "POST" });
      if (!r.ok) {
        setErr(await r.text());
        return;
      }
      // 202 — 백그라운드 생성 시작. 즉시 상태 재조회 → generating 으로 바뀌고 폴링이 인계.
      await load();
    } catch {
      setErr("네트워크 오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  // 게이트는 부모가 내려주는 일정 확정 상태를 신뢰 — 일정 확정 직후
  // 페이지 새로고침 없이 즉시 "면접 문제 생성" 버튼이 활성화되도록.
  // (자체 GET 의 scheduleConfirmed 는 마운트 시점 값이라 stale 가능)
  const confirmed = scheduleConfirmed;
  // 생성 이력(generating/ready/failed)이 있으면 일정 미확정이어도 패널 본문을 보여준다.
  const hasRow = status !== null;

  return (
    <Section
      title={isExec ? "2차 면접" : "1차 면접"}
      defaultOpen={false}
      summary={
        recordedDone ? (
          <span className="text-success">
            대면 평가 완료{recordedSummary ? ` · ${recordedSummary}` : ""}
          </span>
        ) : schedule?.status === "selected" && schedule.selectedSlot ? (
          <span className="flex items-center gap-2">
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-primary-soft text-primary-deep border border-primary/30">
              확정
            </span>
            <span className="text-ink-soft">
              {formatKstDateTime(schedule.selectedSlot.start)}
            </span>
            <span className="text-ink-muted">
              · {schedule.modeOnline ? "온라인" : "오프라인"}
            </span>
          </span>
        ) : schedule?.status === "counter_proposed" ? (
          <span className="text-warning">🔄 후보자 대안 일정 제안</span>
        ) : schedule?.status === "pending" ? (
          <span className="text-warning">⏳ 후보자 응답 대기</span>
        ) : generating ? (
          <span className="text-primary-deep">⏳ 생성 중</span>
        ) : sheet ? (
          <span className="text-primary-deep">생성됨 · 클릭하여 열람</span>
        ) : failed ? (
          <span className="text-danger">생성 실패 · 재시도</span>
        ) : confirmed ? (
          <span className="text-ink-muted">생성 가능</span>
        ) : (
          <span className="text-ink-muted">{roundNo} 일정 확정 후 활성화</span>
        )
      }
    >
      {!confirmed && !hasRow && !recordedDone && !schedule && (
        <div className="text-center py-6">
          <div className="text-3xl mb-3">📝</div>
          <p className="text-sm text-ink-soft mb-1">
            {roundNo} 면접 일정이 확정되면 면접 문제를 생성할 수 있습니다.
          </p>
          <p className="text-xs text-ink-muted">
            {isExec
              ? "법인 인재상·컬쳐핏 기준(설정 시)을 반영해 임원 면접용 질문지를 만듭니다."
              : "이력서 · 서류평가 · AI 면접 평가를 종합해 맞춤 질문지를 만듭니다."}
          </p>
        </div>
      )}

      {(confirmed || hasRow || recordedDone || schedule) && (
        <div className="space-y-4">
          {/* 면접 일정 — 같은 라운드. 대면 평가가 완료되면(면접 종료) 숨긴다. */}
          {schedule && recordedChecked && !recordedDone && (
            <div className="space-y-3">
              <div className="text-sm font-semibold text-ink-soft">면접 일정</div>
              <ScheduleBox
                schedule={schedule}
                jobId={jobId}
                candidateId={candidateId}
                candidateName={candidateName}
                onChanged={() => onScheduleChanged?.()}
              />
            </div>
          )}

          {/* 면접 문제 생성 (준비용 질문지) — 일정 확정(또는 기존 생성 이력) 후, 대면 평가 완료 전까지. */}
          {recordedChecked && !recordedDone && (confirmed || hasRow) && (
            <div
              className={`space-y-4${
                schedule ? " pt-4 mt-2 border-t border-border-default" : ""
              }`}
            >
              <div className="text-sm font-semibold text-ink-soft">
                면접 문제 생성
              </div>
              <p className="text-sm text-ink-soft">
                {isExec
                  ? "이력서 · 서류평가 · AI 면접 평가에 법인 인재상·컬쳐핏 기준(설정 시)을 반영해 2차(임원) 면접용 질문지를 생성합니다. 면접관 누구나 생성·열람할 수 있습니다."
                  : "이력서 · 서류평가 · AI 면접 평가를 종합해 1차 대면 면접용 맞춤 질문지를 생성합니다. 면접관 누구나 생성·열람할 수 있습니다."}
              </p>

              {sheet && (
                <div className="flex items-center gap-2 flex-wrap text-[11px]">
                  <span className="px-2 py-0.5 rounded-md border bg-primary-soft text-primary-deep border-primary/30">
                    {sheet.basedOnScreening ? "서류평가 반영" : "서류평가 없음"}
                  </span>
                  <span className="px-2 py-0.5 rounded-md border bg-accent-soft text-accent-deep border-accent/30">
                    {sheet.basedOnInterview ? "AI면접 평가 반영" : "AI면접 평가 없음"}
                  </span>
                  {sheet.basedOnCultureFit && (
                    <span className="px-2 py-0.5 rounded-md border bg-success-soft text-success border-success/30">
                      컬쳐핏 기준 반영
                    </span>
                  )}
                  <span className="text-ink-muted">
                    {sheet.generatedByName ? `${sheet.generatedByName} · ` : ""}
                    {formatKstDateTime(sheet.updatedAt)} 생성
                  </span>
                </div>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                {generating ? (
                  // 백그라운드 생성 중 — 새로고침/재방문해도 폴링이 이어받아 자동 반영.
                  <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-surface-alt text-primary-deep text-sm font-medium">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    생성 중... (최대 1분 · 새로고침해도 됩니다)
                  </span>
                ) : sheet ? (
                  <button
                    onClick={() => setOpen(true)}
                    className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-surface text-sm font-medium shadow-sm"
                  >
                    면접 문제 보기
                  </button>
                ) : (
                  // 생성 전이거나 실패 시 노출. 성공(ready) 후에는 "보기" 로 바뀌어
                  // 재생성 버튼을 숨긴다 (무료 기능 — 불필요한 재생성 비용 방지).
                  <button
                    onClick={generate}
                    disabled={submitting}
                    className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 inline-flex items-center justify-center gap-1.5 bg-primary hover:bg-primary-deep text-surface shadow-sm"
                  >
                    {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                    {submitting ? "요청 중..." : failed || err ? "재생성" : "면접 문제 생성"}
                  </button>
                )}
              </div>

              {(err || (failed && data?.error)) && (
                <p className="text-sm text-danger">{err ?? data?.error}</p>
              )}
            </div>
          )}

          {/* 대면 면접 평가 — 같은 라운드(녹음 업로드 / 라이브 + 평가 결과). 완료 시 위 일정·"면접 문제 생성"은 숨고 이 평가 리포트만 남는다. 일정만 대기(미확정)인 동안엔 업로드 영역을 띄우지 않는다. */}
          {(confirmed || hasRow || recordedDone) && (
            <RecordedInterviewPanel
              candidateId={candidateId}
              round={round}
              canModify={canModify}
              onCompletedChange={setRecordedSummary}
            />
          )}
        </div>
      )}

      {open && sheet && (
        <QuestionSheetModal
          title={isExec ? "2차(임원) 면접 질문지" : "1차 면접 질문지"}
          sheet={sheet.questions}
          exec={isExec}
          onClose={() => setOpen(false)}
        />
      )}
    </Section>
  );
}

// 임원용(exec)은 큰 글씨 + 형광펜 하이라이트 + "요점만 보기"(질문 위주) 기본 ON.
function QuestionSheetModal({
  title,
  sheet,
  exec = false,
  onClose,
}: {
  title: string;
  sheet: QuestionSheet;
  exec?: boolean;
  onClose: () => void;
}) {
  const [compact, setCompact] = useState(exec);
  const body = exec ? "text-base" : "text-sm";
  const sub = exec ? "text-sm" : "text-xs";
  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 flex items-stretch sm:items-start justify-center overflow-y-auto p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-none sm:rounded-2xl shadow-xl w-full max-w-4xl min-h-full sm:min-h-0 sm:my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center gap-3 px-6 py-4 border-b border-border-default sticky top-0 bg-card rounded-t-none sm:rounded-t-2xl z-10">
          <h3 className={`${exec ? "text-lg" : "text-base"} font-bold text-ink`}>
            {title}
          </h3>
          <div className="flex items-center gap-3 shrink-0">
            <label className="flex items-center gap-1.5 text-xs text-ink-soft cursor-pointer select-none">
              <input
                type="checkbox"
                checked={compact}
                onChange={(e) => setCompact(e.target.checked)}
                className="accent-primary"
              />
              요점만 보기
            </label>
            <button
              onClick={onClose}
              className="text-ink-muted hover:text-ink-soft text-xl leading-none"
              aria-label="닫기"
            >
              ×
            </button>
          </div>
        </div>
        <div className="px-6 py-5 space-y-6">
          {sheet.strategy && (
            <div
              className={`border-l-4 border-primary/40 bg-primary-soft/30 px-4 py-3 rounded-r-lg ${body} text-ink leading-relaxed`}
            >
              <div className="text-[11px] font-semibold text-primary-deep uppercase tracking-wider mb-1">
                면접 전략
              </div>
              <HL text={sheet.strategy} mark={exec} />
            </div>
          )}

          {sheet.sections.map((sec, si) => (
            <div key={si}>
              <h4 className={`${body} font-bold text-ink`}>
                {si + 1}. {sec.title}
              </h4>
              {sec.focus && !compact && (
                <p className={`${sub} text-ink-muted mt-0.5 mb-3`}>
                  <HL text={sec.focus} mark={exec} />
                </p>
              )}
              <ol className={`space-y-3 ${compact ? "mt-2" : ""}`}>
                {sec.questions.map((q, qi) => (
                  <li
                    key={qi}
                    className="rounded-lg border border-border-default px-4 py-3"
                  >
                    <p
                      className={`${body} text-ink font-medium leading-relaxed`}
                    >
                      <HL text={q.question} mark={exec} />
                    </p>
                    {q.intent && !compact && (
                      <p className={`${sub} text-ink-muted mt-1.5`}>
                        🎯 <HL text={q.intent} mark={exec} />
                      </p>
                    )}
                    {q.followups && q.followups.length > 0 && !compact && (
                      <ul className="mt-2 space-y-1 pl-3 border-l-2 border-border-default">
                        {q.followups.map((f, fi) => (
                          <li key={fi} className={`${sub} text-ink-soft`}>
                            ↳ <HL text={f} mark={exec} />
                          </li>
                        ))}
                      </ul>
                    )}
                    {q.basis && !compact && (
                      <p
                        className={`${exec ? "text-xs" : "text-[11px]"} text-ink-muted mt-2`}
                      >
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
                  <li key={ri} className={`${body} text-ink-soft`}>
                    ⚠️ <HL text={r} mark={exec} />
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
