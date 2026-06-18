"use client";

/**
 * 공고 상세 — AI 면접 객관식 사전 문항 관리 (전형 단계 현황 위, 한 줄 바).
 *
 * "문제 생성" → 서버가 백그라운드(after)로 LLM 생성·자가검증 후 곧바로 저장(비동기, 기본 적용 ON).
 * 클라이언트는 폴링으로 진행을 추적하고, 완료되면 "문제 보기" + "AI 면접 적용" 토글이 보인다.
 * 새로고침해도 진행/결과가 유지된다(상태는 공고에 저장). "문제 보기" → 모달에서 정답 확인·불필요
 * 문항 삭제 후 "확정" 저장. 적용 여부는 토글로만 바꾼다(문항은 보존). 점수는 합불 미반영.
 *
 * - 재생성 버튼 없음: 한 번 성공하면 재생성 불가. 생성 실패 시엔 세트가 없어(count=0) "문제 생성"으로 재시도.
 * - 임시 공고(isDraft)에서는 생성 불가.
 */
import { useEffect, useRef, useState } from "react";
import { Modal } from "@/app/components/Modal";
import { notify } from "@/app/components/Dialog";
import type { McqQuestion } from "@/lib/mcq";

const POLL_MS = 3000;

type McqState = { count: number; generating: boolean; enabled: boolean };

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
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<McqQuestion[] | null>(null);
  const [saving, setSaving] = useState(false);

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
      };
    } catch {
      return null;
    }
  };

  const applyState = (s: McqState) => {
    setCount(s.count);
    setEnabled(s.enabled);
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

  const flaggedCount = draft?.filter((q) => q.verified === false).length ?? 0;
  const blockedDraft = !!isDraft && count === 0;

  const statusText = loading
    ? "불러오는 중…"
    : blockedDraft
      ? "임시 공고에서는 생성할 수 없습니다 — 공고를 정식 저장한 뒤 생성하세요"
      : generating
        ? "문제 생성 중… (수십 초 소요 · 새로고침해도 유지됩니다)"
        : count > 0
          ? enabled
            ? `${count}문항 · AI 면접에 적용 중 (점수 참고용)`
            : `${count}문항 · 적용 안 함 (문항은 보존됨)`
          : "직무 기본기 4지선다를 AI 면접 시작 전 출제 (선택) · 점수 참고용";

  const btn =
    "px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-2xl px-4 py-2.5 shadow-sm mt-3 mb-1">
      <span className="text-sm font-bold text-slate-900 whitespace-nowrap">
        AI 면접 객관식 문제
      </span>
      <span className="text-xs text-slate-500 truncate flex-1 min-w-0">
        {statusText}
      </span>
      <div className="flex items-center gap-3 shrink-0">
        {!loading && generating && (
          <span className="text-xs font-semibold text-primary-deep px-2">
            생성 중…
          </span>
        )}
        {!loading && !generating && count > 0 && (
          <>
            {/* AI 면접 적용 on/off 토글 */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 whitespace-nowrap">
                AI 면접 적용
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                aria-label="AI 면접에 객관식 적용"
                onClick={() => void toggleEnabled()}
                disabled={busy || disabled}
                className={`relative w-9 h-5 rounded-full transition-colors disabled:opacity-50 ${
                  enabled ? "bg-primary" : "bg-slate-300"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                    enabled ? "translate-x-4" : ""
                  }`}
                />
              </button>
            </div>
            <button
              type="button"
              onClick={() => void openView()}
              disabled={busy}
              className={`${btn} border border-slate-200 text-slate-700 hover:bg-slate-50`}
            >
              문제 보기
            </button>
          </>
        )}
        {!loading && !generating && count === 0 && (
          <button
            type="button"
            onClick={() => void generate()}
            disabled={busy || disabled || blockedDraft}
            title={blockedDraft ? "임시 공고에서는 생성할 수 없습니다." : undefined}
            className={`${btn} bg-primary hover:bg-primary-deep text-white shadow-sm`}
          >
            문제 생성
          </button>
        )}
      </div>

      <Modal
        open={draft != null}
        onClose={() => setDraft(null)}
        title="객관식 문제 검토·수정"
        maxWidth="max-w-2xl"
      >
        {draft && (
          <div>
            <p className="text-xs text-slate-500 leading-relaxed mb-1">
              <strong className="text-slate-700">{draft.length}문항</strong> · 정답을
              확인하고 불필요한 문항은 삭제한 뒤 <strong>확정</strong>하세요. 닫기(X)는
              저장하지 않으며 기존 문제가 그대로 유지됩니다.
            </p>
            {flaggedCount > 0 && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
                ⚠ {flaggedCount}문항은 자동 정답 검증에서 불일치가 감지됐습니다 —
                정답·보기를 한 번 더 확인하거나 삭제하세요.
              </p>
            )}

            <div className="space-y-3 mt-3">
              {draft.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-6">
                  남은 문항이 없습니다. 확정하면 객관식이 비워집니다.
                </p>
              )}
              {draft.map((q, qi) => (
                <div
                  key={q.id}
                  className={`border rounded-xl p-3 ${
                    q.verified === false
                      ? "border-amber-300 bg-amber-50/40"
                      : "border-slate-200"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900 leading-relaxed">
                      <span className="text-slate-400 mr-1.5">{qi + 1}.</span>
                      {q.question}
                      {q.verified === false && (
                        <span className="ml-2 text-[10px] font-bold text-amber-700 align-middle">
                          ⚠ 정답 재확인
                        </span>
                      )}
                    </p>
                    <button
                      type="button"
                      onClick={() => deleteQ(q.id)}
                      className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 text-xs font-semibold text-slate-500 hover:text-danger hover:border-danger/50 hover:bg-danger-soft transition-colors"
                    >
                      🗑 삭제
                    </button>
                  </div>
                  <ul className="mt-2 space-y-1">
                    {q.options.map((opt, oi) => {
                      const isAnswer = oi === q.answer;
                      return (
                        <li
                          key={oi}
                          className={`text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-2 ${
                            isAnswer
                              ? "bg-emerald-50 text-emerald-800 font-medium"
                              : "text-slate-600"
                          }`}
                        >
                          <span
                            className={`shrink-0 w-4 h-4 rounded-full border flex items-center justify-center text-[9px] font-bold ${
                              isAnswer
                                ? "border-emerald-500 text-emerald-600"
                                : "border-slate-300 text-slate-400"
                            }`}
                          >
                            {oi + 1}
                          </span>
                          {opt}
                          {isAnswer && (
                            <span className="ml-auto text-[10px] font-bold text-emerald-600">
                              정답
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setDraft(null)}
                disabled={saving}
                className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                닫기
              </button>
              <button
                type="button"
                onClick={() => void confirmSave()}
                disabled={saving}
                className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-white text-sm font-semibold shadow-sm disabled:opacity-50"
              >
                {saving ? "저장 중…" : `확정 (${draft.length}문항)`}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
