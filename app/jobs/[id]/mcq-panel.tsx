"use client";

/**
 * 공고 상세 — AI 면접 객관식 사전 문항 관리 (전형 단계 현황 위, 한 줄 바).
 *
 * "문제 생성" → 서버가 백그라운드(after)로 LLM 생성·자가검증 후 곧바로 저장(비동기, 기본 적용 ON).
 * 클라이언트는 폴링으로 진행을 추적하고, 완료되면 "문제 보기" + "AI 면접 적용" 토글이 보인다.
 * 새로고침해도 진행/결과가 유지된다(상태는 공고에 저장). "문제 보기" → 모달에서 정답 확인·수정
 * (보기 클릭으로 정답 변경)·불필요 문항 삭제 후 "확정" 저장. 적용 여부는 토글로만 바꾼다(문항은
 * 보존). 점수는 합불 미반영.
 *
 * - 재생성 버튼 없음: 한 번 성공하면 재생성 불가. 생성 실패 시엔 세트가 없어(count=0) "문제 생성"으로 재시도.
 * - 임시 공고(isDraft)에서는 생성 불가.
 */
import { useEffect, useRef, useState } from "react";
import { ListChecks, Trash2 } from "lucide-react";
import { Modal } from "@/app/components/Modal";
import { notify } from "@/app/components/Dialog";
import type { McqQuestion } from "@/lib/mcq";

const POLL_MS = 3000;

type McqState = {
  count: number;
  generating: boolean;
  enabled: boolean;
  /** 자가검증 불일치(정답 재확인 필요) 문항 수 */
  flagged: number;
};

