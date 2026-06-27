import { cookies } from "next/headers";
import { getCurrentUser, type CurrentUser } from "./auth";
import { db } from "./db";
import { jobInterviewers } from "./schema";
import { and, eq } from "drizzle-orm";

const COOKIE_PREFIX = "job_unlock_";

// me 를 넘기면 getCurrentUser 재호출(세션 조인 쿼리 1회)을 생략한다.
// 호출자가 이미 인증을 마친 라우트에서는 반드시 me 를 전달할 것.
export async function isJobUnlocked(
  jobId: number,
  me?: CurrentUser | null
): Promise<boolean> {
  const user = me !== undefined ? me : await getCurrentUser();
  if (!user) return false;
  if (user.isAdmin) return true; // system_admin: 모든 공고 잠금 우회
  // 법인담당자(org_admin)는 본인 법인 전체에 접근 권한이 있으므로 PIN 우회.
  // 모든 호출처가 ownsOrg/org_id 필터로 타 법인 공고를 선차단하므로 여기서 org 재검증은 불필요(2026-06-27 호출처 전수 감사 완료).
  if (user.role === "org_admin") return true;
  // 공고 면접관으로 등록된 사용자는 PIN 우회 (공유 메일로 자동 등록되거나, PIN 입력 후 자가 지정한 멤버 포함)
  const [row] = await db
    .select({ jobId: jobInterviewers.jobId })
    .from(jobInterviewers)
    .where(
      and(
        eq(jobInterviewers.jobId, jobId),
        eq(jobInterviewers.userId, user.id)
      )
    );
  if (row) return true;
  const jar = await cookies();
  return jar.get(COOKIE_PREFIX + jobId)?.value === "1";
}

// 일괄 잠금 판정 — 호출자가 사용자의 면접관 공고 집합을 이미 조회한 경우(대시보드 등)
// 공고 수만큼 DB 를 다시 두드리지 않고 동기 판정한다. 판정 로직은 isJobUnlocked 와 동일.
export async function getUnlockChecker(
  user: CurrentUser | null,
  interviewerJobIds: Set<number>
): Promise<(jobId: number) => boolean> {
  const jar = await cookies();
  return (jobId: number) => {
    if (!user) return false;
    if (user.isAdmin) return true;
    // 법인담당자(org_admin): 목록은 이미 org 필터를 거쳐 본인 법인 것만 들어오므로 전부 우회.
    if (user.role === "org_admin") return true;
    if (interviewerJobIds.has(jobId)) return true;
    return jar.get(COOKIE_PREFIX + jobId)?.value === "1";
  };
}

export async function setJobUnlocked(jobId: number) {
  const jar = await cookies();
  jar.set(COOKIE_PREFIX + jobId, "1", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    // 세션 쿠키: 브라우저 종료 시 만료
  });
}

export function isValidPin(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}
