import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
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
import { finalizeRecordedInterview } from "@/lib/recorded-interview";
import { triggerRecordedWorker } from "@/lib/recorded-interview-queue";
import { saveFile } from "@/lib/storage";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
// PATCH 재평가(finalize: 역할배정+평가 LLM 2회)가 기본 함수 한도를 넘을 수 있어 유지.
// (업로드 POST 는 저장+enqueue 뿐이라 짧다 — 전사·평가는 백그라운드 워커가 수행.)
export const maxDuration = 300;

// Gemini Vertex inline 데이터 한도 회피 — 업로드 1건당 오디오 최대 크기.
// 그 이상(장시간·고비트레이트)은 준실시간(청크) 모드 권장. 상세: docs/LIVE_INTERVIEW_PLAN.md
const MAX_AUDIO_BYTES = 18 * 1024 * 1024;

/**
 * 업로드 모드 — 대면 면접 녹음 파일 1개를 받아 **큐에 적재만** 하고 즉시 응답한다.
 * 오디오는 워커가 전사할 때까지만 임시 저장(Blob/로컬)하고 전사 직후 폐기한다.
 * 실제 전사 → 역할 배정 → 평가 → 리포트는 백그라운드 워커가 수행하므로,
 * 사용자는 업로드 후 페이지를 닫거나 새로고침해도 된다 (상태는 DB 에 영속).
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
  const { candidate } = g;

  // 유료 행위 — 잔액 0 이하면 차단 (후차감은 finalize 성공 시).
  const balanceGuard = await requireSpendableBalance(candidate.orgId, {
    isSystemAdmin: me!.role === "system_admin",
  });
  if (!balanceGuard.ok) return insufficientTokensResponse(balanceGuard);

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return new Response("multipart/form-data 가 필요합니다.", { status: 400 });
  }

  const audio = formData.get("audio");
  if (!(audio instanceof File))
    return new Response("audio 파일이 필요합니다.", { status: 400 });
  const mime = audio.type || "audio/webm";
  if (!/^(audio|video)\//.test(mime))
    return new Response("오디오 파일만 업로드할 수 있습니다.", { status: 400 });
  if (audio.size === 0) return new Response("빈 파일입니다.", { status: 400 });
  if (audio.size > MAX_AUDIO_BYTES)
    return new Response(
      `오디오가 너무 큽니다 (최대 ${Math.floor(
        MAX_AUDIO_BYTES / 1024 / 1024
      )}MB). 더 낮은 음질로 녹음하거나 준실시간 모드를 사용하세요.`,
      { status: 413 }
    );

  // 녹취 동의 attestation — 지원자 동의(녹취·전사·AI 평가) 확인 필수 (PIPA).
  const consentRaw = formData.get("consentConfirmed");
  if (consentRaw !== "true" && consentRaw !== "1" && consentRaw !== "on")
    return new Response(
      "지원자에게 녹취·전사·AI 평가 동의를 받았음을 먼저 확인해 주세요.",
      { status: 400 }
    );

  const round = formData.get("round") === "round2" ? "round2" : "round1";

  // 오디오 임시 저장(Blob/로컬) — 워커가 전사할 때까지만 보관, 전사 직후 폐기.
  let audioBlobKey: string;
  try {
    audioBlobKey = await saveFile(
      audio.name || `interview.${mime.split("/")[1] ?? "webm"}`,
      Buffer.from(await audio.arrayBuffer()),
      mime
    );
  } catch {
    return new Response("오디오 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.", {
      status: 502,
    });
  }

  // 큐 적재 — status='queued'. 전사·평가는 백그라운드 워커가 수행.
  const [ri] = await db
    .insert(recordedInterviews)
    .values({
      orgId: candidate.orgId,
      jobId: candidate.jobId,
      candidateId: cid,
      round,
      mode: "upload",
      status: "queued",
      createdByUserId: me!.id,
      consentConfirmedAt: sql`CURRENT_TIMESTAMP`,
      consentConfirmedByUserId: me!.id,
      durationSeconds: 0,
      audioBlobKey,
      audioMime: mime,
    })
    .returning({ id: recordedInterviews.id });

  logAudit(req, {
    actor: me!,
    action: "interview.create",
    resourceType: "candidate",
    resourceId: cid,
    orgId: candidate.orgId,
    metadata: {
      kind: "recorded_interview_upload",
      recordedInterviewId: ri.id,
      round,
    },
  });

  // 워커 즉시 깨우기 (fire-and-forget). 실패해도 매분 cron 안전망이 처리.
  triggerRecordedWorker(req);

  return Response.json({ id: ri.id, status: "queued" }, { status: 202 });
}

/** 후보자의 대면 면접 평가 목록 (리포트 + 전사 세그먼트 포함). */
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

  const interviews = await db
    .select()
    .from(recordedInterviews)
    .where(eq(recordedInterviews.candidateId, cid))
    .orderBy(desc(recordedInterviews.id));

  const ids = interviews.map((r) => r.id);
  const segs = ids.length
    ? await db
        .select()
        .from(interviewTranscriptSegments)
        .where(inArray(interviewTranscriptSegments.recordedInterviewId, ids))
        .orderBy(asc(interviewTranscriptSegments.seq))
    : [];
  const byRi = new Map<number, typeof segs>();
  for (const s of segs) {
    const arr = byRi.get(s.recordedInterviewId);
    if (arr) arr.push(s);
    else byRi.set(s.recordedInterviewId, [s]);
  }

  // 미처리 건이 있으면 워커를 깨운다(fire-and-forget). 로컬은 cron 이 없어, UI 폴링이
  // 부르는 이 GET 이 사실상 주기 트리거 역할 — 어떤 이유로 멈춰 있던 queued/processing 건이
  // 자동으로 재개·복구된다(워커는 cleanupStuck → claim 순). 워커는 atomic claim 이라 중복 처리 없음.
  if (interviews.some((r) => r.status === "queued" || r.status === "processing"))
    triggerRecordedWorker(req);

  return Response.json({
    interviews: interviews.map((r) => ({
      id: r.id,
      round: r.round,
      mode: r.mode,
      status: r.status,
      durationSeconds: r.durationSeconds,
      report: r.report,
      error: r.error,
      reportConfirmedAt: r.reportConfirmedAt,
      createdAt: r.createdAt,
      segments: (byRi.get(r.id) ?? []).map((s) => ({
        seq: s.seq,
        role: s.role,
        speakerLabel: s.speakerLabel,
        startMs: s.startMs,
        endMs: s.endMs,
        text: s.text,
        lowConfidence: s.lowConfidence,
      })),
    })),
  });
}

