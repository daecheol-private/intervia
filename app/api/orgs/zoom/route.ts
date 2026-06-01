/**
 * 법인별 Zoom 연동 설정 — org_admin 전용.
 *
 * GET    : 현재 설정 조회 (clientSecret 은 마스킹).
 * PUT    : 저장 + 연결 테스트(토큰 발급). 결과를 lastCheck* 에 기록.
 * DELETE : 설정 삭제.
 *
 * orgSmtpConfigs 라우트(app/api/orgs/smtp/route.ts)와 동일 패턴.
 */
import { db } from "@/lib/db";
import { orgZoomConfigs } from "@/lib/schema";
import { eq, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { encrypt, decrypt } from "@/lib/crypto";
import { verifyZoomCredentials } from "@/lib/zoom";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

function resolveOrgId(req: Request, meOrgId: number | null): number | null {
  const url = new URL(req.url);
  const param = url.searchParams.get("orgId");
  return param ? Number(param) : meOrgId;
}

const MASK = "************";

export async function GET(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role === "member") return new Response("권한 없음", { status: 403 });

  const orgId = resolveOrgId(req, me!.orgId);
  if (!orgId) return new Response("orgId 필요", { status: 400 });
  if (!ownsOrg(me!, orgId)) return new Response("권한 없음", { status: 403 });

  const [cfg] = await db
    .select()
    .from(orgZoomConfigs)
    .where(eq(orgZoomConfigs.orgId, orgId));
  if (!cfg) return Response.json(null);

  return Response.json({
    orgId: cfg.orgId,
    accountId: cfg.accountId,
    clientId: cfg.clientId,
    clientSecret: MASK,
    lastCheckedAt: cfg.lastCheckedAt,
    lastCheckStatus: cfg.lastCheckStatus,
    lastCheckError: cfg.lastCheckError,
  });
}

export async function PUT(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role === "member") return new Response("권한 없음", { status: 403 });

  const orgId = resolveOrgId(req, me!.orgId);
  if (!orgId) return new Response("orgId 필요", { status: 400 });
  if (!ownsOrg(me!, orgId)) return new Response("권한 없음", { status: 403 });

  const body = (await req.json().catch(() => null)) as {
    accountId?: string;
    clientId?: string;
    clientSecret?: string;
  } | null;
  if (!body) return new Response("잘못된 요청", { status: 400 });

  const accountId = body.accountId?.trim();
  const clientId = body.clientId?.trim();
  if (!accountId || !clientId)
    return new Response("Account ID / Client ID 필수", { status: 400 });

  // 기존 설정 — clientSecret 미입력(또는 마스킹) 시 보존.
  const [existing] = await db
    .select()
    .from(orgZoomConfigs)
    .where(eq(orgZoomConfigs.orgId, orgId));

  const incoming = body.clientSecret ?? "";
  const isMasked = incoming.includes("*");
  const plainSecret =
    !incoming || isMasked
      ? existing?.clientSecret
        ? decrypt(existing.clientSecret)
        : ""
      : incoming.trim();
  if (!plainSecret) return new Response("Client Secret 필수", { status: 400 });

  // 저장 전 연결 테스트 (토큰 발급)
  const health = await verifyZoomCredentials({
    accountId,
    clientId,
    clientSecret: plainSecret,
  });

  const row = {
    orgId,
    accountId,
    clientId,
    clientSecret: encrypt(plainSecret),
    lastCheckedAt: new Date().toISOString(),
    lastCheckStatus: health.ok ? ("ok" as const) : ("fail" as const),
    lastCheckError: health.ok ? null : health.error,
    updatedByUserId: me!.id,
    updatedAt: sql`CURRENT_TIMESTAMP` as unknown as string,
  };

  if (existing) {
    await db
      .update(orgZoomConfigs)
      .set(row)
      .where(eq(orgZoomConfigs.orgId, orgId));
  } else {
    await db.insert(orgZoomConfigs).values(row);
  }

  logAudit(req, {
    actor: me!,
    action: "org.zoom_update",
    resourceType: "org",
    resourceId: orgId,
    orgId,
    metadata: { accountId, clientId, health_ok: health.ok },
  });

  return Response.json({
    ok: health.ok,
    error: health.ok ? null : health.error,
  });
}

export async function DELETE(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role === "member") return new Response("권한 없음", { status: 403 });

  const orgId = resolveOrgId(req, me!.orgId);
  if (!orgId) return new Response("orgId 필요", { status: 400 });
  if (!ownsOrg(me!, orgId)) return new Response("권한 없음", { status: 403 });

  await db.delete(orgZoomConfigs).where(eq(orgZoomConfigs.orgId, orgId));

  logAudit(req, {
    actor: me!,
    action: "org.zoom_delete",
    resourceType: "org",
    resourceId: orgId,
    orgId,
  });

  return new Response(null, { status: 204 });
}
