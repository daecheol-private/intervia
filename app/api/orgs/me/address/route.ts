/**
 * 본인 법인의 주소 정보 수정. org_admin / system_admin 만 가능.
 */
import { db } from "@/lib/db";
import { organizations } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function PUT(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (!me!.orgId) return new Response("법인 없음", { status: 400 });
  if (me!.role !== "org_admin" && me!.role !== "system_admin")
    return new Response("권한 없음 — 법인 관리자만 주소를 수정할 수 있습니다.", {
      status: 403,
    });

  const body = (await req.json().catch(() => null)) as {
    officeAddress?: string | null;
    officeAddressDetail?: string | null;
  } | null;
  if (!body) return new Response("바디 필요", { status: 400 });

  const addr =
    typeof body.officeAddress === "string"
      ? body.officeAddress.trim().slice(0, 300) || null
      : null;
  const detail =
    typeof body.officeAddressDetail === "string"
      ? body.officeAddressDetail.trim().slice(0, 200) || null
      : null;

  await db
    .update(organizations)
    .set({
      officeAddress: addr,
      officeAddressDetail: detail,
    })
    .where(eq(organizations.id, me!.orgId));

  logAudit(req, {
    actor: me!,
    action: "org.smtp_update" as const,
    resourceType: "org" as const,
    resourceId: me!.orgId,
    orgId: me!.orgId,
    metadata: {
      kind: "office_address_update",
      hasAddress: !!addr,
    },
  });

  return Response.json({ ok: true, officeAddress: addr, officeAddressDetail: detail });
}