/** 리포트 확정 (AI 초안 → 사람 확정). body: { recordedInterviewId, action: "confirm" } */
export async function PATCH(
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

  const body = (await req.json().catch(() => null)) as {
    recordedInterviewId?: number;
    action?: string;
  } | null;
  const riId = Number(body?.recordedInterviewId);
  if (!body || !Number.isInteger(riId))
    return new Response("recordedInterviewId 가 필요합니다.", { status: 400 });
  if (body.action !== "confirm" && body.action !== "reevaluate")
    return new Response("지원하지 않는 action 입니다.", { status: 400 });

  const [ri] = await db
    .select()
    .from(recordedInterviews)
    .where(
      and(
        eq(recordedInterviews.id, riId),
        eq(recordedInterviews.candidateId, cid)
      )
    );
  if (!ri) return new Response("Not found", { status: 404 });

  // 재평가 — 같은 녹취(전사)로 평가만 다시 수행 (프롬프트 보정 반영). 성공 시 매번 후차감.
  if (body.action === "reevaluate") {
    if (ri.status === "recording" || ri.status === "processing")
      return new Response("처리 중에는 재평가할 수 없습니다.", { status: 409 });
    try {
      await finalizeRecordedInterview(riId);
    } catch {
      return Response.json({ status: "failed" }, { status: 200 });
    }
    return Response.json({ status: "ready" }, { status: 200 });
  }

  // confirm
  if (ri.status !== "ready" && ri.status !== "confirmed")
    return new Response("확정할 수 없는 상태입니다.", { status: 409 });

  await db
    .update(recordedInterviews)
    .set({
      status: "confirmed",
      reportConfirmedAt: sql`CURRENT_TIMESTAMP`,
      reportConfirmedByUserId: me!.id,
    })
    .where(eq(recordedInterviews.id, riId));

  logAudit(req, {
    actor: me!,
    action: "interview.create",
    resourceType: "candidate",
    resourceId: cid,
    orgId: ri.orgId,
    metadata: { kind: "recorded_interview_confirm", recordedInterviewId: riId },
  });

  return Response.json({ ok: true });
}
