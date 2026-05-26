import { eq, sql } from "drizzle-orm";
import { jobPostings, candidates, interviewSessions } from "./schema";
import type { CurrentUser } from "./auth";

export function requireUser(user: CurrentUser | null): Response | null {
  if (!user) return new Response("로그인이 필요합니다.", { status: 401 });
  if (user.status === "disabled")
    return new Response("비활성 계정입니다.", { status: 403 });
  return null;
}

export function jobOrgFilter(user: CurrentUser) {
  if (user.role === "system_admin") return undefined;
  return eq(jobPostings.orgId, user.orgId ?? -1);
}

export function candidateOrgFilter(user: CurrentUser) {
  if (user.role === "system_admin") return undefined;
  return eq(candidates.orgId, user.orgId ?? -1);
}

export function interviewSessionOrgFilter(user: CurrentUser) {
  if (user.role === "system_admin") return undefined;
  return sql`${interviewSessions.candidateId} IN (
    SELECT id FROM candidates WHERE org_id = ${user.orgId ?? -1}
  )`;
}

export function ownsOrg(user: CurrentUser, orgId: number | null | undefined): boolean {
  if (user.role === "system_admin") return true;
  if (orgId == null) return false;
  return user.orgId === orgId;
}
