import { db } from "@/lib/db";
import { candidates, screeningJobs } from "@/lib/schema";
import { inArray, and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { enqueueScreening } from "@/lib/screening-queue";
import { triggerWorker } from "@/lib/worker-trigger";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { parseDbTimestamp } from "@/lib/utils";

export const runtime = "nodejs";

/**
 * 후보자 N명 일괄 평가 큐 등록 (신규 평가 + 재평가 + 재시도 대기 즉시 재시도 공용).
 * - 동의 확인된 후보면 평가 완료/실패 여부와 무관하게 대상 (재평가 허용).
 * - 이미 queued(재시도 대기/백오프 포함)면 새 job 안 만들고 백오프만 해제해 즉시 재시도.
 * - processing(워커 점유중)·paused(충전 대기)는 그대로 두고 skip.
 * - 과금은 워커가 "평가 성공" 시점에 함. 여기선 차감 안 함.
 * - 워커 1회 트리거 (이후 self-chain 으로 끝까지 처리)
 */
export async function POST(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  // bulk 는 한 번 호출에 N건 enqueue 하므로 분당 5회로 충분 (5 * 500 = 2500 후보자)
  const limited = await rateLimit(
    req,
    "llm-bulk-screen",
    { limit: 5, windowSec: 60 },
    me!.id
  );
  if (limited) return limited;

  const body = (await req.json().catch(() => null)) as { ids?: number[] } | null;
  const ids = (body?.ids ?? []).map(Number).filter(Number.isInteger);
  if (ids.length === 0)
    return new Response("ids 가 비어 있습니다.", { status: 400 });
  if (ids.length > 500)
    return new Response("한 번에 500개 초과 enqueue 불가", { status: 400 });

  const rows = await db
    .select({
      id: candidates.id,
      orgId: candidates.orgId,
      name: candidates.name,
      screeningReport: candidates.screeningReport,
      maskedLen: candidates.resumeMaskedText,
      consentAt: candidates.applicantConsentConfirmedAt,
      createdAt: candidates.createdAt,
    })
    .from(candidates)
    .where(inArray(candidates.id, ids));

  // 타 법인 행이 섞여 있으면 전체 거부
  for (const r of rows) {
    if (!ownsOrg(me!, r.orgId))
      return new Response("권한 없는 후보자가 포함되어 있습니다.", {
        status: 403,
      });
  }

  // 평가 가능: 동의 확인됨 (legacy row 면제). 리포트 유무는 보지 않는다 — 재평가 허용.
  // NOTE: 마스킹 텍스트가 비어 있어도 제외하지 않는다 — 파싱은 워커(ensureParsed)가
  // 평가 직전에 수행하므로 미파싱/파싱실패 후보도 enqueue 대상.
  const CONSENT_REQUIRED_FROM = new Date("2026-05-22");
  // createdAt 은 SQLite UTC 타임스탬프(Z 없음) — parseDbTimestamp 로 UTC 파싱해야
  // 경계(컷오프 ±9h)에서 로컬 파싱으로 인한 오분류를 막는다.
  const isConsentMissing = (r: { consentAt: string | null; createdAt: string }) =>
    !r.consentAt && parseDbTimestamp(r.createdAt) >= CONSENT_REQUIRED_FROM;

  const enqueued: { candidateId: number; jobId: number }[] = [];
  const skipped: { candidateId: number; reason: string }[] = [];
  // 이미 queued 인 후보 — 백오프 해제(즉시 재시도) 대상으로 모아 일괄 처리.
  const kickCandidateIds: number[] = [];

  for (const r of rows) {
    if (isConsentMissing(r)) {
      skipped.push({
        candidateId: r.id,
        reason: "지원자 동의 확인 누락 (재업로드 필요)",
      });
      continue;
    }
    // enqueue (과금은 워커가 성공 시점에). 이미 활성 job 이 있으면 새로 안 만든다.
    const result = await enqueueScreening(r.id, me!.id);
    if (result.status === "already_queued") {
      // queued(재시도 대기)면 백오프 해제로 즉시 재시도, processing/paused 면 그대로 skip.
      kickCandidateIds.push(r.id);
    } else if (result.jobId) {
      enqueued.push({ candidateId: r.id, jobId: result.jobId });
    }
  }

  // 재시도 대기(백오프) queued job 의 notBefore 해제 → 워커가 즉시 점유. processing/paused 는 제외.
  let kicked = 0;
  if (kickCandidateIds.length > 0) {
    const rowsKicked = await db
      .update(screeningJobs)
      .set({ notBefore: null })
      .where(
        and(
          inArray(screeningJobs.candidateId, kickCandidateIds),
          eq(screeningJobs.status, "queued")
        )
      )
      .returning({ id: screeningJobs.id });
    kicked = rowsKicked.length;
  }
  // processing/paused 라 kick 못한 것은 skip 으로 기록.
  const notKicked = kickCandidateIds.length - kicked;
  if (notKicked > 0) {
    skipped.push({
      candidateId: 0,
      reason: `${notKicked}건은 처리중/충전대기라 건너뜀`,
    });
  }

  triggerWorker(req);

  logAudit(req, {
    actor: me!,
    action: "screen.bulk_trigger",
    resourceType: "candidate",
    metadata: { enqueued: enqueued.length, kicked, skipped: skipped.length },
  });

  return Response.json({
    enqueued: enqueued.length,
    kicked,
    skipped: skipped.length,
    details: { enqueued, skipped },
  });
}
