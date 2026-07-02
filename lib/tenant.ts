import { eq, sql } from "drizzle-orm";
import { jobPostings, candidates, interviewSessions } from "./schema";
import type { CurrentUser } from "./auth";

export function requireUser(user: CurrentUser | null): Response | null {
  if (!user) return new Response("로그인이 필요합니다.", { status: 401 });
  if (user.status === "disabled")
    return new Response("비활성 계정입니다.", { status: 403 });
  return null;
}

/**
 * 임시 비밀번호 계정 가드. mustChangePassword=true (임시 비번/부트스트랩 system_admin 등)
 * 이면 403 반환 — 비번 변경 전까지 기능 API 차단. 아니면 null.
 * (change-password / logout / account 등 비변경 경로에는 붙이지 않음)
 */
export function requirePasswordChanged(
  user: CurrentUser | null
): Response | null {
  if (user?.mustChangePassword === true)
    return new Response(
      "비밀번호를 먼저 변경해야 이 기능을 사용할 수 있습니다.",
      { status: 403 }
    );
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

export function ownsOrg(user: CurrentUser, orgId: number | null | undefined): boolean {
  if (user.role === "system_admin") return true;
  if (orgId == null) return false;
  return user.orgId === orgId;
}
