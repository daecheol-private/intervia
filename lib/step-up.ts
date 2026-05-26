/**
 * 민감 액션 step-up 인증.
 *
 * 흐름:
 *  1) 사용자가 민감 액션 시도
 *  2) 클라이언트가 비밀번호 재입력 모달 표시
 *  3) POST /api/auth/step-up { password } → 검증 성공 시 stepUpVerifiedAt 갱신
 *  4) 클라이언트가 실제 민감 API 호출
 *  5) 서버는 requireStepUp(me) 로 stepUpVerifiedAt 이 TTL 이내인지 확인 — 아니면 403
 *
 * TTL: 10분. 같은 세션에서 여러 민감 액션을 연속 수행해도 한 번만 입력.
 *
 * stepUpVerifiedAt 은 sessions 테이블의 컬럼.
 */
import { db } from "./db";
import { sessions } from "./schema";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";

export const STEP_UP_TTL_MS = 10 * 60 * 1000;

export async function isStepUpFresh(): Promise<boolean> {
  const c = await cookies();
  const token = c.get("session")?.value;
  if (!token) return false;
  const [row] = await db
    .select({ stepUpVerifiedAt: sessions.stepUpVerifiedAt })
    .from(sessions)
    .where(eq(sessions.token, token));
  if (!row?.stepUpVerifiedAt) return false;
  const verified = new Date(row.stepUpVerifiedAt).getTime();
  return Date.now() - verified < STEP_UP_TTL_MS;
}

export async function markStepUpVerified(sessionToken: string): Promise<void> {
  await db
    .update(sessions)
    .set({ stepUpVerifiedAt: new Date().toISOString() })
    .where(eq(sessions.token, sessionToken));
}

/** API 가드. step-up 안 됐으면 403 응답 반환. 통과면 null. */
export async function requireStepUp(): Promise<Response | null> {
  if (await isStepUpFresh()) return null;
  return Response.json(
    {
      code: "step_up_required",
      message:
        "민감한 액션입니다. 비밀번호를 다시 입력해 본인 확인을 완료해 주세요.",
    },
    { status: 403 }
  );
}
