import { db } from "@/lib/db";
import {
  organizations,
  users,
  tokenWallets,
  jobPostings,
} from "@/lib/schema";
import { eq, sql, desc, count } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";

export const runtime = "nodejs";

export async function GET() {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role !== "system_admin")
    return new Response("권한 없음", { status: 403 });

  const orgs = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      bizRegistrationNo: organizations.bizRegistrationNo,
      emailDomain: organizations.emailDomain,
      createdAt: organizations.createdAt,
      suspendedAt: organizations.suspendedAt,
      suspendedReason: organizations.suspendedReason,
      verificationStatus: organizations.verificationStatus,
      verifiedAt: organizations.verifiedAt,
      verificationNote: organizations.verificationNote,
      balance: tokenWallets.balance,
    })
    .from(organizations)
    .leftJoin(tokenWallets, eq(tokenWallets.orgId, organizations.id))
    .orderBy(desc(organizations.createdAt));

  // 멤버 수/공고 수 집계
  const memberCounts = await db
    .select({ orgId: users.orgId, c: count() })
    .from(users)
    .groupBy(users.orgId);
  const jobCounts = await db
    .select({ orgId: jobPostings.orgId, c: count() })
    .from(jobPostings)
    .groupBy(jobPostings.orgId);

  const memberMap = new Map(memberCounts.map((r) => [r.orgId, Number(r.c)]));
  const jobMap = new Map(jobCounts.map((r) => [r.orgId, Number(r.c)]));

  return Response.json(
    orgs.map((o) => ({
      ...o,
      balance: o.balance ?? 0,
      memberCount: memberMap.get(o.id) ?? 0,
      jobCount: jobMap.get(o.id) ?? 0,
    }))
  );
}

// Drizzle-Lint silencer
void sql;
