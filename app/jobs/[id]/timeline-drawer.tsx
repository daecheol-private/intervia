"use client";

/**
 * 공고 활동 타임라인 — 헤더 아이콘 버튼 + 우측 슬라이드 드로어.
 * GET /api/jobs/[id]/timeline 의 감사 이벤트를 날짜별로 묶어 시간순 표시.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Archive,
  ArrowRight,
  CalendarCheck,
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  FileEdit,
  FilePlus2,
  FileQuestion,
  FileUp,
  History,
  Link2,
  Mail,
  MessageSquare,
  Mic,
  Play,
  RefreshCw,
  ScanSearch,
  Send,
  ShieldAlert,
  Trash2,
  UserMinus,
  UserPlus,
  UserX,
  X,
  type LucideIcon,
} from "lucide-react";
import { STAGE_LABELS, type Stage } from "@/lib/stage-meta";
import { formatLocalDate, formatLocalDateTime, parseDbTimestamp } from "@/lib/utils";

type TimelineEvent = {
  id: number;
  action: string;
  createdAt: string;
  actorRole: string | null;
  actorName: string | null;
  candidateId: number | null;
  candidateName: string | null;
  candidateExists: boolean;
  metadata: Record<string, unknown>;
};

type Tone = "neutral" | "info" | "success" | "danger" | "warn";

const TONE_STYLES: Record<Tone, string> = {
  neutral: "bg-surface-alt text-ink-soft border-border-default",
  info: "bg-azure-soft text-azure-ink border-azure/40",
  success: "bg-success-soft text-success border-success/30",
  danger: "bg-danger-soft text-danger border-danger/30",
  warn: "bg-warning-soft text-warning border-warning/30",
};

const stageLabel = (v: unknown): string =>
  typeof v === "string" && v in STAGE_LABELS ? STAGE_LABELS[v as Stage] : String(v ?? "?");

const slotLabel = (slot: unknown): string | null => {
  if (!slot || typeof slot !== "object") return null;
  const s = (slot as { start?: unknown }).start;
  return typeof s === "string" ? formatLocalDateTime(s) : null;
};

const roundLabel = (v: unknown): string => (v === "round2" ? "2차" : "1차");

/** action + metadata → 표시 제목/상세/아이콘/톤. */
function describe(e: TimelineEvent): {
  icon: LucideIcon;
  title: string;
  detail: string | null;
  tone: Tone;
} {
  const m = e.metadata;
  const kind = typeof m.kind === "string" ? m.kind : null;

  switch (e.action) {
    case "job.create":
      return { icon: FilePlus2, title: "공고 등록", detail: null, tone: "neutral" };
    case "job.draft_create":
      return { icon: FilePlus2, title: "공고 임시저장", detail: null, tone: "neutral" };
    case "job.finalize_draft":
      return { icon: FilePlus2, title: "임시저장 공고 게시", detail: null, tone: "neutral" };
    case "job.update":
      return { icon: FileEdit, title: "공고 수정", detail: null, tone: "neutral" };
    case "job.close": {
      const n = Number(m.rejectedCount ?? 0);
      return {
        icon: Archive,
        title: "공고 종결",
        detail: n > 0 ? `진행 중 후보 ${n}명 불합격 처리` : null,
        tone: "warn",
      };
    }
    case "job.reopen": {
      const until = typeof m.closesAt === "string" ? formatLocalDate(m.closesAt) : null;
      return {
        icon: CalendarPlus,
        title: "공고 재개",
        detail: until ? `종결 예정일 ${until}` : null,
        tone: "neutral",
      };
    }
    case "job.extend": {
      const until = typeof m.newClosesAt === "string" ? formatLocalDate(m.newClosesAt) : null;
      return {
        icon: CalendarPlus,
        title: "공고 연장",
        detail: until ? `종결 예정일 ${until}` : null,
        tone: "neutral",
      };
    }
    case "job.interviewer_add":
      return { icon: UserPlus, title: "면접관 참여", detail: null, tone: "neutral" };
    case "job.interviewer_remove":
      return { icon: UserMinus, title: "면접관 제외", detail: null, tone: "neutral" };

    case "candidate.upload_with_consent":
      return { icon: FileUp, title: "이력서 등록", detail: null, tone: "neutral" };
    case "consent.submit":
      return m.source === "apply_link"
        ? { icon: Send, title: "지원자 직접 지원 (지원 링크)", detail: null, tone: "info" }
        : { icon: Send, title: "동의 제출", detail: null, tone: "info" };

    case "screen.trigger":
    case "screen.retry_now":
      return { icon: ScanSearch, title: "서류 평가 시작", detail: null, tone: "neutral" };
    case "screen.bulk_trigger": {
      const n = Number(m.enqueued ?? 0) + Number(m.kicked ?? 0);
      return {
        icon: ScanSearch,
        title: `서류 평가 일괄 시작${n > 0 ? ` (${n}건)` : ""}`,
        detail: null,
        tone: "neutral",
      };
    }

    case "candidate.stage_change":
    case "user.status_change": {
      const oc = m.outcome_change as { to?: unknown; reason?: unknown } | undefined;
      if (oc?.to) {
        const to = String(oc.to);
        return {
          icon: to === "hired" ? CheckCircle2 : to === "rejected" ? UserX : UserMinus,
          title: `종결 — ${stageLabel(to)}`,
          detail: null,
          tone: to === "hired" ? "success" : to === "rejected" ? "danger" : "neutral",
        };
      }
      const sc = m.stage_change as { from?: unknown; to?: unknown } | undefined;
      if (sc?.to) {
        return {
          icon: ArrowRight,
          title: `단계 변경: ${stageLabel(sc.from)} → ${stageLabel(sc.to)}`,
          detail: null,
          tone: "neutral",
        };
      }
      if (kind === "candidate_edit")
        return { icon: FileEdit, title: "후보자 정보 수정", detail: null, tone: "neutral" };
      if (kind === "meeting_link_sent")
        return { icon: Link2, title: "온라인 미팅 링크 발송", detail: null, tone: "neutral" };
      return { icon: FileEdit, title: "상태 변경", detail: null, tone: "neutral" };
    }

    case "interview.create": {
      if (kind === "recorded_interview_upload")
        return { icon: Mic, title: "대면 면접 녹음 업로드", detail: `${roundLabel(m.round)} 면접`, tone: "neutral" };
      if (kind === "recorded_interview_live_start")
        return { icon: Mic, title: "라이브 면접 녹음 시작", detail: `${roundLabel(m.round)} 면접`, tone: "neutral" };
      if (kind === "recorded_interview_confirm")
        return { icon: CheckCircle2, title: "대면 면접 리포트 확정", detail: null, tone: "neutral" };
      return { icon: Link2, title: "AI 면접 링크 발급", detail: null, tone: "neutral" };
    }

    case "interview.send_email": {
      if (kind === "schedule_propose") {
        const sent = Number(m.sent ?? 0);
        return {
          icon: CalendarClock,
          title: `${roundLabel(m.round)} 면접 일정 제시`,
          detail: sent > 0 ? `${sent}명에게 발송` : null,
          tone: "neutral",
        };
      }
      if (kind === "interview_link_bulk") {
        const sent = Number(m.sent ?? 0);
        return {
          icon: Mail,
          title: "AI 면접 안내 일괄 발송",
          detail: `${sent}명 발송${Number(m.failed ?? 0) > 0 ? ` · ${Number(m.failed)}건 실패` : ""}`,
          tone: "neutral",
        };
      }
      if (kind === "decision_notify" || kind === "decision_notify_resend") {
        const d = String(m.decision ?? "");
        return {
          icon: Mail,
          title: `결과 통보 메일 발송${kind === "decision_notify_resend" ? " (재발송)" : ""}`,
          detail: d ? stageLabel(d) : null,
          tone: d === "hired" ? "success" : d === "rejected" ? "danger" : "neutral",
        };
      }
      return { icon: Mail, title: "AI 면접 안내 메일 발송", detail: null, tone: "neutral" };
    }

    case "interview.start":
      return { icon: Play, title: "지원자가 AI 면접을 시작했습니다", detail: null, tone: "info" };
    case "interview.complete":
      return { icon: CheckCircle2, title: "지원자가 AI 면접을 완료했습니다", detail: null, tone: "info" };
    case "interview.reevaluate":
      return { icon: RefreshCw, title: "AI 면접 재평가", detail: null, tone: "neutral" };
    case "interview_questions.generate":
      return {
        icon: FileQuestion,
        title: `${roundLabel(m.round)} 면접 질문지 생성`,
        detail: null,
        tone: "neutral",
      };

    case "schedule.select": {
      const t = slotLabel(m.slot);
      return {
        icon: CalendarCheck,
        title: `지원자가 ${roundLabel(m.round)} 면접 시간을 확정했습니다`,
        detail: t,
        tone: "info",
      };
    }
    case "schedule.counter":
      return {
        icon: MessageSquare,
        title: `지원자가 ${roundLabel(m.round)} 면접 시간을 역제안했습니다`,
        detail: null,
        tone: "info",
      };
    case "schedule.withdraw":
      return { icon: UserX, title: "지원자가 지원을 취소했습니다", detail: null, tone: "danger" };
    case "schedule.hr_confirm": {
      const t = slotLabel(m.slot);
      return {
        icon: CalendarCheck,
        title: `${roundLabel(m.round)} 면접 일정 확정`,
        detail: t,
        tone: "neutral",
      };
    }
    case "schedule.manual_confirm": {
      const t = slotLabel(m.slot);
      return {
        icon: CalendarCheck,
        title: `${roundLabel(m.round)} 면접 일정 수동 등록`,
        detail: t,
        tone: "neutral",
      };
    }

    case "appeal.submit":
      return { icon: ShieldAlert, title: "지원자 이의제기 접수", detail: null, tone: "warn" };

    case "candidate.delete":
      return { icon: Trash2, title: "후보자 삭제", detail: null, tone: "danger" };
    case "candidate.bulk_delete": {
      const n = Number(m.count ?? 0);
      return {
        icon: Trash2,
        title: `후보자 일괄 삭제${n > 0 ? ` (${n}명)` : ""}`,
        detail: null,
        tone: "danger",
      };
    }

    default:
      return { icon: History, title: e.action, detail: null, tone: "neutral" };
  }
}

