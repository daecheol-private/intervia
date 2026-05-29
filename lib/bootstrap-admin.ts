import { db } from "./db";
import { users } from "./schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "./auth";
import { log } from "./logger";

/**
 * 환경변수 기반 시스템 관리자 부트스트랩.
 *
 * `SYSTEM_ADMIN_EMAIL` 이 설정돼 있고 해당 이메일 계정이 아직 없으면 `system_admin`
 * 계정을 자동 생성한다. 웹 `/setup` 흐름 없이도 운영 첫 배포에서 관리자가 바로
 * 로그인할 수 있게 하는 부트스트랩이다. (idempotent — 이미 있으면 아무것도 안 함)
 *
 * 환경변수:
 *  - `SYSTEM_ADMIN_EMAIL` (필수) — 관리자 로그인 이메일
 *  - `SYSTEM_ADMIN_NAME` (선택) — 표시 이름. 기본 "시스템 관리자"
 *  - `SYSTEM_ADMIN_INITIAL_PASSWORD` (선택) — 초기 비밀번호. 기본 "changeme"
 *
 * ⚠️ 초기 비밀번호("changeme")는 약한 비밀번호다. 로그인 후 `/account` 에서
 *    즉시 변경해야 한다. (변경 화면은 비밀번호 정책 — 10자·3종·HIBP — 을 강제)
 */

const DEFAULT_INITIAL_PASSWORD = "changeme";

// 프로세스당 1회만 시도. serverless cold start 마다 1회 검사 — 비용 무시 가능.
let bootstrapDone = false;

export async function ensureSystemAdmin(): Promise<void> {
  if (bootstrapDone) return;

  const email = process.env.SYSTEM_ADMIN_EMAIL?.toLowerCase().trim();
  if (!email) {
    bootstrapDone = true; // env 미설정 — 부트스트랩 비활성. 매번 재검사 안 함.
    return;
  }

  try {
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));
    if (existing) {
      bootstrapDone = true;
      return;
    }

    const password =
      process.env.SYSTEM_ADMIN_INITIAL_PASSWORD || DEFAULT_INITIAL_PASSWORD;
    const name = process.env.SYSTEM_ADMIN_NAME?.trim() || "시스템 관리자";
    const passwordHash = await hashPassword(password);

    await db.insert(users).values({
      email,
      passwordHash,
      name,
      role: "system_admin",
      orgId: null,
      status: "active",
      isAdmin: true,
      // 부트스트랩 계정은 이메일 인증을 거치지 않으므로 즉시 인증 처리 (로그인 가능).
      emailVerifiedAt: new Date().toISOString(),
      // 임시 비밀번호("changeme") — 로그인 후 변경 전까지 전역 오버레이로 차단.
      mustChangePassword: true,
    });

    bootstrapDone = true;
    log.warn("system_admin_bootstrapped", {
      email,
      usingDefaultPassword:
        !process.env.SYSTEM_ADMIN_INITIAL_PASSWORD,
      note: "초기 비밀번호로 system_admin 생성됨 — 로그인 후 /account 에서 즉시 변경 필요",
    });
  } catch (e) {
    // 실패 시 bootstrapDone 을 세우지 않아 다음 요청에서 재시도.
    // 단, UNIQUE 경합(동시 두 요청이 같은 계정 생성)으로 인한 실패는 정상 — 이미 생성된 것.
    log.error("system_admin_bootstrap_failed", e, { email });
  }
}
