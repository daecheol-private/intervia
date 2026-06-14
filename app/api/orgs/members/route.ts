import { db } from "@/lib/db";
import { users, organizations, orgJoinRequests } from "@/lib/schema";
import { eq, and, desc, ne, count } from "drizzle-orm";
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
      // 대기 중인 합류 요청 id (있으면 멤버 목록에서 바로 승인/거절). pending 은 (user,org) 당 최대 1건.
      joinRequestId: orgJoinRequests.id,
    })
    .from(users)
    .leftJoin(organizations, eq(organizations.id, users.orgId))
    .leftJoin(
      orgJoinRequests,
      and(
        eq(orgJoinRequests.userId, users.id),
        eq(orgJoinRequests.orgId, targetOrgId),
        eq(orgJoinRequests.status, "pending")
      )
    )
    .where(eq(users.orgId, targetOrgId))
    .orderBy(desc(users.createdAt));

  // 같은 이메일 도메인을 여러 법인이 공유하는지 — 공유 도메인이면 합류 승인 화면에 경고(H2).
  // 메일 소유가 확인돼도 우리 회사 소속이라는 보장이 안 되므로 관리자가 직접 확인하도록 유도.
  let domainShared = false;
  const [thisOrg] = await db
    .select({ emailDomain: organizations.emailDomain })
    .from(organizations)
    .where(eq(organizations.id, targetOrgId));
  if (thisOrg?.emailDomain) {
    const [{ c }] = await db
      .select({ c: count() })
      .from(organizations)
      .where(
        and(
          eq(organizations.emailDomain, thisOrg.emailDomain),
          ne(organizations.verificationStatus, "rejected")
        )
      );
    domainShared = Number(c) > 1;
  }

  return Response.json({ members: rows, domainShared });
}
