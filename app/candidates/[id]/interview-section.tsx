"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { formatKstDateTime } from "@/lib/utils";
import { confirmDialog } from "@/app/components/Dialog";
import { BulletBlock } from "./screening-report";
import { HL, recColor, scoreColor, scoreBarColor, showRec } from "./shared";
import { TRAIT_KEYS, TRAIT_LABELS } from "@/lib/personality";
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
  const url =
    typeof window !== "undefined"
      ? `${window.location.origin}/interview/${session.accessToken}`
      : `/interview/${session.accessToken}`;

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
        <span className="text-xs text-slate-500">
          만료 {formatKstDateTime(session.expiresAt)}
        </span>
      </div>
      <div className="flex gap-2">
        <input
          readOnly
          value={url}
          className="flex-1 border border-slate-300 rounded-lg px-3 py-2 bg-slate-50 text-xs font-mono text-slate-700"
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
          {sending ? "발송 중..." : "📧 재발송"}
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
                    className="inline-flex items-center px-2.5 py-1 rounded-md bg-amber-600 text-white font-medium hover:bg-amber-700"
                  >
                    메일서버 설정으로 이동
                  </Link>
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(url);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                    className="inline-flex items-center px-2.5 py-1 rounded-md border border-amber-300 text-amber-800 hover:bg-amber-100"
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
            className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm"
            autoFocus
          />
          <button
            onClick={() => emailInput && send(emailInput)}
            disabled={sending || !emailInput}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-primary hover:bg-primary-deep text-white disabled:opacity-50"
          >
            보내기
          </button>
          <button
            onClick={() => setShowEmailForm(false)}
            className="px-3 py-2 rounded-lg text-sm border border-slate-300 hover:bg-slate-50"
          >
            취소
          </button>
        </div>
      )}
      <button
        onClick={onRegenerate}
        className="text-xs text-slate-500 hover:text-slate-900 underline"
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
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 flex items-start gap-3">
        <Loader2 className="w-5 h-5 animate-spin text-blue-500 shrink-0 mt-0.5" />
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-blue-700 mb-0.5">
            AI 평가 생성 중
          </div>
          <p className="text-blue-900 leading-relaxed">
            면접이 정상 종료되어 AI 평가를 생성하고 있습니다. 보통 1분 내외
            소요되며, 완료되면 결과가 자동으로 표시됩니다. 이 화면을 떠나도 평가는
            계속 진행됩니다.
          </p>
        </div>
      </div>
      <button
        onClick={onShowTranscript}
        className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm"
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
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 mb-1">
          AI 평가 생성 실패
        </div>
        <p className="text-amber-900 leading-relaxed">
          면접은 정상 종료되었으나 AI 평가 JSON 생성에 실패했습니다. 평가에 실패해
          토큰은 차감되지 않았습니다. 아래 버튼으로 재평가를 요청해 평가가 성공하면
          그때 토큰이 차감됩니다 (실패하면 과금 없음).
        </p>
      </div>
      <div className="flex gap-2">
        <button
          onClick={retry}
          disabled={busy}
          className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-white text-sm font-medium disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {busy ? "재평가 중..." : "🔄 AI 평가 재시도"}
        </button>
        <button
          onClick={onShowTranscript}
          className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm"
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
  onShowTranscript,
  onRegenerate,
  onReevaluated,
  disabled = false,
}: {
  session: Session;
  jobTraitProfile?: Record<string, string> | null;
  onShowTranscript: () => void;
  onRegenerate: () => void;
  onReevaluated: () => void;
  disabled?: boolean;
}) {
  const ev = session.evaluation!;
  const [reBusy, setReBusy] = useState(false);
  const [reMsg, setReMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null
  );
  // 성공한 AI 면접도 재평가 허용 — 같은 대화록 재평가, 성공할 때마다 토큰 차감(후차감).
  const reevaluate = async () => {
    if (
      !(await confirmDialog(
        "같은 면접 대화록으로 AI 평가를 다시 실행합니다.\n기존 평가 결과는 덮어쓰며, 평가가 성공하면 토큰이 다시 차감됩니다 (실패 시 과금 없음).",
        { title: "AI 면접 재평가", confirmText: "재평가" }
      ))
    )
      return;
    setReBusy(true);
    setReMsg(null);
    try {
      const res = await fetch(
        `/api/interview-sessions/${session.id}/reevaluate`,
        { method: "POST" }
      );
      const raw = await res.text();
      let data: { ok?: boolean; error?: string; detail?: string } | null = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = null;
      }
      if (res.ok && data?.ok) {
        setReMsg({ kind: "ok", text: "재평가 성공. 잠시 후 결과가 갱신됩니다." });
        onReevaluated();
      } else {
        const base = data?.error ?? raw ?? `재평가 실패 (HTTP ${res.status}).`;
        setReMsg({
          kind: "err",
          text: data?.detail ? `${base}\n(원인: ${data.detail})` : base,
        });
      }
    } catch (e) {
      setReMsg({
        kind: "err",
        text: `재평가 요청 중 오류: ${e instanceof Error ? e.message : String(e)}`,
      });
    } finally {
      setReBusy(false);
    }
  };
  return (
    <div className="space-y-5 text-sm">
      <div className="flex items-baseline gap-3 flex-wrap">
        <div className={`text-5xl font-bold tabular-nums ${scoreColor(ev.overall_score)}`}>
          {ev.overall_score}
        </div>
        <span className="text-base text-slate-400 font-medium">/ 100</span>
        {showRec(ev.recommendation) && (
          <span
            className={`text-xs font-semibold px-2.5 py-1 rounded-md border ${recColor[ev.recommendation]}`}
          >
            {ev.recommendation}
          </span>
        )}
        <span className="ml-auto text-xs text-slate-500">
          면접 {session.completedAt ? formatKstDateTime(session.completedAt) : "-"}
        </span>
      </div>
      <blockquote className="border-l-4 border-primary/40 bg-primary-soft/30 px-4 py-3 rounded-r-lg text-slate-800 leading-relaxed">
        <HL text={ev.summary} />
      </blockquote>

      <div className="grid grid-cols-2 gap-3">
        {Object.entries(ev.scores ?? {}).map(([k, v]) => (
          <div
            key={k}
            className="border border-slate-200 rounded-xl p-4 bg-slate-50/50"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-slate-700">{k}</span>
              <span
                className={`text-2xl font-bold tabular-nums leading-none ${scoreColor(v.score)}`}
              >
                {v.score}
              </span>
            </div>
            <div className="mt-2 h-2 bg-slate-200 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${scoreBarColor(v.score)}`}
                style={{ width: `${Math.max(0, Math.min(100, v.score))}%` }}
              />
            </div>
            <div className="text-[13px] text-slate-600 mt-2.5 leading-relaxed">
              <HL text={v.comment} />
            </div>
          </div>
        ))}
      </div>

      <BulletBlock title="강점" items={ev.strengths} color="emerald" />
      <BulletBlock title="우려" items={ev.concerns} color="amber" />
      <BulletBlock
        title="다음 단계 추가 검증 질문"
        items={ev.followup_questions}
        color="slate"
      />

      <CultureFitBlock
        cultureFit={ev.culture_fit}
        personalityProfile={session.personalityProfile}
        jobTraitProfile={jobTraitProfile}
      />

      {ev.llm_assist_note && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 mt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-700">
            외부 LLM 보조 분석
          </div>
          <div className="text-sm text-amber-900 mt-1 leading-relaxed">
            <HL text={ev.llm_assist_note} />
          </div>
          <div className="text-[11px] text-amber-700 mt-2">
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
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
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
            <ul className="list-disc pl-5 mt-2 space-y-0.5 text-sm text-slate-700">
              {ev.ai_authorship.signals.map((s, i) => (
                <li key={i}>
                  <HL text={s} />
                </li>
              ))}
            </ul>
          )}
          {ev.ai_authorship.note && (
            <div className="text-sm text-slate-800 mt-2 leading-relaxed">
              <HL text={ev.ai_authorship.note} />
            </div>
          )}
          <div className="text-[11px] text-slate-500 mt-2">
            ※ 답변 텍스트의 문체만 본 LLM 추정입니다. 행동 신호(위)와 별개 —
            단정 금물, 면접 자리에서 본인 발언으로 재확인 권장.
          </div>
        </div>
      )}

      <div className="flex gap-3 pt-3 border-t border-slate-100 items-center flex-wrap">
        <button
          onClick={onShowTranscript}
          className="text-xs text-primary hover:underline"
        >
          면접 대화록 보기 →
        </button>
        {!disabled && (
          <button
            onClick={onRegenerate}
            className="text-xs text-slate-500 hover:text-slate-900 underline"
          >
            재면접 링크 발급
          </button>
        )}
        <button
          onClick={reevaluate}
          disabled={reBusy}
          className="ml-auto shrink-0 text-xs px-3 py-1.5 rounded-md border border-blue-300 text-blue-600 hover:bg-blue-50 disabled:opacity-50 inline-flex items-center justify-center gap-1"
          title="같은 대화록으로 AI 평가를 다시 실행 (성공 시 토큰 차감)"
        >
          {reBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {reBusy ? "재평가 중..." : "🔄 재평가"}
        </button>
      </div>
      {reMsg && (
        <div
          className={`text-xs whitespace-pre-line rounded-lg px-3 py-2 ${
            reMsg.kind === "ok"
              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
              : "bg-rose-50 text-rose-700 border border-rose-200"
          }`}
        >
          {reMsg.text}
        </div>
      )}
    </div>
  );
}

