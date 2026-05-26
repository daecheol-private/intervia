import { cookies } from "next/headers";
import { getCurrentUser } from "./auth";
import { db } from "./db";
import { jobInterviewers } from "./schema";
import { and, eq } from "drizzle-orm";

const COOKIE_PREFIX = "job_unlock_";

export async function isJobUnlocked(jobId: number): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  if (user.isAdmin) return true; // 관리자는 모든 공고 잠금 우회
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
