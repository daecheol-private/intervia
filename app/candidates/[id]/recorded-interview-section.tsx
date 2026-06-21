"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { formatKstDateTime } from "@/lib/utils";
import { notify } from "@/app/components/Dialog";
import {
  HL,
  recColor,
  scoreBarColor,
  scoreColor,
  showRec,
  withLeadEmphasis,
} from "./shared";
import { LiveRecorder } from "./recorded-interview-live";

// ── 대면(오프라인) 면접 녹음 → AI 평가 리포트 ──────────────────────────
// 업로드 모드: 녹음 파일을 올리면 전사 → 화자 역할배정 → 평가 → 리포트.
// 결과는 AI 채팅 면접 평가와 별개 — 사람이 진행한 대면 면접의 평가서.
// 설계: docs/LIVE_INTERVIEW_PLAN.md

type Report = {
  overall_score: number;
  recommendation: string;
  summary: string;
  scores: Record<
    string,
    {
      score: number;
      comment: string;
      evidence_seq?: number[];
      not_assessed?: boolean;
    }
  >;
  strengths: Array<{ text: string; evidence_seq?: number[] }>;
  concerns: Array<{ text: string; evidence_seq?: number[] }>;
  to_verify: string[];
  followup_questions: string[];
  key_phrases?: string[];
};

type Seg = {
  seq: number;
  role: "candidate" | "interviewer" | "unknown" | null;
  speakerLabel: string | null;
  startMs: number | null;
  endMs: number | null;
  text: string;
  lowConfidence: boolean;
};

type RI = {
  id: number;
  round: "round1" | "round2";
  mode: "upload" | "live";
  status: "recording" | "queued" | "processing" | "ready" | "failed" | "confirmed";
  durationSeconds: number;
  report: Report | null;
  error: string | null;
  reportConfirmedAt: string | null;
  createdAt: string;
  segments: Seg[];
};

