import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { and, eq } from "drizzle-orm";

export const runtime = "nodejs";

/**
 * 본인 법인의 활성 org_admin 목록 — 충전 요청 메일 미리보기용.
 * 멤버가 "누구에게 메일이 가는지" 확인 후 발송하도록.
 */
export async function GET() {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (!me!.orgId) return new Response("법인 없음", { status: 400 });

  const admins = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(
      and(
        eq(users.orgId, me!.orgId),
        eq(users.role, "org_admin"),
        eq(users.status, "active")
      )
    );

  return Response.json(admins);
}
