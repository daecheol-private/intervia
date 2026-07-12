"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Loader2,
  Mail,
  RefreshCw,
  X,
} from "lucide-react";
import { formatKstDateTime } from "@/lib/utils";
import { BulletBlock } from "./screening-report";
import { HL, recColor, scoreColor, scoreBarColor, showRec } from "./shared";
import { behaviorStyleOf } from "@/lib/personality";
import {
  BigFiveRadar,
  BehaviorStyleCard,
  CompetencyBadges,
} from "./personality-visuals";
import type { InterviewEvaluation, Session } from "./types";

export function InterviewLinkBox({
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
  // 서버가 계산한 법인 서브도메인 정본 URL 우선({sub}.intervia.kr). 없으면(기능 OFF·구세션) 현재 origin.
  const url =
    session.interviewUrl ??
    (typeof window !== "undefined"
      ? `${window.location.origin}/interview/${session.accessToken}`
      : `/interview/${session.accessToken}`);

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
        <span className="text-xs text-ink-muted">
          만료 {formatKstDateTime(session.expiresAt)}
        </span>
      </div>
      <div className="flex gap-2">
        <input
          readOnly
          value={url}
          className="flex-1 border border-border-strong rounded-lg px-3 py-2 bg-surface-alt text-xs font-mono text-ink-soft"
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
          className="px-4 py-2 rounded-lg text-sm font-medium bg-primary hover:bg-primary-deep text-surface disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-1.5"
        >
          {sending && <Loader2 className="w-4 h-4 animate-spin" />}
          {!sending && <Mail className="w-4 h-4" />}
          {sending ? "발송 중..." : "재발송"}
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
                    className="inline-flex items-center px-2.5 py-1 rounded-md bg-warning text-white font-medium hover:bg-warning"
                  >
                    메일서버 설정으로 이동
                  </Link>
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(url);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                    className="inline-flex items-center px-2.5 py-1 rounded-md border border-warning/40 text-warning hover:bg-warning-soft"
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
            className="flex-1 border border-border-strong rounded-lg px-3 py-2 text-sm"
            autoFocus
          />
          <button
            onClick={() => emailInput && send(emailInput)}
            disabled={sending || !emailInput}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-primary hover:bg-primary-deep text-surface disabled:opacity-50"
          >
            보내기
          </button>
          <button
            onClick={() => setShowEmailForm(false)}
            className="px-3 py-2 rounded-lg text-sm border border-border-strong hover:bg-surface-alt"
          >
            취소
          </button>
        </div>
      )}
      <button
        onClick={onRegenerate}
        className="text-xs text-ink-muted hover:text-ink underline"
      >
        링크 새로 발급
      </button>
    </div>
  );
}

/** 면접 종료 직후 ~ 평가 완료 전 구간: 평가는 complete 요청 안에서 inline 으로 생성되며
 *  보통 1분 내외 걸린다. 이 구간을 "실패"로 표시하면 운영자가 재평가를 눌러 LLM 비용·중복
 *  과금이 발생하므로(2026-06-13 사고), "생성 중"으로 표시하고 재평가 버튼을 노출하지 않는다.
 *  부모가 폴링으로 결과를 받아 자동으로 InterviewResult 로 전환한다. */
export function InterviewEvaluationPending({
  onShowTranscript,
}: {
  onShowTranscript: () => void;
}) {
  return (
    <div className="space-y-3 text-sm">
      <div className="rounded-xl border border-border-default bg-surface-alt px-4 py-3 flex items-start gap-3">
        <Loader2 className="w-5 h-5 animate-spin text-primary shrink-0 mt-0.5" />
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-0.5">
            AI 평가 생성 중
          </div>
          <p className="text-ink-soft leading-relaxed">
            면접이 정상 종료되어 AI 평가를 생성하고 있습니다. 보통 1분 내외
            소요되며, 완료되면 결과가 자동으로 표시됩니다. 이 화면을 떠나도 평가는
            계속 진행됩니다.
          </p>
        </div>
      </div>
      <button
        onClick={onShowTranscript}
        className="px-4 py-2 rounded-lg border border-border-strong text-ink-soft hover:bg-surface-alt text-sm"
      >
        대화록 보기
      </button>
    </div>
  );
}

/** 면접 종료됐는데 evaluation=null 이고 생성 유예시간도 지난 케이스(LLM 평가 실패). 면접은
 *  후차감이라 실패 시 과금된 적이 없다(환불도 없음). 재시도해서 평가가 성공하면 그때 1건 차감된다. */
