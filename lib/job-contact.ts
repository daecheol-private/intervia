import { db } from "./db";
import { jobPostings } from "./schema";
import { eq } from "drizzle-orm";
import { isValidEmail } from "./email-domain";

/**
 * 공고 "채용 담당자 이메일"(recruitingContactEmail) 검증.
 *
 * 이 이메일은 §37의2 안내문의 [채용 담당 연락처] 자리에 들어가 지원자에게 공개되며,
 * 지원자가 AI 평가 거부·이의제기를 할 연락처다. 필수 + 이메일 형식만 검사한다.
 * 도메인은 제한하지 않는다 — 채용대행·회사메일 미보유 등 부득이한 경우가 있어서
 * (회사 도메인과 다르면 화면에서 확인만 받는다).
 */
export function validateRecruitingContactEmail(
  raw: unknown
): { ok: true; email: string } | { ok: false; message: string } {
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!email) return { ok: false, message: "채용 담당자 이메일을 입력하세요." };
  if (!isValidEmail(email))
    return { ok: false, message: "올바른 이메일 형식이 아닙니다." };
  return { ok: true, email };
}

/** 공고의 채용 담당자 이메일 조회 — 지원자 메일 하단 문의처. 미설정(구버전 공고) 시 null. */
export async function getJobContactEmail(jobId: number): Promise<string | null> {
  const [j] = await db
    .select({ email: jobPostings.recruitingContactEmail })
    .from(jobPostings)
    .where(eq(jobPostings.id, jobId));
  return j?.email ?? null;
}
