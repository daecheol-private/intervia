import { db } from "@/lib/db";
import { candidates } from "@/lib/schema";
import { inArray } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { chargeFeature } from "@/lib/tokens";
import { enqueueScreening } from "@/lib/screening-queue";
import { triggerWorker } from "@/lib/worker-trigger";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * 후보자 N명 일괄 평가 큐 등록.
 * - status='uploaded' or 'failed' 인 후보자만 대상 (이미 진행/완료된 건 skip)
 * - 각 후보자에 대해 토큰 차감 + 큐 enqueue
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

  // 평가 가능: 리포트 없음 + 동의 확인됨 (legacy row 면제).
  // NOTE: 마스킹 텍스트가 비어 있어도 제외하지 않는다 — 파싱은 워커(ensureParsed)가
  // 평가 직전에 수행하므로 미파싱/파싱실패 후보도 enqueue 대상.
  const CONSENT_REQUIRED_FROM = new Date("2026-05-22");
  const isConsentMissing = (r: { consentAt: string | null; createdAt: string }) =>
    !r.consentAt && new Date(r.createdAt) >= CONSENT_REQUIRED_FROM;
  const eligible = rows.filter(
    (r) => r.screeningReport == null && !isConsentMissing(r)
  );

  const enqueued: { candidateId: number; jobId: number }[] = [];
  const skipped: { candidateId: number; reason: string }[] = [];

  for (const r of rows) {
    if (!eligible.find((e) => e.id === r.id)) {
      skipped.push({
        candidateId: r.id,
        reason: isConsentMissing(r)
          ? "지원자 동의 확인 누락 (재업로드 필요)"
          : "이미 평가 완료됨",
      });
      continue;
    }
    // 토큰 차감 (멱등 — refType+refId 단일성)
    if (r.orgId) {
      await chargeFeature({
        orgId: r.orgId,
        feature: "resume_upload",
        refType: "candidate",
        refId: r.id,
        userId: me!.id,
        memo: r.name,
      });
    }
    const result = await enqueueScreening(r.id, me!.id);
    if (result.jobId) {
      enqueued.push({ candidateId: r.id, jobId: result.jobId });
    }
  }

  triggerWorker(req);

  logAudit(req, {
    actor: me!,
    action: "screen.bulk_trigger",
    resourceType: "candidate",
    metadata: { enqueued: enqueued.length, skipped: skipped.length },
  });

  return Response.json({
    enqueued: enqueued.length,
    skipped: skipped.length,
    details: { enqueued, skipped },
  });
}
