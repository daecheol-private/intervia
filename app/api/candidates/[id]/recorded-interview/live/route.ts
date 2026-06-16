import { and, asc, eq, sql } from "drizzle-orm";
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
  buildTranscriptionDomainHint,
  finalizeRecordedInterview,
  suggestLiveQuestions,
  transcribeAudio,
} from "@/lib/recorded-interview";
import type { JobInfo } from "@/lib/prompts";
import { logAudit } from "@/lib/audit";
import { log } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 300;

// 청크 1개 base64 한도 (디코딩 후 ~8MB). 준실시간이라 청크는 작다(20초 안팎).
const MAX_CHUNK_B64 = 12 * 1024 * 1024;

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
 * 준실시간 라이브 면접 — action 분기:
 *  - start  : 라이브 recorded_interview 생성 (status=recording).
 *  - chunk  : 오디오 청크 1개(base64) 전사 → 세그먼트 누적. 라벨은 청크별 고유화.
 *  - finish : finalize (역할 배정 → 평가 → 후차감).
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
        audioBase64?: string;
        mimeType?: string;
        baseMs?: number;
        chunkIndex?: number;
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

  // ── chunk ──────────────────────────────────────────────
  if (body.action === "chunk") {
    if (ri.status !== "recording")
      return new Response("녹음 상태가 아닙니다.", { status: 409 });
    const audioBase64 =
      typeof body.audioBase64 === "string" ? body.audioBase64 : "";
    const mimeType =
      typeof body.mimeType === "string" ? body.mimeType : "audio/webm";
    const baseMs = Number(body.baseMs) || 0;
    const chunkIndex = Number(body.chunkIndex) || 0;
    if (!audioBase64) return new Response("audioBase64 가 필요합니다.", { status: 400 });
    if (audioBase64.length > MAX_CHUNK_B64)
      return new Response("청크가 너무 큽니다.", { status: 413 });

    let segments: Awaited<ReturnType<typeof transcribeAudio>>;
    try {
      segments = await transcribeAudio(audioBase64, mimeType, {
        baseMs,
        timeoutMs: 90_000,
        domainHint: job ? buildTranscriptionDomainHint(job) : undefined,
      });
    } catch (e) {
      log.error("recorded_interview.live_chunk_transcribe_failed", e, {
        recordedInterviewId: riId,
        chunkIndex,
      });
      return new Response("청크 전사에 실패했습니다.", { status: 502 });
    }
    if (segments.length === 0) return Response.json({ added: 0, segments: [] });

    // 이어붙일 seq 시작점 (현재 최대 seq + 1).
    const [{ m }] = await db
      .select({
        m: sql<number>`COALESCE(MAX(${interviewTranscriptSegments.seq}), 0)`,
      })
      .from(interviewTranscriptSegments)
      .where(eq(interviewTranscriptSegments.recordedInterviewId, riId));
    let seq = Number(m) || 0;
    const rows = segments.map((s) => ({
      recordedInterviewId: riId,
      seq: ++seq,
      // 청크별 화자 라벨은 전역 비일관 → 청크 번호로 고유화. 종료 시 내용 기반 역할 배정이 매핑.
      speakerLabel: `${chunkIndex}#${s.speakerLabel}`,
      startMs: s.startMs,
      endMs: s.endMs,
      text: s.text,
      lowConfidence: s.lowConfidence,
    }));
    await db.insert(interviewTranscriptSegments).values(rows);

    const lastEnd = segments[segments.length - 1]?.endMs ?? baseMs;
    const dur = Math.round((lastEnd ?? baseMs) / 1000);
    if (dur > (ri.durationSeconds ?? 0)) {
      await db
        .update(recordedInterviews)
        .set({ durationSeconds: dur })
        .where(eq(recordedInterviews.id, riId));
    }

    return Response.json({
      added: rows.length,
      segments: rows.map((r) => ({
        seq: r.seq,
        text: r.text,
        lowConfidence: r.lowConfidence,
      })),
    });
  }

  // ── finish ─────────────────────────────────────────────
  if (body.action === "finish") {
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

  const riId = Number(new URL(req.url).searchParams.get("riId"));
  if (!Number.isInteger(riId))
    return new Response("riId 가 필요합니다.", { status: 400 });
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
    return Response.json(await suggestLiveQuestions(jobInfo, transcript));
  } catch (e) {
    log.error("recorded_interview.live_suggest_failed", e, {
      recordedInterviewId: riId,
    });
    return new Response("추천 생성에 실패했습니다.", { status: 502 });
  }
}
