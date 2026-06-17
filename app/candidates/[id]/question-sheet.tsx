"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { formatKstDateTime } from "@/lib/utils";
import { HL, Section } from "./shared";
import { RecordedInterviewPanel } from "./recorded-interview-section";

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
}: {
  candidateId: number;
  scheduleConfirmed: boolean;
  round?: "round1" | "round2";
  canModify?: boolean;
}) {
  const [data, setData] = useState<QuestionSheetResp | null>(null);
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

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

  const generate = async () => {
    setGenerating(true);
    setErr(null);
    try {
      const r = await fetch(apiUrl, { method: "POST" });
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
  // 게이트는 부모가 내려주는 일정 확정 상태를 신뢰 — 일정 확정 직후
  // 페이지 새로고침 없이 즉시 "면접 문제 생성" 버튼이 활성화되도록.
  // (자체 GET 의 scheduleConfirmed 는 마운트 시점 값이라 stale 가능)
  const confirmed = scheduleConfirmed;

  return (
    <Section
      title={isExec ? "2차 면접" : "1차 면접"}
      defaultOpen={false}
      summary={
        sheet ? (
          <span className="text-primary-deep">생성됨 · 클릭하여 열람</span>
        ) : confirmed ? (
          <span className="text-slate-500">생성 가능</span>
        ) : (
          <span className="text-slate-400">{roundNo} 일정 확정 후 활성화</span>
        )
      }
    >
      {!confirmed && !sheet && (
        <div className="text-center py-6">
          <div className="text-3xl mb-3">📝</div>
          <p className="text-sm text-slate-600 mb-1">
            {roundNo} 면접 일정이 확정되면 면접 문제를 생성할 수 있습니다.
          </p>
          <p className="text-xs text-slate-500">
            {isExec
              ? "법인 인재상·컬쳐핏 기준(설정 시)을 반영해 임원 면접용 질문지를 만듭니다."
              : "이력서 · 서류평가 · AI 면접 평가를 종합해 맞춤 질문지를 만듭니다."}
          </p>
        </div>
      )}

      {(confirmed || sheet) && (
        <div className="space-y-4">
          <div className="text-sm font-semibold text-slate-700">
            면접 문제 생성
          </div>
          <p className="text-sm text-slate-600">
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
              <span className="text-slate-400">
                {sheet.generatedByName ? `${sheet.generatedByName} · ` : ""}
                {formatKstDateTime(sheet.updatedAt)} 생성
              </span>
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            {sheet ? (
              <button
                onClick={() => setOpen(true)}
                className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-white text-sm font-medium shadow-sm"
              >
                면접 문제 보기
              </button>
            ) : (
              // 생성 전이거나, 오류로 생성에 실패했을 때만 노출.
              // 성공 생성 후에는 재생성 버튼을 숨긴다 (무료 기능 — 불필요한 재생성 비용 방지).
              <button
                onClick={generate}
                disabled={generating}
                className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 inline-flex items-center justify-center gap-1.5 bg-primary hover:bg-primary-deep text-white shadow-sm"
              >
                {generating && <Loader2 className="w-4 h-4 animate-spin" />}
                {generating
                  ? "생성 중... (최대 1분)"
                  : err
                    ? "재생성"
                    : "면접 문제 생성"}
              </button>
            )}
          </div>

          {err && <p className="text-sm text-danger">{err}</p>}

          {/* 대면 면접 평가 — 같은 라운드(녹음 업로드 / 라이브 + 평가 결과) */}
          <RecordedInterviewPanel
            candidateId={candidateId}
            round={round}
            canModify={canModify}
          />
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
      className="fixed inset-0 z-50 bg-slate-900/40 flex items-stretch sm:items-start justify-center overflow-y-auto p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-none sm:rounded-2xl shadow-xl w-full max-w-4xl min-h-full sm:min-h-0 sm:my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center gap-3 px-6 py-4 border-b border-slate-100 sticky top-0 bg-white rounded-t-none sm:rounded-t-2xl z-10">
          <h3 className={`${exec ? "text-lg" : "text-base"} font-bold text-slate-900`}>
            {title}
          </h3>
          <div className="flex items-center gap-3 shrink-0">
            <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
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
              className="text-slate-400 hover:text-slate-700 text-xl leading-none"
              aria-label="닫기"
            >
              ×
            </button>
          </div>
        </div>
        <div className="px-6 py-5 space-y-6">
          {sheet.strategy && (
            <div
              className={`border-l-4 border-primary/40 bg-primary-soft/30 px-4 py-3 rounded-r-lg ${body} text-slate-800 leading-relaxed`}
            >
              <div className="text-[11px] font-semibold text-primary-deep uppercase tracking-wider mb-1">
                면접 전략
              </div>
              <HL text={sheet.strategy} mark={exec} />
            </div>
          )}

          {sheet.sections.map((sec, si) => (
            <div key={si}>
              <h4 className={`${body} font-bold text-slate-900`}>
                {si + 1}. {sec.title}
              </h4>
              {sec.focus && !compact && (
                <p className={`${sub} text-slate-500 mt-0.5 mb-3`}>
                  <HL text={sec.focus} mark={exec} />
                </p>
              )}
              <ol className={`space-y-3 ${compact ? "mt-2" : ""}`}>
                {sec.questions.map((q, qi) => (
                  <li
                    key={qi}
                    className="rounded-lg border border-slate-200 px-4 py-3"
                  >
                    <p
                      className={`${body} text-slate-800 font-medium leading-relaxed`}
                    >
                      <HL text={q.question} mark={exec} />
                    </p>
                    {q.intent && !compact && (
                      <p className={`${sub} text-slate-500 mt-1.5`}>
                        🎯 <HL text={q.intent} mark={exec} />
                      </p>
                    )}
                    {q.followups && q.followups.length > 0 && !compact && (
                      <ul className="mt-2 space-y-1 pl-3 border-l-2 border-slate-100">
                        {q.followups.map((f, fi) => (
                          <li key={fi} className={`${sub} text-slate-600`}>
                            ↳ <HL text={f} mark={exec} />
                          </li>
                        ))}
                      </ul>
                    )}
                    {q.basis && !compact && (
                      <p
                        className={`${exec ? "text-xs" : "text-[11px]"} text-slate-400 mt-2`}
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
                  <li key={ri} className={`${body} text-slate-700`}>
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