function actorLabel(e: TimelineEvent): string {
  if (e.actorRole === "candidate") return "지원자";
  if (e.actorRole === "system") return "시스템";
  return e.actorName ?? "알 수 없음";
}

function dateHeading(iso: string): string {
  const day = formatLocalDate(iso);
  const weekday = parseDbTimestamp(iso).toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul",
    weekday: "short",
  });
  const today = formatLocalDate(new Date());
  const yesterday = formatLocalDate(new Date(Date.now() - 86_400_000));
  if (day === today) return `오늘 · ${day} (${weekday})`;
  if (day === yesterday) return `어제 · ${day} (${weekday})`;
  return `${day} (${weekday})`;
}

export function TimelineButton({ jobId }: { jobId: number }) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(
    async (before?: number) => {
      const isMore = before != null;
      if (isMore) setLoadingMore(true);
      else {
        setLoading(true);
        setErr("");
      }
      try {
        const qs = before != null ? `?before=${before}` : "";
        const r = await fetch(`/api/jobs/${jobId}/timeline${qs}`);
        if (!r.ok) throw new Error(await r.text());
        const data = (await r.json()) as {
          events: TimelineEvent[];
          nextCursor: number | null;
        };
        setEvents((prev) => (isMore ? [...prev, ...data.events] : data.events));
        setNextCursor(data.nextCursor);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "타임라인을 불러오지 못했습니다.");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [jobId]
  );

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // 날짜별 그룹 (응답이 이미 최신순).
  const groups: { day: string; items: TimelineEvent[] }[] = [];
  for (const e of events) {
    const day = dateHeading(e.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(e);
    else groups.push({ day, items: [e] });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="활동 타임라인"
        aria-label="활동 타임라인"
        className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-border-strong text-ink-soft hover:bg-surface-alt hover:text-ink transition-colors"
      >
        <History className="w-4 h-4" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="absolute inset-0 bg-ink/40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="relative w-full max-w-xl h-full bg-card shadow-2xl overflow-y-auto">
            <div className="sticky top-0 bg-card border-b border-border-default px-6 py-4 flex items-center justify-between gap-3 z-10">
              <div>
                <h2 className="text-lg font-bold text-ink flex items-center gap-2">
                  <History className="w-5 h-5 text-primary-deep" />
                  활동 타임라인
                </h2>
                <p className="text-xs text-ink-muted mt-0.5">
                  이 공고에서 일어난 일을 시간순으로 보여줍니다.
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => void load()}
                  disabled={loading}
                  title="새로고침"
                  aria-label="새로고침"
                  className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-border-strong text-ink-soft hover:bg-surface-alt hover:text-ink transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                </button>
                <button
                  onClick={() => setOpen(false)}
                  title="닫기"
                  aria-label="닫기"
                  className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-border-strong text-ink-soft hover:bg-surface-alt hover:text-ink transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="px-6 py-5">
              {err && (
                <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg p-3 mb-4">
                  {err}
                </div>
              )}

              {loading && events.length === 0 ? (
                <div className="text-sm text-ink-muted py-10 text-center">불러오는 중...</div>
              ) : events.length === 0 && !err ? (
                <div className="text-sm text-ink-muted py-10 text-center border border-dashed border-border-default rounded-xl">
                  아직 기록된 활동이 없습니다.
                  <p className="text-xs mt-1.5 text-ink-soft">
                    단계 변경 · 일정 제시 · AI 면접 응시 등이 여기에 쌓입니다.
                  </p>
                </div>
              ) : (
                groups.map((g) => (
                  <div key={g.day} className="mb-6 last:mb-0">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-3">
                      {g.day}
                    </div>
                    <ol className="relative border-l border-border-default ml-3.5 space-y-4">
                      {g.items.map((e) => {
                        const d = describe(e);
                        const Icon = d.icon;
                        return (
                          <li key={e.id} className="relative pl-6">
                            <span
                              className={`absolute -left-3.5 top-0 inline-flex items-center justify-center w-7 h-7 rounded-full border ${TONE_STYLES[d.tone]}`}
                            >
                              <Icon className="w-3.5 h-3.5" />
                            </span>
                            <div className="min-w-0">
                              <div className="text-sm text-ink leading-snug">
                                {e.candidateName && (
                                  <>
                                    {e.candidateExists && e.candidateId != null ? (
                                      <Link
                                        href={`/candidates/${e.candidateId}`}
                                        className="font-semibold text-primary-deep hover:underline"
                                      >
                                        {e.candidateName}
                                      </Link>
                                    ) : (
                                      <span className="font-semibold text-ink-soft">
                                        {e.candidateName}
                                      </span>
                                    )}
                                    <span className="text-ink-muted mx-1">·</span>
                                  </>
                                )}
                                <span>{d.title}</span>
                              </div>
                              {d.detail && (
                                <div className="text-xs text-ink-soft mt-0.5">{d.detail}</div>
                              )}
                              <div className="text-[11px] text-ink-muted mt-1">
                                {actorLabel(e)}
                                <span className="mx-1">·</span>
                                {formatLocalDateTime(e.createdAt)}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                ))
              )}

              {nextCursor != null && (
                <button
                  onClick={() => void load(nextCursor)}
                  disabled={loadingMore}
                  className="w-full mt-2 px-4 py-2 rounded-lg border border-border-strong text-sm text-ink-soft hover:bg-surface-alt transition-colors disabled:opacity-50"
                >
                  {loadingMore ? "불러오는 중..." : "더 보기"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
