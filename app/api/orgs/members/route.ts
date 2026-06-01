import { db } from "@/lib/db";
import { users, organizations } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role === "member") return new Response("권한 없음", { status: 403 });

  const url = new URL(req.url);
  const orgIdParam = url.searchParams.get("orgId");
  let targetOrgId: number | null = null;
  if (orgIdParam) {
    targetOrgId = Number(orgIdParam);
    if (!ownsOrg(me!, targetOrgId))
      return new Response("권한 없음", { status: 403 });
  } else {
    targetOrgId = me!.orgId;
  }
  if (!targetOrgId)
    return new Response("orgId 필요", { status: 400 });

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      status: users.status,
      createdAt: users.createdAt,
      orgId: users.orgId,
      orgName: organizations.name,
      emailVerifiedAt: users.emailVerifiedAt,
    })
    .from(users)
    .leftJoin(organizations, eq(organizations.id, users.orgId))
    .where(eq(users.orgId, targetOrgId))
    .orderBy(desc(users.createdAt));

  return Response.json(rows);
}
