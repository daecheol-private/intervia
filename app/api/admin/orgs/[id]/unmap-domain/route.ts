/**
 * 법인의 emailDomain 매핑 해제 — 운영자가 사후에 SaaS·공용 메일임을 발견한 경우.
 * 해제 후 그 도메인은 자동 매칭에 사용되지 않으며, 같은 도메인으로 다른 법인을 등록할 수 있음.
 * step-up 인증 + 감사 로그 필수.
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
  const body = (await req.json().catch(() => ({}))) as { reason?: string };
  const reason = (body.reason ?? "").trim();
  if (reason.length < 5)
    return new Response("사유는 5자 이상 (감사 로그 기록)", { status: 400 });

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, orgId));
  if (!org) return new Response("법인 없음", { status: 404 });

  if (org.emailDomain == null) {
    return Response.json({ ok: true, alreadyUnmapped: true });
  }

  const previousDomain = org.emailDomain;
  await db
    .update(organizations)
    .set({ emailDomain: null })
    .where(eq(organizations.id, orgId));

  logAudit(req, {
    actor: me!,
    action: "user.status_change",
    resourceType: "organization",
    resourceId: orgId,
    orgId,
    metadata: {
      kind: "org_domain_unmap",
      orgName: org.name,
      previousDomain,
      reason,
    },
  });

  return Response.json({ ok: true, previousDomain });
}
