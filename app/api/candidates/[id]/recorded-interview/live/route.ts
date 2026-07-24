import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  interviewTranscriptSegments,
  recordedInterviews,
} from "@/lib/schema";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { guardCandidate } from "@/lib/candidate-guard";
import {
  insufficientTokensResponse,
  requireSpendableBalance,
} from "@/lib/wallet-guard";
import {
  cleanLiveTranscriptChunk,
  finalizeRecordedInterview,
  suggestLiveQuestions,
} from "@/lib/recorded-interview";
import type { JobInfo } from "@/lib/prompts";
import { logAudit } from "@/lib/audit";
import { log } from "@/lib/logger";
import {
  MIN_INTERVIEW_DURATION_SECONDS,
  TOO_SHORT_INTERVIEW_MESSAGE,
} from "@/lib/upload-validation";

export const runtime = "nodejs";
export const maxDuration = 300;

async function loadLiveRi(cid: number, riId: number) {
  const [ri] = await db
    .select()
    .from(recordedInterviews)
    .where(
      and(
        eq(recordedInterviews.id, riId),
        eq(recordedInterviews.candidateId, cid)
      )
    );
  return ri ?? null;
}

/**
 * 준실시간 라이브 면접 — 브라우저 STT(Web Speech API) 기반. action 분기:
 *  - start  : 라이브 recorded_interview 생성 (status=recording).
 *  - clean  : STT 원문 일부를 화자별로 정리 → 세그먼트 누적(역할 포함). 오디오는 받지 않는다.
 *  - finish : finalize (평가 → 후차감). 라이브는 역할이 이미 박혀 있어 바로 평가.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { id } = await params;
  const cid = Number(id);
  if (!Number.isInteger(cid))
    return new Response("잘못된 후보자 ID", { status: 400 });

  const g = await guardCandidate(me!, cid);
  if (!g.ok) return g.res;
  const { candidate, job } = g;

  const body = (await req.json().catch(() => null)) as
    | {
        action?: string;
        round?: string;
        recordedInterviewId?: number;
        rawText?: string;
        durationSeconds?: number;
        consentConfirmed?: boolean;
      }
    | null;
  if (!body) return new Response("바디가 필요합니다.", { status: 400 });

  // ── start ──────────────────────────────────────────────
  if (body.action === "start") {
    const balanceGuard = await requireSpendableBalance(candidate.orgId, {
      isSystemAdmin: me!.role === "system_admin",
    });
    if (!balanceGuard.ok) return insufficientTokensResponse(balanceGuard);

    // 녹취 동의 attestation 필수 (PIPA).
    if (body.consentConfirmed !== true)
      return new Response(
        "지원자에게 녹취·전사·AI 평가 동의를 받았음을 먼저 확인해 주세요.",
        { status: 400 }
      );

    const round = body.round === "round2" ? "round2" : "round1";
    const [ri] = await db
      .insert(recordedInterviews)
      .values({
        orgId: candidate.orgId,
        jobId: candidate.jobId,
        candidateId: cid,
        round,
        mode: "live",
        status: "recording",
        createdByUserId: me!.id,
        consentConfirmedAt: sql`CURRENT_TIMESTAMP`,
        consentConfirmedByUserId: me!.id,
      })
      .returning({ id: recordedInterviews.id });

    logAudit(req, {
      actor: me!,
      action: "interview.create",
      resourceType: "candidate",
      resourceId: cid,
      orgId: candidate.orgId,
      jobId: candidate.jobId,
      metadata: {
        kind: "recorded_interview_live_start",
        recordedInterviewId: ri.id,
        round,
      },
    });
    return Response.json({ id: ri.id }, { status: 201 });
  }

  const riId = Number(body.recordedInterviewId);
  if (!Number.isInteger(riId))
    return new Response("recordedInterviewId 가 필요합니다.", { status: 400 });
  const ri = await loadLiveRi(cid, riId);
  if (!ri) return new Response("Not found", { status: 404 });

  // ── clean ──────────────────────────────────────────────
  // 브라우저 STT 원문 한 덩어리를 받아 화자별로 정리(역할 포함)해 누적. 오디오는 받지 않는다.
  if (body.action === "clean") {
    if (ri.status !== "recording")
      return new Response("녹음 상태가 아닙니다.", { status: 409 });
    const rawText = typeof body.rawText === "string" ? body.rawText : "";
    if (!rawText.trim()) return Response.json({ added: 0, segments: [] });
    if (rawText.length > 8000)
      return new Response("정리할 원문이 너무 깁니다.", { status: 413 });

    // 직전까지 정리된 맥락(최근 8개) — 화자 연속성 위해 LLM 에 함께 전달.
    const recent = await db
      .select({
        role: interviewTranscriptSegments.role,
        text: interviewTranscriptSegments.text,
      })
      .from(interviewTranscriptSegments)
      .where(eq(interviewTranscriptSegments.recordedInterviewId, riId))
      .orderBy(desc(interviewTranscriptSegments.seq))
      .limit(8);
    const recentContext = recent
      .reverse()
      .map((s) => `${s.role ?? "unknown"}: ${s.text}`)
      .join("\n");

    let cleaned: Awaited<ReturnType<typeof cleanLiveTranscriptChunk>>;
    try {
      cleaned = await cleanLiveTranscriptChunk({
        job: { position: job?.position ?? "면접", requirements: job?.requirements },
        recentContext,
        rawText,
      });
    } catch (e) {
      log.error("recorded_interview.live_clean_failed", e, {
        recordedInterviewId: riId,
      });
      return new Response("정리에 실패했습니다.", { status: 502 });
    }
    if (cleaned.length === 0) return Response.json({ added: 0, segments: [] });

    // 같은 역할 연속 발화는 한 턴으로 병합 — 문장마다 자르지 않고 화자가 바뀔 때만 row 분리.
    const turns: Array<{ role: (typeof cleaned)[number]["role"]; text: string }> =
      [];
    for (const c of cleaned) {
      const last = turns[turns.length - 1];
      if (last && last.role === c.role) last.text += " " + c.text;
      else turns.push({ role: c.role, text: c.text });
    }

    // 직전 저장 세그먼트와 첫 턴의 화자가 같으면 그 row 에 이어붙인다(배치 경계에서도 병합 유지).
    const [lastSeg] = await db
      .select({
        seq: interviewTranscriptSegments.seq,
        role: interviewTranscriptSegments.role,
        text: interviewTranscriptSegments.text,
      })
      .from(interviewTranscriptSegments)
      .where(eq(interviewTranscriptSegments.recordedInterviewId, riId))
      .orderBy(desc(interviewTranscriptSegments.seq))
      .limit(1);

    const changed: Array<{ seq: number; role: string; text: string }> = [];
    let startIdx = 0;
    if (lastSeg && turns[0] && lastSeg.role === turns[0].role) {
      const mergedText = `${lastSeg.text} ${turns[0].text}`;
      await db
        .update(interviewTranscriptSegments)
        .set({ text: mergedText })
        .where(
          and(
            eq(interviewTranscriptSegments.recordedInterviewId, riId),
            eq(interviewTranscriptSegments.seq, lastSeg.seq)
          )
        );
      changed.push({ seq: lastSeg.seq, role: lastSeg.role!, text: mergedText });
      startIdx = 1;
    }

    let seq = lastSeg ? lastSeg.seq : 0;
    const rows = turns.slice(startIdx).map((t) => ({
      recordedInterviewId: riId,
      seq: ++seq,
      speakerLabel: t.role,
      role: t.role,
      startMs: null,
      endMs: null,
      text: t.text,
      lowConfidence: false,
    }));
    if (rows.length) await db.insert(interviewTranscriptSegments).values(rows);
    changed.push(...rows.map((r) => ({ seq: r.seq, role: r.role, text: r.text })));

    return Response.json({ added: rows.length, segments: changed });
  }

  // ── finish ─────────────────────────────────────────────
  if (body.action === "finish") {
    const dur = Number(body.durationSeconds);
    // 5분 미만 = 오녹음 — 전사·평가·과금 스킵. recording 행을 too_short 실패로 마킹(실패 카드).
    // (주 경로인 doFinish 사전 차단이 이 경로도 함께 막지만, 서버에서 한 번 더 방어한다.)
    if (Number.isFinite(dur) && dur > 0 && dur < MIN_INTERVIEW_DURATION_SECONDS) {
      await db
        .update(recordedInterviews)
        .set({
          durationSeconds: Math.round(dur),
          status: "failed",
          error: TOO_SHORT_INTERVIEW_MESSAGE,
          completedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(recordedInterviews.id, riId));
      return Response.json({ status: "too_short" }, { status: 200 });
    }
    if (Number.isFinite(dur) && dur > 0) {
      await db
        .update(recordedInterviews)
        .set({ durationSeconds: Math.round(dur) })
        .where(eq(recordedInterviews.id, riId));
    }
    try {
      await finalizeRecordedInterview(riId);
    } catch {
      return Response.json({ status: "failed" }, { status: 200 });
    }
    return Response.json({ status: "ready" }, { status: 200 });
  }

  return new Response("지원하지 않는 action 입니다.", { status: 400 });
}

/** 라이브 어시스턴트 — 누적 전사 기반 추천 질문(답변요약/긍정/확인/추천). ?riId= */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { id } = await params;
  const cid = Number(id);
  if (!Number.isInteger(cid))
    return new Response("잘못된 후보자 ID", { status: 400 });

  const g = await guardCandidate(me!, cid);
  if (!g.ok) return g.res;
  const { job } = g;

  const url = new URL(req.url);
  const riId = Number(url.searchParams.get("riId"));
  if (!Number.isInteger(riId))
    return new Response("riId 가 필요합니다.", { status: 400 });
  // 이미 화면에 떠 있는 질문들 — 중복·유사 제안을 피하려고 LLM 에 함께 넘긴다.
  const have = (url.searchParams.get("have") ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10);
  const ri = await loadLiveRi(cid, riId);
  if (!ri) return new Response("Not found", { status: 404 });

  const segs = await db
    .select({
      speakerLabel: interviewTranscriptSegments.speakerLabel,
      text: interviewTranscriptSegments.text,
    })
    .from(interviewTranscriptSegments)
    .where(eq(interviewTranscriptSegments.recordedInterviewId, riId))
    .orderBy(asc(interviewTranscriptSegments.seq));

  const empty = { answer_summary: "", positives: [], to_confirm: [], suggestions: [] };
  if (segs.length === 0 || !job) return Response.json(empty);

  const transcript = segs
    .map((s) => `${(s.speakerLabel ?? "").replace(/^\d+#/, "")}: ${s.text}`)
    .join("\n");
  const jobInfo: JobInfo = {
    position: job.position,
    level: job.level,
    employmentType: job.employmentType,
    responsibilities: job.responsibilities,
    requirements: job.requirements,
    idealProfile: job.idealProfile,
    evaluationFocus: job.evaluationFocus,
  };
  try {
    return Response.json(await suggestLiveQuestions(jobInfo, transcript, have));
  } catch (e) {
    log.error("recorded_interview.live_suggest_failed", e, {
      recordedInterviewId: riId,
    });
    return new Response("추천 생성에 실패했습니다.", { status: 502 });
  }
}