export function InterviewEvaluationRetry({
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
      <div className="rounded-xl border border-warning/40 bg-warning-soft px-4 py-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-warning mb-1">
          AI 평가 생성 실패
        </div>
        <p className="text-warning leading-relaxed">
          면접은 정상 종료되었으나 AI 평가 JSON 생성에 실패했습니다. 평가에 실패해
          토큰은 차감되지 않았습니다. 아래 버튼으로 재평가를 요청해 평가가 성공하면
          그때 토큰이 차감됩니다 (실패하면 과금 없음).
        </p>
      </div>
      <div className="flex gap-2">
        <button
          onClick={retry}
          disabled={busy}
          className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-surface text-sm font-medium disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {!busy && <RefreshCw className="w-4 h-4" />}
          {busy ? "재평가 중..." : "AI 평가 재시도"}
        </button>
        <button
          onClick={onShowTranscript}
          className="px-4 py-2 rounded-lg border border-border-strong text-ink-soft hover:bg-surface-alt text-sm"
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

export function InterviewResult({
  session,
  jobTraitProfile,
  orgCoreCompetencies,
  onShowTranscript,
  onRegenerate,
  disabled = false,
}: {
  session: Session;
  jobTraitProfile?: Record<string, string> | null;
  orgCoreCompetencies?: string[] | null;
  onShowTranscript: () => void;
  onRegenerate: () => void;
  disabled?: boolean;
}) {
  const ev = session.evaluation!;
  // 성공한 AI 면접에는 재평가 버튼을 두지 않는다 — 같은 대화록 재평가는 토큰만 더 쓰고
  // 변별력이 없다(정책: AI 작업은 오류 시에만 재시도). 평가 실패는 InterviewEvaluationRetry 가 담당.
  return (
    <div className="space-y-5 text-sm">
      <div className="flex items-baseline gap-3 flex-wrap">
        <div className={`text-5xl font-bold tabular-nums ${scoreColor(ev.overall_score)}`}>
          {ev.overall_score}
        </div>
        <span className="text-base text-ink-muted font-medium">/ 100</span>
        {showRec(ev.recommendation) && (
          <span
            className={`text-xs font-semibold px-2.5 py-1 rounded-md border ${recColor[ev.recommendation]}`}
          >
            {ev.recommendation}
          </span>
        )}
        <span className="ml-auto text-xs text-ink-muted">
          면접 {session.completedAt ? formatKstDateTime(session.completedAt) : "-"}
        </span>
      </div>
      <blockquote className="border-l-4 border-primary/40 bg-primary-soft/30 px-4 py-3 rounded-r-lg text-ink leading-relaxed">
        <HL text={ev.summary} />
      </blockquote>

      <div className="grid grid-cols-2 gap-3">
        {Object.entries(ev.scores ?? {}).map(([k, v]) => (
          <div
            key={k}
            className="border border-border-default rounded-xl p-4 bg-surface-alt/50"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-ink-soft">{k}</span>
              <span
                className={`text-2xl font-bold tabular-nums leading-none ${scoreColor(v.score)}`}
              >
                {v.score}
              </span>
            </div>
            <div className="mt-2 h-2 bg-surface-alt rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${scoreBarColor(v.score)}`}
                style={{ width: `${Math.max(0, Math.min(100, v.score))}%` }}
              />
            </div>
            <div className="text-[13px] text-ink-soft mt-2.5 leading-relaxed">
              <HL text={v.comment} />
            </div>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <BulletBlock
          title="강점"
          items={ev.strengths}
          color="emerald"
          emphasizeLead
          emphasis
        />
        <BulletBlock
          title="우려"
          items={ev.concerns}
          color="amber"
          emphasizeLead
          emphasis
        />
      </div>

      <CultureFitBlock
        cultureFit={ev.culture_fit}
        personalityProfile={session.personalityProfile}
        jobTraitProfile={jobTraitProfile}
        orgCoreCompetencies={orgCoreCompetencies}
      />

      {session.mcqResponses && session.mcqResponses.length > 0 && (
        <McqResultBlock
          records={session.mcqResponses}
          score={session.mcqScore ?? 0}
          total={session.mcqResponses.length}
        />
      )}

      {ev.llm_assist_note && (
        <div className="rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 mt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-warning">
            외부 LLM 보조 분석
          </div>
          <div className="text-sm text-warning mt-1 leading-relaxed">
            <HL text={ev.llm_assist_note} />
          </div>
          <div className="text-[11px] text-warning mt-2">
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
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
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
            <ul className="list-disc pl-5 mt-2 space-y-0.5 text-sm text-ink-soft">
              {ev.ai_authorship.signals.map((s, i) => (
                <li key={i}>
                  <HL text={s} />
                </li>
              ))}
            </ul>
          )}
          {ev.ai_authorship.note && (
            <div className="text-sm text-ink mt-2 leading-relaxed">
              <HL text={ev.ai_authorship.note} />
            </div>
          )}
          <div className="text-[11px] text-ink-muted mt-2">
            ※ 답변 텍스트의 문체만 본 LLM 추정입니다. 행동 신호(위)와 별개 —
            단정 금물, 면접 자리에서 본인 발언으로 재확인 권장.
          </div>
        </div>
      )}

      <div className="flex gap-3 pt-3 border-t border-border-default items-center flex-wrap">
        <button
          onClick={onShowTranscript}
          className="text-xs text-primary hover:underline"
        >
          면접 대화록 보기 →
        </button>
        {!disabled && (
          <button
            onClick={onRegenerate}
            className="text-xs text-ink-muted hover:text-ink underline"
          >
            재면접 링크 발급
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * 컬처핏·정성 검증 블록 — 인성검사 특성 프로필(vs 공고 선호) + 자가응답·면접 발언 대조.
 * 무점수 참고 정보 — overall_score 와 무관함을 UI 에 명시.
 */
/** 객관식 사전 평가 결과 — 참고 정보(합불 미반영). 점수 + 문항별 정오(오답 강조).
 *  AI 면접 특색 기능이라 크게·눈에 띄게 표시하고, 틀린 문항을 펼쳐 확인할 수 있다. */
function McqResultBlock({
  records,
  score,
  total,
}: {
  records: Array<{
    id?: string;
    question?: string;
    options?: string[];
    answer?: number;
    chosen: number;
  }>;
  score: number;
  total: number;
}) {
  const [open, setOpen] = useState(false);
  const [wrongOnly, setWrongOnly] = useState(true);
  const pct = total > 0 ? Math.round((score / total) * 100) : 0;
  // 응시 당시 문항 스냅샷이 있는 항목만 상세 표시 (도입 초기 세션은 스냅샷 없음 → 점수만).
  const detail = records.filter(
    (r) =>
      typeof r.question === "string" &&
      Array.isArray(r.options) &&
      typeof r.answer === "number"
  );
  // 원래 문항 번호를 유지하면서 오답 필터링 (오답만 보기에서도 "3." 처럼 실제 번호 노출)
  const items = detail.map((r, i) => ({ r, num: i + 1 }));
  const wrong = items.filter((x) => x.r.chosen !== x.r.answer).length;
  const shown = wrongOnly && wrong > 0
    ? items.filter((x) => x.r.chosen !== x.r.answer)
    : items;

  return (
    <div className="rounded-2xl border-2 border-primary/30 bg-primary-soft/30 px-5 py-4 mt-3 shadow-sm">
      {/* 헤더 — 제목 + 큰 점수 */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <span className="text-2xl leading-none" aria-hidden>📝</span>
          <div>
            <div className="text-base font-bold text-ink">객관식 사전 평가</div>
            <div className="text-xs font-medium text-ink-muted mt-0.5">
              참고 정보 · 합불 점수 미반영
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="flex items-baseline gap-1.5 justify-end">
            <span className="text-4xl font-extrabold tabular-nums text-primary-deep leading-none">
              {score}
            </span>
            <span className="text-xl font-semibold text-ink-muted">/ {total}</span>
          </div>
          <div className="text-sm font-bold tabular-nums mt-1 text-ink-soft">
            정답률 {pct}%
            {wrong > 0 && (
              <span className="ml-2 text-danger">· 오답 {wrong}개</span>
            )}
          </div>
        </div>
      </div>
      <div className="text-xs text-ink-muted mt-2.5 leading-relaxed">
        직무 기본기 확인용 4지선다(요구 수준보다 낮은 난이도). 합격·불합격 점수에
        반영되지 않습니다.
      </div>

      {detail.length > 0 ? (
        <>
          <div className="flex items-center gap-3 mt-3.5 flex-wrap">
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-surface text-sm font-bold hover:bg-primary-deep transition-colors shadow-sm"
            >
              {open ? (
                <>
                  문항별 정오 접기
                  <ChevronUp className="w-4 h-4" />
                </>
              ) : (
                <>
                  <ClipboardList className="w-4 h-4" />
                  어떤 문항을 틀렸는지 보기
                  {wrong > 0 && (
                    <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-surface/25 text-surface text-xs font-extrabold">
                      오답 {wrong}
                    </span>
                  )}
                  <ChevronDown className="w-4 h-4" />
                </>
              )}
            </button>
            {open && wrong > 0 && (
              <label className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-soft cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={wrongOnly}
                  onChange={(e) => setWrongOnly(e.target.checked)}
                  className="w-4 h-4 accent-danger"
                />
                오답만 보기
              </label>
            )}
          </div>

          {open && (
            <ol className="mt-3 space-y-3">
              {shown.map(({ r, num }) => {
                const correct = r.chosen === r.answer;
                return (
                  <li
                    key={r.id ?? num}
                    className={`rounded-xl border-2 px-4 py-3.5 ${
                      correct
                        ? "border-success/40 bg-success-soft/40"
                        : "border-danger/40 bg-danger-soft"
                    }`}
                  >
                    <p className="text-[15px] font-bold text-ink leading-relaxed flex items-start gap-2.5">
                      <span
                        className={`shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full text-white text-sm font-extrabold mt-0.5 ${
                          correct ? "bg-success" : "bg-danger"
                        }`}
                        aria-label={correct ? "정답" : "오답"}
                      >
                        {correct ? "○" : "✕"}
                      </span>
                      <span>
                        <span className="text-ink-muted mr-1.5">{num}.</span>
                        {r.question}
                      </span>
                    </p>
                    <div className="mt-2.5 space-y-1.5 pl-[2.1rem]">
                      {r.options!.map((opt, oi) => {
                        const isCorrect = oi === r.answer;
                        const isChosen = oi === r.chosen;
                        return (
                          <div
                            key={oi}
                            className={`text-sm leading-relaxed flex items-start gap-2 rounded-lg px-2.5 py-1.5 ${
                              isCorrect
                                ? "bg-success-soft text-success font-semibold"
                                : isChosen
                                  ? "bg-danger-soft text-danger font-semibold"
                                  : "text-ink-soft"
                            }`}
                          >
                            <span className="text-ink-muted shrink-0">{oi + 1}.</span>
                            <span className="flex-1">{opt}</span>
                            {isCorrect && (
                              <span className="shrink-0 text-xs font-bold text-success whitespace-nowrap">
                                {isChosen ? "✓ 정답 (선택함)" : "✓ 정답"}
                              </span>
                            )}
                            {isChosen && !isCorrect && (
                              <span className="shrink-0 text-xs font-bold text-danger whitespace-nowrap">
                                ✕ 응시자 선택
                              </span>
                            )}
                          </div>
                        );
                      })}
                      {r.chosen < 0 && (
                        <p className="text-sm text-ink-muted italic">미응답</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      ) : (
        <div className="mt-3 text-xs text-ink-muted bg-surface rounded-lg px-3 py-2 border border-border-default">
          이 면접은 문항별 정오 정보가 저장되기 전에 응시되어 점수만 표시됩니다.
        </div>
      )}
    </div>
  );
}

function CultureFitBlock({
  cultureFit,
  personalityProfile,
  jobTraitProfile,
  orgCoreCompetencies,
}: {
  cultureFit?: InterviewEvaluation["culture_fit"];
  personalityProfile?: Session["personalityProfile"];
  jobTraitProfile?: Record<string, string> | null;
  orgCoreCompetencies?: string[] | null;
}) {
  const hasCompetencies = (orgCoreCompetencies?.length ?? 0) > 0;
  if (!cultureFit && !personalityProfile && !hasCompetencies) return null;

  const flags = personalityProfile?.flags;
  const flagNotes: string[] = [];
  if (flags?.straightLining) flagNotes.push("한쪽 선택지만 반복 선택");
  if (flags?.inconsistent) flagNotes.push("재질문에서 선택 다수 뒤집힘");
  if (flags?.rushed) flagNotes.push("비정상적으로 빠른 응답");

  const style = personalityProfile
    ? behaviorStyleOf(personalityProfile.traits)
    : null;

  const verdictStyle: Record<string, string> = {
    일치: "border-emerald-300 bg-emerald-100 text-emerald-800",
    불일치: "border-rose-300 bg-rose-100 text-rose-800",
    미검증: "border-slate-300 bg-slate-100 text-slate-600",
  };
  // 배지만 보고 의미를 알 수 있도록 "무엇과" 일치/불일치인지까지 풀어 씀.
  const verdictLabel: Record<string, string> = {
    일치: "면접 발언과 일치",
    불일치: "면접 발언과 불일치",
    미검증: "면접서 미확인",
  };

  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50/50 px-4 py-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-xs font-bold uppercase tracking-wider text-violet-700">
          컬처핏 · 정성 검증
        </div>
        <span className="text-[11px] font-medium px-2 py-0.5 rounded border border-violet-200 bg-card text-violet-600">
          참고 정보 — 점수 미반영
        </span>
      </div>

      {personalityProfile && (
        <div className="mt-3">
          <div className="grid md:grid-cols-2 gap-3">
            {/* 행동 스타일 4분면 */}
            {style && <BehaviorStyleCard style={style} />}

            {/* Big Five 레이더 */}
            <div className="rounded-xl border border-border-default bg-card px-4 py-3.5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-ink-soft">
                성향 분포 · Big Five
              </div>
              <BigFiveRadar
                traits={personalityProfile.traits}
                jobTraitProfile={jobTraitProfile}
              />
              <div className="flex items-center justify-center gap-4 text-[11px] font-medium text-ink-soft -mt-1">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-violet-700" />
                  후보자
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-emerald-700 font-bold">★</span>
                  공고 선호 특성
                </span>
              </div>
            </div>
          </div>
          {flagNotes.length > 0 && (
            <div className="text-xs font-medium text-warning bg-warning-soft border border-warning/40 rounded-md px-2.5 py-1.5 mt-2.5">
              ⚠ 응답 신뢰 신호: {flagNotes.join(" · ")} — 자가응답 해석에 주의
            </div>
          )}
        </div>
      )}

      {hasCompetencies && (
        <div className="mt-3 border-t border-violet-200/60 pt-2.5">
          <CompetencyBadges keys={orgCoreCompetencies} />
        </div>
      )}

      {cultureFit?.items && cultureFit.items.length > 0 && (
        <div className="mt-3">
          <div className="text-[11px] font-bold uppercase tracking-wider text-ink-soft">
            인성검사 자가응답 ↔ 면접 발언 대조
          </div>
          <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">
            면접 직전 인성검사에서 본인이 고른 성향을, 실제 면접 발언과 맞춰본
            결과입니다. 발언으로 확인된 항목(&quot;면접 발언과 일치&quot;)만
            신뢰하세요.
          </p>
          <ul className="mt-2 space-y-2">
            {cultureFit.items.map((it, i) => {
              const notCovered = it.evidence === "면접에서 다루지 못함";
              return (
                <li
                  key={i}
                  className="bg-card border border-violet-100 rounded-lg px-3 py-2"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-ink">
                      {it.topic}
                    </span>
                    <span
                      className={`text-[11px] font-bold px-2 py-0.5 rounded border ${verdictStyle[it.verification] ?? verdictStyle["미검증"]}`}
                    >
                      {verdictLabel[it.verification] ?? it.verification}
                    </span>
                  </div>
                  <div className="text-xs text-ink-muted mt-1">
                    인성검사 자가응답:{" "}
                    <span className="font-medium text-ink-soft">
                      {it.self_report}
                    </span>
                  </div>
                  {notCovered ? (
                    <div className="text-xs text-ink-muted mt-0.5 italic">
                      면접에서 다루지 못함 — 다음 면접에서 확인 권장
                    </div>
                  ) : (
                    <div className="text-sm text-ink-soft mt-0.5 leading-relaxed">
                      <span className="text-ink-muted">면접 근거: </span>
                      <HL text={it.evidence} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {cultureFit?.fit_note && (
        <div className="text-sm text-ink-soft mt-2.5 leading-relaxed">
          <HL text={cultureFit.fit_note} />
        </div>
      )}

      <div className="text-xs text-ink-soft mt-2.5 leading-relaxed">
        ※ 인성검사는 강제선택 자가보고 기반 참고치(본인 내 상대 선호 — 절대
        수준 아님)이며, 면접 발언으로 검증된 항목만 신뢰하세요. 합·불 판단은
        직무 역량 평가를 우선해야 합니다.
      </div>
    </div>
  );
}

export function TranscriptModal({
  messages,
  onClose,
}: {
  messages: { role: string; content: string }[];
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 bg-ink/40 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-border-default flex justify-between items-center">
          <h3 className="font-bold text-ink">면접 대화록</h3>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg hover:bg-surface-alt text-ink-muted hover:text-ink transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto p-5 space-y-3 bg-surface-alt">
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
                      ? "bg-primary text-surface"
                      : "bg-card text-ink border border-border-default"
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