/**
 * 컬처핏·정성 검증 블록 — 인성검사 특성 프로필(vs 공고 선호) + 자가응답·면접 발언 대조.
 * 무점수 참고 정보 — overall_score 와 무관함을 UI 에 명시.
 */
function CultureFitBlock({
  cultureFit,
  personalityProfile,
  jobTraitProfile,
}: {
  cultureFit?: InterviewEvaluation["culture_fit"];
  personalityProfile?: Session["personalityProfile"];
  jobTraitProfile?: Record<string, string> | null;
}) {
  if (!cultureFit && !personalityProfile) return null;

  const flags = personalityProfile?.flags;
  const flagNotes: string[] = [];
  if (flags?.straightLining) flagNotes.push("한쪽 선택지만 반복 선택");
  if (flags?.inconsistent) flagNotes.push("재질문에서 선택 다수 뒤집힘");
  if (flags?.rushed) flagNotes.push("비정상적으로 빠른 응답");

  const verdictStyle: Record<string, string> = {
    일치: "border-emerald-300 bg-emerald-100 text-emerald-800",
    불일치: "border-rose-300 bg-rose-100 text-rose-800",
    미검증: "border-slate-300 bg-slate-100 text-slate-600",
  };

  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50/50 px-4 py-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-violet-700">
          컬처핏 · 정성 검증
        </div>
        <span className="text-[10px] px-1.5 py-0.5 rounded border border-violet-200 bg-white text-violet-600">
          참고 정보 — 점수 미반영
        </span>
      </div>

      {personalityProfile && (
        <div className="mt-3 space-y-1.5">
          {TRAIT_KEYS.map((k) => {
            const t = personalityProfile.traits[k];
            if (!t) return null;
            const desired = jobTraitProfile?.[k];
            return (
              <div key={k} className="flex items-center gap-2.5">
                <span className="text-[11px] text-slate-600 w-32 shrink-0 truncate">
                  {TRAIT_LABELS[k]}
                </span>
                <div className="flex-1 h-2 bg-white border border-violet-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-violet-400 rounded-full"
                    style={{ width: `${t.score}%` }}
                  />
                </div>
                <span className="text-[11px] font-semibold text-slate-700 tabular-nums w-7 text-right">
                  {t.score}
                </span>
                {desired === "high" && (
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${
                      t.score >= 67
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-amber-200 bg-amber-50 text-amber-700"
                    }`}
                    title="공고에서 높음으로 지정한 선호 특성"
                  >
                    공고 선호
                  </span>
                )}
              </div>
            );
          })}
          {flagNotes.length > 0 && (
            <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1 mt-1.5">
              ⚠ 응답 신뢰 신호: {flagNotes.join(" · ")} — 자가응답 해석에 주의
            </div>
          )}
        </div>
      )}

      {cultureFit?.items && cultureFit.items.length > 0 && (
        <ul className="mt-3 space-y-2">
          {cultureFit.items.map((it, i) => (
            <li
              key={i}
              className="bg-white border border-violet-100 rounded-lg px-3 py-2"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-slate-800">
                  {it.topic}
                </span>
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${verdictStyle[it.verification] ?? verdictStyle["미검증"]}`}
                >
                  {it.verification}
                </span>
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                자가응답: {it.self_report}
              </div>
              <div className="text-xs text-slate-700 mt-0.5 leading-relaxed">
                <HL text={it.evidence} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {cultureFit?.fit_note && (
        <div className="text-xs text-slate-700 mt-2.5 leading-relaxed">
          <HL text={cultureFit.fit_note} />
        </div>
      )}

      <div className="text-[11px] text-slate-500 mt-2.5">
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
      className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-slate-200 flex justify-between items-center">
          <h3 className="font-bold text-slate-900">면접 대화록</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition-colors"
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto p-5 space-y-3 bg-slate-50">
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
                      ? "bg-primary text-white"
                      : "bg-white text-slate-900 border border-slate-200"
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