function fmtDuration(sec: number): string {
  if (!sec || sec < 1) return "-";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}분 ${s}초` : `${s}초`;
}

function fmtMs(ms: number | null): string {
  if (ms == null || ms < 0) return "";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// 전사 텍스트에서 AI 가 고른 핵심 표현(verbatim)을 굵게 — 화자 분리에서 눈에 띄게.
function highlightPhrases(text: string, phrases: string[]): ReactNode {
  const list = phrases
    .filter((p) => p && p.trim().length >= 2)
    .sort((a, b) => b.length - a.length);
  if (list.length === 0) return text;
  const esc = list.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  let re: RegExp;
  try {
    re = new RegExp(`(${esc.join("|")})`, "g");
  } catch {
    return text;
  }
  return text.split(re).map((part, i) =>
    list.includes(part) ? (
      <strong key={i} className="font-semibold text-ink">
        {part}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

function roleKo(role: Seg["role"]): string {
  return role === "candidate"
    ? "지원자"
    : role === "interviewer"
      ? "면접관"
      : "미상";
}

function roleClass(role: Seg["role"]): string {
  // 지원자 답변만 하늘색으로 강조 — 면접관/미상은 무색(중립 회색 배지).
  return role === "candidate"
    ? "bg-card text-info border border-info/40"
    : "bg-surface-alt text-ink-soft border border-border-default";
}

// 라운드별 "대면 면접 평가" — 상위 "N차 면접" 섹션 안에 임베드되는 content-only 블록.
// (자체 Section 없음, 라운드 선택기 없음 — 라운드는 prop 으로 고정.)
export function RecordedInterviewPanel({
  candidateId,
  round,
  canModify,
  onCompletedChange,
}: {
  candidateId: number;
  round: "round1" | "round2";
  canModify: boolean;
  // 완료된 대면 평가의 요약 메타(모드·길이·일시) 문자열을 부모에 통지(미완료면 null) —
  // 부모가 "면접 문제 생성" UI를 숨기고 섹션 요약("대면 평가 완료 · …")에 덧붙인다.
  onCompletedChange?: (summary: string | null) => void;
}) {
  const [interviews, setInterviews] = useState<RI[] | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);
  const [consent, setConsent] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const r = await fetch(`/api/candidates/${candidateId}/recorded-interview`);
    if (r.ok) {
      const body = (await r.json()) as { interviews: RI[] };
      setInterviews(body.interviews);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateId]);

  // 이 라운드 건만 표시.
  const roundInterviews = (interviews ?? []).filter((i) => i.round === round);

  // 이 라운드의 대면 면접 평가가 이미 완료(리포트 생성/확정)됐는지.
  // 완료됐으면 업로드/라이브 녹음 영역은 불필요한 클러터라 숨긴다. 성공한 평가는 이미 과금됐으므로
  // 재평가 버튼을 두지 않는다 — 재평가는 '실패' 카드에서만 (정책: 차감 기능은 오류 시에만 재평가,
  // 과금은 실행 후 성공 시 차감). 예외는 이력서평가(서류 스크리닝)뿐.
  // 이 라운드의 완료된(ready/confirmed) 대면 평가 — 보통 1건. 메타(모드·길이·일시)는
  // 카드 헤더 대신 섹션 요약으로 끌어올려 표시하므로 여기서 한 줄로 만들어 부모에 넘긴다.
  const completedRi =
    roundInterviews.find(
      (i) => i.status === "ready" || i.status === "confirmed"
    ) ?? null;
  const hasCompletedReport = completedRi !== null;
  const completedSummary = completedRi
    ? `${completedRi.mode === "live" ? "준실시간" : "업로드"} ${fmtDuration(completedRi.durationSeconds)} · ${formatKstDateTime(completedRi.createdAt)}`
    : null;

  // 완료 메타(또는 null)를 부모에 통지 — 부모는 완료 시 "면접 문제 생성" UI를 숨기고
  // 섹션 요약에 이 메타를 덧붙인다.
  useEffect(() => {
    onCompletedChange?.(completedSummary);
  }, [completedSummary, onCompletedChange]);

  // 백그라운드 처리 중인 건이 있으면 폴링 — 업로드 후 새로고침/재방문해도 진행상태가
  // 그대로 보이고, 워커가 끝내면 자동으로 리포트로 갱신된다 (사용자가 새로고침할 필요 없음).
  const hasActive = roundInterviews.some(
    (i) => i.status === "queued" || i.status === "processing"
  );
  useEffect(() => {
    if (!hasActive) return;
    const t = window.setInterval(() => {
      void load();
    }, 4000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasActive]);

  const upload = async () => {
    if (!file || uploading) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("audio", file);
      fd.append("round", round);
      fd.append("consentConfirmed", "true");
      const r = await fetch(
        `/api/candidates/${candidateId}/recorded-interview`,
        { method: "POST", body: fd }
      );
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        let msg = t;
        try {
          const j = JSON.parse(t) as { message?: string };
          if (j.message) msg = j.message;
        } catch {
          /* plain text */
        }
        notify(msg || "업로드에 실패했습니다.", {
          title: "업로드 실패",
          tone: "danger",
        });
        return;
      }
      notify(
        "업로드 완료. 전사·평가는 백그라운드에서 진행됩니다 — 이 화면을 닫거나 새로고침해도 됩니다.",
        { title: "업로드 완료", tone: "success" }
      );
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await load();
    } catch {
      notify("네트워크 오류가 발생했습니다.", {
        title: "오류",
        tone: "danger",
      });
    } finally {
      setUploading(false);
    }
  };

  const reevalReport = async (riId: number) => {
    const r = await fetch(`/api/candidates/${candidateId}/recorded-interview`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recordedInterviewId: riId, action: "reevaluate" }),
    });
    if (!r.ok) {
      notify(await r.text(), { title: "재평가 실패", tone: "danger" });
      return;
    }
    // 202 — 백그라운드 재평가 시작. status='processing' 으로 바뀌고 폴링이 완료까지 인계한다
    // (재평가 중 새로고침/이탈해도 됨). 실패는 카드의 'failed' 상태로 표시된다.
    await load();
  };

  const roundLabel = round === "round2" ? "2차" : "1차";

  return (
    <div
      className={
        hasCompletedReport
          ? "space-y-4"
          : "space-y-4 pt-4 mt-2 border-t border-border-default"
      }
    >
      {/* 평가 완료 시엔 섹션 제목·요약("대면 평가 완료")과 카드 헤더(차수·날짜)로 충분 —
          중복 레이블과 구분선을 숨겨 불필요한 영역을 줄인다. */}
      {!hasCompletedReport && (
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ink-soft">
            대면 면접 평가
          </span>
          <span className="text-[11px] text-ink-muted">
            {roundLabel} 면접 · 녹음 업로드 또는 라이브
          </span>
        </div>
      )}
      {!hasCompletedReport && (
        <p className="text-sm text-ink-soft leading-relaxed">
          사람이 진행한 <strong>대면 면접</strong>을 녹음 업로드하거나 라이브로
          진행하면, 전사 → 화자 분리 → AI 역량 평가 리포트를 만들어 줍니다. 녹음
          파일은 보관하지 않습니다.
        </p>
      )}

      {canModify && liveOpen && (
        <LiveRecorder
          candidateId={candidateId}
          round={round}
          consentConfirmed={consent}
          onClose={() => setLiveOpen(false)}
          onFinished={() => {
            setLiveOpen(false);
            void load();
          }}
        />
      )}

      {canModify && !liveOpen && !hasCompletedReport && (
        <div className="rounded-xl border border-border-default bg-surface-alt p-4 space-y-3">
          <label className="flex items-start gap-2 text-xs text-ink-soft cursor-pointer select-none">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 accent-primary"
            />
            <span>
              지원자에게 <strong>면접 녹취·전사·AI 평가 활용</strong>에 대한 동의를
              받았습니다. (녹음 파일은 전사 후 보관하지 않습니다)
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,video/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={uploading}
              className="text-sm text-ink-soft file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border file:border-border-strong file:bg-card file:text-ink-soft file:text-sm file:cursor-pointer disabled:opacity-50"
            />
            <button
              onClick={upload}
              disabled={!file || uploading || !consent}
              className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-surface text-sm font-medium shadow-sm disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {uploading && <Loader2 className="w-4 h-4 animate-spin" />}
              {uploading ? "업로드 중..." : "녹음 업로드"}
            </button>
            <span className="text-ink-muted px-1" aria-hidden>
              |
            </span>
            <button
              onClick={() => setLiveOpen(true)}
              disabled={uploading || !consent}
              className="px-4 py-2 rounded-lg border border-primary/40 text-primary-deep hover:bg-primary-soft text-sm font-medium disabled:opacity-50"
            >
              ● 라이브 녹음
            </button>
          </div>
          {uploading ? (
            <p className="text-xs text-ink-muted">
              업로드 중입니다... 업로드가 끝나면 전사·평가는 백그라운드에서
              진행되니, 이 화면을 닫거나 새로고침해도 됩니다.
            </p>
          ) : (
            <p className="text-xs text-ink-muted">
              오디오/영상 파일 (최대 18MB). 라이브 녹음은 브라우저로 즉시 받아쓰며
              최대 1시간까지 가능합니다.
            </p>
          )}
        </div>
      )}

      {/* 리포트 목록 (이 라운드) */}
      {interviews === null ? (
        <p className="text-sm text-ink-muted">불러오는 중...</p>
      ) : roundInterviews.length === 0 ? (
        !canModify && (
          <p className="text-sm text-ink-muted">
            아직 {roundLabel} 대면 면접 평가가 없습니다.
          </p>
        )
      ) : (
        <div className="space-y-4">
          {roundInterviews.map((ri) => (
            <RecordedReportCard
              key={ri.id}
              ri={ri}
              canModify={canModify}
              onReevaluate={() => reevalReport(ri.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EvidenceChips({
  seqs,
  onJump,
}: {
  seqs: number[] | undefined;
  onJump: (seq: number) => void;
}) {
  if (!seqs || seqs.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-1 ml-1 align-middle">
      {seqs.map((s) => (
        <button
          key={s}
          onClick={() => onJump(s)}
          className="text-[11px] px-1.5 py-0.5 rounded-md border border-primary/30 bg-primary-soft text-primary-deep hover:bg-white"
          title="근거 발언으로 이동"
        >
          근거 #{s}
        </button>
      ))}
    </span>
  );
}

function RecordedReportCard({
  ri,
  canModify,
  onReevaluate,
}: {
  ri: RI;
  canModify: boolean;
  onReevaluate: () => void;
}) {
  const [flash, setFlash] = useState<number | null>(null);
  const [reevaluating, setReevaluating] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  const jumpTo = (seq: number) => {
    // 접혀 있으면 펼친 뒤(렌더 후) 스크롤 — 근거 클릭 한 번으로 해당 발언까지.
    setTranscriptOpen(true);
    setFlash(seq);
    window.setTimeout(() => {
      const el = document.getElementById(`riseg-${ri.id}-${seq}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
    window.setTimeout(() => setFlash((f) => (f === seq ? null : f)), 1700);
  };

  const roundNo = ri.round === "round2" ? "2차" : "1차";
  const report = ri.report;
  // 완료(ready/confirmed)된 평가는 다른 평가(서류·AI면접)처럼 섹션 직속으로 점수부터 보여준다 —
  // 카드 테두리·헤더(차수·길이·일시) 없이. 메타는 섹션 요약으로 올라가 있다.
  const isCompleted =
    (ri.status === "ready" || ri.status === "confirmed") && !!report;

  return (
    <div
      className={
        isCompleted ? "" : "rounded-xl border border-border-default overflow-hidden"
      }
    >
      {/* 헤더(차수·길이·일시) — 처리중/실패 등 미완료 카드만. 완료 카드는 메타를 섹션 요약에 넘기고 헤더를 숨긴다. */}
      {!isCompleted && (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-surface-alt border-b border-border-default">
          <div className="flex items-center gap-2 text-xs">
            <span className="px-2 py-0.5 rounded-md bg-primary-soft text-primary-deep border border-primary/30 font-medium">
              {roundNo} 대면
            </span>
            <span className="text-ink-muted">
              {ri.mode === "live" ? "준실시간" : "업로드"} · {fmtDuration(ri.durationSeconds)}
            </span>
            <span className="text-ink-muted">{formatKstDateTime(ri.createdAt)}</span>
          </div>
        </div>
      )}

      {ri.status === "queued" ||
      ri.status === "processing" ||
      ri.status === "recording" ? (
        <div className="px-4 py-6 flex items-center gap-2 text-sm text-primary-deep">
          <Loader2 className="w-4 h-4 animate-spin" />
          {ri.status === "queued"
            ? "평가 대기 중입니다 — 곧 자동으로 시작됩니다."
            : "전사·평가 중입니다..."}
        </div>
      ) : ri.status === "failed" ? (
        <div className="px-4 py-5 space-y-3">
          <div className="text-sm text-danger">
            처리에 실패했습니다.
            {ri.error && (
              <span className="block text-xs text-ink-muted mt-1">
                사유: {ri.error}
              </span>
            )}
          </div>
          {/* 전사 세그먼트가 남아 있으면 재업로드(재전사) 없이 평가만 다시 시도 — 가장 싸고 빠른 복구.
              (성공 시 1회 과금. 전사 전에 실패한 경우엔 위 업로드 영역에서 다시 올린다.) */}
          {canModify &&
            (ri.segments.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={async () => {
                    setReevaluating(true);
                    try {
                      await onReevaluate();
                    } finally {
                      setReevaluating(false);
                    }
                  }}
                  disabled={reevaluating}
                  className="px-3 py-1.5 rounded-lg border border-primary/40 text-primary-deep hover:bg-primary-soft text-xs font-medium disabled:opacity-50 inline-flex items-center gap-1.5"
                  title="이미 전사된 내용으로 평가만 다시 시도합니다 (성공 시 과금)"
                >
                  {reevaluating && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  )}
                  평가 다시 시도
                </button>
                <span className="text-[11px] text-ink-muted">
                  전사는 완료됐습니다 — 평가만 다시 시도할 수 있어요.
                </span>
              </div>
            ) : (
              <p className="text-[11px] text-ink-muted">
                전사 전에 실패했습니다 — 위에서 녹음 파일을 다시 업로드해 주세요.
              </p>
            ))}
        </div>
      ) : !report ? (
        <div className="px-4 py-5 text-sm text-ink-muted">리포트 데이터 없음</div>
      ) : (
        <div
          className={
            isCompleted ? "space-y-5 text-sm" : "px-4 py-4 space-y-5 text-sm"
          }
        >
          {/* ① 결정 요약 */}
          <div className="flex items-baseline gap-3">
            <div
              className={`text-4xl font-bold tabular-nums ${scoreColor(report.overall_score)}`}
            >
              {report.overall_score}
            </div>
            <span className="text-sm text-ink-muted font-medium">/ 100</span>
            {showRec(report.recommendation) && (
              <span
                className={`ml-auto text-xs font-semibold px-2.5 py-1 rounded-md border ${recColor[report.recommendation]}`}
              >
                {report.recommendation}
              </span>
            )}
          </div>
          {report.summary && (
            <blockquote className="border-l-4 border-primary/40 bg-primary-soft/30 px-4 py-3 rounded-r-lg text-ink leading-relaxed">
              <HL text={report.summary} />
            </blockquote>
          )}

          {/* ② 역량 평가 */}
          <div className="space-y-3">
            {Object.entries(report.scores).map(([dim, v]) =>
              v.not_assessed ? (
                <div key={dim} className="opacity-70">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-ink-soft">{dim}</span>
                    <span className="text-[11px] font-medium text-ink-muted bg-surface-alt px-2 py-0.5 rounded-full whitespace-nowrap">
                      평가하지 못함
                    </span>
                  </div>
                  <p className="text-xs text-ink-muted leading-relaxed mt-1">
                    면접에서 이 항목에 대한 질문이 없어 평가하지 않았습니다.
                  </p>
                </div>
              ) : (
                <div key={dim}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-ink">{dim}</span>
                    <span
                      className={`text-xs font-bold tabular-nums ${scoreColor(v.score)}`}
                    >
                      {v.score}
                    </span>
                  </div>
                  <div className="h-1.5 bg-surface-alt rounded-full overflow-hidden my-1.5">
                    <div
                      className={`h-full rounded-full ${scoreBarColor(v.score)}`}
                      style={{ width: `${Math.max(0, Math.min(100, v.score))}%` }}
                    />
                  </div>
                  {v.comment && (
                    <p className="text-xs text-ink-soft leading-relaxed">
                      <HL text={v.comment} />
                      <EvidenceChips seqs={v.evidence_seq} onJump={jumpTo} />
                    </p>
                  )}
                </div>
              )
            )}
          </div>

          {/* 강점 / 우려 */}
          {/* 강점/우려 — 이력서·AI면접의 BulletBlock 과 동일한 시각(점 불릿 + 동일 제목색).
              대면만의 차이는 근거(`근거 #N`) 칩뿐. */}
          {report.strengths.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider mb-2 text-primary-deep">
                강점
              </div>
              <ul className="space-y-1.5">
                {report.strengths.map((s, i) => (
                  <li key={i} className="flex gap-2 text-ink-soft">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 shrink-0" />
                    <span className="leading-relaxed">
                      <HL text={withLeadEmphasis(s.text)} />
                      <EvidenceChips seqs={s.evidence_seq} onJump={jumpTo} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {report.concerns.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider mb-2 text-warning">
                우려
              </div>
              <ul className="space-y-1.5">
                {report.concerns.map((c, i) => (
                  <li key={i} className="flex gap-2 text-ink-soft">
                    <span className="w-1.5 h-1.5 rounded-full bg-warning mt-2 shrink-0" />
                    <span className="leading-relaxed">
                      <HL text={withLeadEmphasis(c.text)} />
                      <EvidenceChips seqs={c.evidence_seq} onJump={jumpTo} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ③ 화자 분리 전사 */}
          {ri.segments.length > 0 && (
            <div className="rounded-lg border border-border-default overflow-hidden">
              <button
                type="button"
                onClick={() => setTranscriptOpen((o) => !o)}
                aria-expanded={transcriptOpen}
                className="w-full flex items-center justify-between px-3 py-2 bg-surface-alt border-b border-border-default hover:bg-surface-alt transition-colors"
              >
                <span className="text-xs font-semibold text-ink-soft">
                  화자 분리 전사 · {ri.segments.length}개 발언
                </span>
                <span className="flex items-center gap-1.5 text-[11px] text-ink-muted">
                  {transcriptOpen ? "접기" : "펼치기"}
                  <span
                    className={`transition-transform ${transcriptOpen ? "rotate-90" : ""}`}
                    aria-hidden
                  >
                    ▶
                  </span>
                </span>
              </button>
              {transcriptOpen && (
                <div className="max-h-[26rem] overflow-y-auto divide-y divide-border-default">
                  {ri.segments.map((s) => {
                    const isCand = s.role === "candidate";
                    // 지원자 답변만 하늘색, 면접관/미상은 무색.
                    const rowTone =
                      flash === s.seq
                        ? "bg-warning-soft"
                        : isCand
                          ? "bg-info-soft"
                          : "bg-card";
                    return (
                      <div
                        key={s.seq}
                        id={`riseg-${ri.id}-${s.seq}`}
                        className={`px-3 py-2 transition-colors ${rowTone}`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${roleClass(s.role)}`}
                          >
                            {roleKo(s.role)}
                          </span>
                          {fmtMs(s.startMs) && (
                            <span className="text-[10px] text-ink-muted tabular-nums">
                              {fmtMs(s.startMs)}
                            </span>
                          )}
                          <span className="text-[10px] text-ink-muted">
                            #{s.seq}
                          </span>
                          {s.lowConfidence && (
                            <span
                              className="text-[10px] text-warning"
                              title="저신뢰 전사 구간 — 검수 권장"
                            >
                              · 저신뢰
                            </span>
                          )}
                        </div>
                        <p className="text-xs leading-relaxed text-ink">
                          {highlightPhrases(s.text, report?.key_phrases ?? [])}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

        </div>
      )}
    </div>
  );
}