export function McqPanel({
  jobId,
  disabled,
  isDraft,
}: {
  jobId: string;
  disabled?: boolean;
  isDraft?: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [flagged, setFlagged] = useState(0);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<McqQuestion[] | null>(null);
  const [saving, setSaving] = useState(false);
  // 헤더 버튼으로 여는 관리 모달. draft(검토) 가 열려 있을 때도 같은 모달을 공유한다.
  const [open, setOpen] = useState(false);

  const mounted = useRef(true);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 이 패널에서 생성을 시작했고 사용자가 페이지에 머물러 있으면, 완료 시 검토 모달 자동 오픈.
  const autoOpen = useRef(false);

  const fetchState = async (): Promise<McqState | null> => {
    try {
      const r = await fetch(`/api/jobs/${jobId}/mcq`);
      if (!r.ok) return null;
      const d = (await r.json()) as Partial<McqState>;
      return {
        count: d.count ?? 0,
        generating: !!d.generating,
        enabled: !!d.enabled,
        flagged: d.flagged ?? 0,
      };
    } catch {
      return null;
    }
  };

  const applyState = (s: McqState) => {
    setCount(s.count);
    setEnabled(s.enabled);
    setFlagged(s.flagged);
  };

  const stopPoll = () => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  };

  const schedulePoll = () => {
    stopPoll();
    pollTimer.current = setTimeout(async () => {
      if (!mounted.current) return;
      // 백그라운드 탭에서는 조회 스킵하고 다음 tick 만 예약 — 복귀하면 자동 재개.
      if (document.visibilityState !== "visible") {
        schedulePoll();
        return;
      }
      const s = await fetchState();
      if (!mounted.current) return;
      if (!s) {
        schedulePoll();
        return;
      }
      applyState(s);
      if (s.generating) {
        schedulePoll();
        return;
      }
      setGenerating(false);
      if (s.count > 0) {
        notify(`객관식 ${s.count}문항이 생성되었습니다. 검토 후 확정하세요.`, {
          tone: "success",
        });
        if (autoOpen.current) {
          autoOpen.current = false;
          void openView();
        }
      } else {
        notify("객관식 문제 생성이 완료되지 못했습니다. 다시 시도해 주세요.", {
          tone: "warn",
        });
      }
    }, POLL_MS);
  };

  useEffect(() => {
    mounted.current = true;
    void (async () => {
      const s = await fetchState();
      if (!mounted.current) return;
      if (s) {
        applyState(s);
        setGenerating(s.generating);
        if (s.generating) schedulePoll();
      }
      setLoading(false);
    })();
    return () => {
      mounted.current = false;
      stopPoll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const generate = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/jobs/${jobId}/mcq/generate`, {
        method: "POST",
      });
      if (!r.ok) {
        notify(await r.text(), { tone: "danger", title: "문제 생성 실패" });
        return;
      }
      autoOpen.current = true;
      setGenerating(true);
      schedulePoll();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), {
        tone: "danger",
        title: "문제 생성 실패",
      });
    } finally {
      setBusy(false);
    }
  };

  const openView = async () => {
    setOpen(true); // 검토를 닫으면 관리 화면으로 복귀하도록 베이스 모달을 켜 둔다
    setBusy(true);
    try {
      const r = await fetch(`/api/jobs/${jobId}/mcq`);
      if (!r.ok) {
        notify(await r.text(), { tone: "danger" });
        return;
      }
      const d = (await r.json()) as { questions: McqQuestion[] };
      setDraft(d.questions);
    } finally {
      setBusy(false);
    }
  };

  const toggleEnabled = async () => {
    const next = !enabled;
    setEnabled(next); // 낙관적 업데이트
    setBusy(true);
    try {
      const r = await fetch(`/api/jobs/${jobId}/mcq`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!r.ok) {
        setEnabled(!next);
        notify(await r.text(), { tone: "danger", title: "적용 변경 실패" });
      }
    } catch (e) {
      setEnabled(!next);
      notify(e instanceof Error ? e.message : String(e), { tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  const confirmSave = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/jobs/${jobId}/mcq`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questions: draft }),
      });
      if (!r.ok) {
        notify(await r.text(), { tone: "danger", title: "저장 실패" });
        return;
      }
      const d = (await r.json()) as { count: number };
      setCount(d.count);
      if (d.count === 0) setEnabled(false);
      // 검토·수정 결과로 불일치 수 갱신 — 보기를 눌러 정답을 고치면 verified=true 가 되어 줄어든다.
      setFlagged(draft.filter((q) => q.verified === false).length);
      setDraft(null);
      notify(
        d.count > 0
          ? `객관식 ${d.count}문항이 저장되었습니다.`
          : "문항을 모두 삭제해 객관식이 비워졌습니다.",
        { tone: "success" }
      );
    } finally {
      setSaving(false);
    }
  };

  const deleteQ = (id: string) =>
    setDraft((d) => (d ? d.filter((q) => q.id !== id) : d));

  // 정답 변경 — 보기를 눌러 정답 인덱스를 바꾼다. HR 이 직접 확인한 셈이라 불일치 경고(verified)도 해제.
  const setAnswer = (id: string, answer: number) =>
    setDraft((d) =>
      d ? d.map((q) => (q.id === id ? { ...q, answer, verified: true } : q)) : d
    );

  const flaggedCount = draft?.filter((q) => q.verified === false).length ?? 0;
  const blockedDraft = !!isDraft && count === 0;

  const btn =
    "px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed";

  const reviewing = draft != null;
  // 적용 여부를 아이콘 색으로 표현: 적용 중=포레스트 강조, 그 외(미적용·미생성)=회색, 생성 중=깜빡임.
  const active = count > 0 && enabled;
  // 자가검증 불일치 문항이 있으면(자동 생성 후 미검토 등) 경고색으로 확인 유도 — 생성 중엔 아직 결과 없음.
  const needsReview = !generating && flagged > 0;
  const triggerClass = generating
    ? "border-primary/40 text-primary-deep bg-primary-soft animate-pulse"
    : needsReview
      ? "border-warning/50 text-warning bg-warning-soft hover:bg-warning/15"
      : active
        ? "border-primary/40 text-primary-deep bg-primary-soft hover:bg-primary/15"
        : "border-border-strong text-ink-soft hover:bg-surface-alt hover:text-ink";

  // 마우스 오버 툴팁 — 이름 + 적용/미적용/확인필요 상태를 한 줄로.
  const tooltip = `역량평가${
    generating
      ? " · 생성 중"
      : count > 0
        ? needsReview
          ? ` · 정답 확인 필요 ${flagged}문항`
          : enabled
            ? " · 적용 중"
            : " · 미적용"
        : " · 미설정"
  }`;

  return (
    <>
      {/* 역량평가 — 라벨 버튼('이력서 받기' 옆). 미설정·미적용=회색(비활성 색),
         적용 중=색이 켜진 활성 색, 생성 중=깜빡임. 클릭하면 모달에서 안내·생성·적용·검토. */}
      <button
        type="button"
        data-tour="mcq-btn"
        onClick={() => setOpen(true)}
        title={tooltip}
        aria-label={tooltip}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${triggerClass}`}
      >
        <ListChecks className="w-4 h-4" />
        역량평가
        {needsReview && (
          <span className="inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-warning text-white text-[10px] font-bold leading-none">
            {flagged}
          </span>
        )}
      </button>

      <Modal
        open={open || reviewing}
        onClose={() => {
          setOpen(false);
          setDraft(null);
        }}
        title={reviewing ? "역량평가 문항 검토·수정" : "역량평가"}
        maxWidth="max-w-2xl"
      >
        {reviewing && draft ? (
          <div>
            <p className="text-xs text-ink-muted leading-relaxed mb-1">
              <strong className="text-ink-soft">{draft.length}문항</strong> · 정답을
              확인하고, 틀린 정답은 <strong>올바른 보기를 눌러</strong> 바꾸거나 불필요한
              문항은 삭제한 뒤 <strong>확정</strong>하세요. 닫기(X)는 저장하지 않으며 기존
              문제가 그대로 유지됩니다.
            </p>
            {flaggedCount > 0 && (
              <p className="text-xs text-warning bg-warning-soft border border-warning/30 rounded-lg px-3 py-2 mb-2">
                ⚠ {flaggedCount}문항은 자동 정답 검증에서 불일치가 감지됐습니다 —
                올바른 보기를 눌러 정답을 바로잡거나 문항을 삭제하세요.
              </p>
            )}

            <div className="space-y-3 mt-3">
              {draft.length === 0 && (
                <p className="text-sm text-ink-muted text-center py-6">
                  남은 문항이 없습니다. 확정하면 객관식이 비워집니다.
                </p>
              )}
              {draft.map((q, qi) => (
                <div
                  key={q.id}
                  className={`border rounded-xl p-3 ${
                    q.verified === false
                      ? "border-warning/40 bg-warning-soft/40"
                      : "border-border-default"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-ink leading-relaxed">
                      <span className="text-ink-muted mr-1.5">{qi + 1}.</span>
                      {q.question}
                      {q.verified === false && (
                        <span className="ml-2 text-[10px] font-bold text-warning align-middle">
                          ⚠ 정답 재확인
                        </span>
                      )}
                    </p>
                    <button
                      type="button"
                      onClick={() => deleteQ(q.id)}
                      className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border-default text-xs font-semibold text-ink-muted hover:text-danger hover:border-danger/50 hover:bg-danger-soft transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> 삭제
                    </button>
                  </div>
                  <ul className="mt-2 space-y-1">
                    {q.options.map((opt, oi) => {
                      const isAnswer = oi === q.answer;
                      return (
                        <li key={oi}>
                          <button
                            type="button"
                            onClick={() => setAnswer(q.id, oi)}
                            aria-pressed={isAnswer}
                            title={isAnswer ? "현재 정답" : "이 보기를 정답으로 지정"}
                            className={`w-full text-left text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-2 transition-colors ${
                              isAnswer
                                ? "bg-success-soft text-success font-medium"
                                : "text-ink-soft hover:bg-surface-alt"
                            }`}
                          >
                            <span
                              className={`shrink-0 w-4 h-4 rounded-full border flex items-center justify-center text-[9px] font-bold ${
                                isAnswer
                                  ? "border-success text-success"
                                  : "border-border-strong text-ink-muted"
                              }`}
                            >
                              {oi + 1}
                            </span>
                            {opt}
                            {isAnswer && (
                              <span className="ml-auto text-[10px] font-bold text-success">
                                정답
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-border-default">
              <button
                type="button"
                onClick={() => setDraft(null)}
                disabled={saving}
                className="px-4 py-2 rounded-lg border border-border-default text-sm font-semibold text-ink-soft hover:bg-surface-alt disabled:opacity-50"
              >
                ← 뒤로
              </button>
              <button
                type="button"
                onClick={() => void confirmSave()}
                disabled={saving}
                className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-surface text-sm font-semibold shadow-sm disabled:opacity-50"
              >
                {saving ? "저장 중…" : `확정 (${draft.length}문항)`}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4" data-tour="mcq-body">
            <p className="text-sm text-ink-soft leading-relaxed">
              직무 기본기를 묻는 4지선다를 AI 면접 시작 전에 출제합니다. 점수는 합불에
              반영되지 않는 <strong>참고용</strong>이며, 적용 여부는 토글로 켜고 끌 수
              있습니다.
            </p>

            <div className="rounded-xl border border-border-default bg-surface-alt px-4 py-3">
              <p className="text-sm text-ink leading-relaxed">
                {loading
                  ? "불러오는 중…"
                  : blockedDraft
                    ? "임시 공고에서는 생성할 수 없습니다 — 공고를 정식 저장한 뒤 생성하세요."
                    : generating
                      ? "문제 생성 중… (수십 초 소요 · 닫거나 새로고침해도 계속 유지됩니다)"
                      : count > 0
                        ? `${count}문항 생성됨 · ${enabled ? "AI 면접에 적용 중 (점수 참고용)" : "적용 안 함 (문항은 보존됨)"}`
                        : "아직 생성된 문제가 없습니다."}
              </p>
            </div>

            {!loading && !generating && count > 0 && flagged > 0 && (
              <p className="text-xs text-warning bg-warning-soft border border-warning/30 rounded-lg px-3 py-2 leading-relaxed">
                ⚠ {flagged}문항은 자동 정답 검증에서 불일치가 감지됐습니다 — 아래{" "}
                <strong>“문제 보기·수정”</strong>에서 올바른 보기를 눌러 정답을 확인·수정하세요.
              </p>
            )}

            {!loading && !generating && count > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-ink-soft">AI 면접 적용</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    aria-label="AI 면접에 객관식 적용"
                    onClick={() => void toggleEnabled()}
                    disabled={busy || disabled}
                    className={`relative w-9 h-5 rounded-full transition-colors disabled:opacity-50 ${
                      enabled ? "bg-primary" : "bg-border-strong"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-4 h-4 bg-card rounded-full shadow transition-transform ${
                        enabled ? "translate-x-4" : ""
                      }`}
                    />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => void openView()}
                  disabled={busy}
                  className={`${btn} border border-border-default text-ink-soft hover:bg-surface-alt`}
                >
                  문제 보기·수정
                </button>
              </div>
            )}

            {!loading && !generating && count === 0 && (
              <button
                type="button"
                onClick={() => void generate()}
                disabled={busy || disabled || blockedDraft}
                title={blockedDraft ? "임시 공고에서는 생성할 수 없습니다." : undefined}
                className={`${btn} bg-primary hover:bg-primary-deep text-surface shadow-sm`}
              >
                문제 생성
              </button>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
