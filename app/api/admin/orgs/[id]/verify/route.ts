/**
 * 비상장·신생법인 사칭 방지 — system_admin 이 수동으로 법인 검증.
 * body: { action: "approve"|"reject", note?: string }
 * step-up 인증 필수.
 */
import { db } from "@/lib/db";
import { organizations } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser, requirePasswordChanged } from "@/lib/tenant";
import { requireStepUp } from "@/lib/step-up";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role !== "system_admin")
    return new Response("권한 없음", { status: 403 });
  const pwGuard = requirePasswordChanged(me);
  if (pwGuard) return pwGuard;

  const stepUpGuard = await requireStepUp();
  if (stepUpGuard) return stepUpGuard;

  const { id } = await params;
  const orgId = Number(id);
  const body = (await req.json().catch(() => ({}))) as {
    action?: "approve" | "reject";
    note?: string;
  };
  if (body.action !== "approve" && body.action !== "reject")
    return new Response("action=approve|reject 필요", { status: 400 });

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, orgId));
  if (!org) return new Response("법인 없음", { status: 404 });

  const nextStatus = body.action === "approve" ? "verified" : "rejected";
  const now = new Date().toISOString();
  await db
    .update(organizations)
    .set({
      verificationStatus: nextStatus,
      verifiedAt: now,
      verifiedByUserId: me!.id,
      verificationNote: body.note?.slice(0, 500) ?? null,
    })
    .where(eq(organizations.id, orgId));

  logAudit(req, {
    actor: me!,
    action: "user.status_change",
    resourceType: "organization",
    resourceId: orgId,
    orgId,
    metadata: {
      kind: "org_verification",
      action: body.action,
      orgName: org.name,
      bizno: org.bizRegistrationNo,
      note: body.note ?? null,
    },
  });

  return Response.json({
    ok: true,
    verificationStatus: nextStatus,
  });
}
