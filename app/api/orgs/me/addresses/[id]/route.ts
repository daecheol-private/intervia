/**
 * 법인 면접 장소 주소 삭제. org_admin / system_admin 만.
 * 이미 발송된 일정 메일에는 주소 문자열이 그대로 들어가므로, 삭제해도 과거 일정에는 영향이 없다.
 */
import { db } from "@/lib/db";
import { orgAddresses } from "@/lib/schema";
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (!me!.orgId) return new Response("법인 없음", { status: 400 });
  if (me!.role !== "org_admin" && me!.role !== "system_admin")
    return new Response("권한 없음 — 법인 관리자만 주소를 삭제할 수 있습니다.", {
      status: 403,
    });

  const addressId = Number((await params).id);
  if (!Number.isInteger(addressId))
    return new Response("잘못된 주소 id 입니다.", { status: 400 });

  // org_id 조건을 함께 걸어 타 법인 주소 삭제를 차단.
  const deleted = await db
    .delete(orgAddresses)
    .where(
      and(eq(orgAddresses.id, addressId), eq(orgAddresses.orgId, me!.orgId))
    )
    .returning({ id: orgAddresses.id });
  if (deleted.length === 0)
    return new Response("주소를 찾을 수 없습니다.", { status: 404 });

  logAudit(req, {
    actor: me!,
    action: "org.update" as const,
    resourceType: "org" as const,
    resourceId: me!.orgId,
    orgId: me!.orgId,
    metadata: { kind: "office_address_delete", addressId },
  });

  return Response.json({ ok: true });
}
