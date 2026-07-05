import { db } from "./db";
import { users, sessions, organizations } from "./schema";
import { eq, count, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { cache } from "react";

export const SESSION_COOKIE = "session";
// 로그인 세션 유효기간 — 슬라이딩 6시간(마지막 활동 기준, idle 타임아웃). 발급 시 now+TTL,
// 이후 활동할 때마다(아래 throttle 간격) getCurrentUser 가 expiresAt 를 now+TTL 로 민다.
// → 6시간 안에 접속하면 연장, 6시간 무활동이면 만료. 쿠키 maxAge 슬라이딩은 proxy.ts 가
// 담당(RSC 에서는 쿠키 set 불가) — TTL 동기화 필요.
const SESSION_TTL_HOURS = 6;
const SESSION_TTL_MS = SESSION_TTL_HOURS * 60 * 60 * 1000;
const SESSION_TTL_SEC = SESSION_TTL_HOURS * 60 * 60;
// last_seen/만료 슬라이딩 갱신 빈도 — 매 요청마다 쓰면 DB 부하. 최소 간격(초) 이상 차이 나면 update.
// SQLite/Turso 는 단일 writer 라 전 법인 쓰기가 직렬화됨 → 인증된 모든 요청이 세션
// write 를 유발하면 쓰기 경합의 큰 축이 된다. 5분 간격이면 "현재 디바이스 마지막 활동"
// 표시 정밀도는 5분 단위로만 떨어지고(허용), 세션 write 는 ~5배 감소.
// 슬라이딩 만료도 같은 throttle 을 타므로 idle 한도는 약 6h(±5분 throttle 오차).
const LAST_SEEN_UPDATE_INTERVAL_SEC = 300;

// 2026 권장: bcrypt cost 12. 기존 cost=10 으로 만든 해시는 verify 시 자동 호환.
const BCRYPT_COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(
  plain: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function createSession(
  userId: number,
  meta?: { ip?: string | null; userAgent?: string | null }
): Promise<string> {
  const token = "s_" + randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await db.insert(sessions).values({
    token,
    userId,
    expiresAt,
    ip: meta?.ip ?? null,
    userAgent: meta?.userAgent?.slice(0, 500) ?? null,
    lastSeenAt: new Date().toISOString(),
  });
  return token;
}

export async function setSessionCookie(token: string) {
  const jar = await cookies();
  // 보안: secure 항상 true. 로컬 HTTP dev 에서만 예외 (NODE_ENV=development).
  // Vercel preview/staging 도 production NODE_ENV 로 빌드되므로 자동으로 secure.
  const isDev = process.env.NODE_ENV === "development";
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: !isDev,
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export type CurrentUser = {
  id: number;
  email: string;
  name: string;
  isAdmin: boolean;
  orgId: number | null;
  role: "system_admin" | "org_admin" | "member";
  status: "active" | "pending" | "disabled";
  /** 임시 비밀번호로 생성됨 — 변경 전까지 전역 오버레이로 차단 */
  mustChangePassword: boolean;
  /** 시작 가이드를 본인이 숨긴 시각(개인 단위). null = 계속 표시 */
  setupGuideDismissedAt: string | null;
  sessionToken: string; // 현재 세션 식별용 (UI 에서 "현재 디바이스" 표시)
};

// React cache() — 같은 요청(RSC 렌더) 안에서 layout/page/하위 헬퍼가 중복 호출해도
// 세션 조인 쿼리는 1회만. 렌더 컨텍스트 밖(route handler)에서는 그냥 통과 호출.
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const [row] = await db
    .select({
      userId: sessions.userId,
      expiresAt: sessions.expiresAt,
      lastSeenAt: sessions.lastSeenAt,
      email: users.email,
      name: users.name,
      isAdmin: users.isAdmin,
      orgId: users.orgId,
      role: users.role,
      status: users.status,
      mustChangePassword: users.mustChangePassword,
      setupGuideDismissedAt: users.setupGuideDismissedAt,
      orgSuspendedAt: organizations.suspendedAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(organizations, eq(organizations.id, users.orgId))
    .where(eq(sessions.token, token));

  if (!row) return null;
  if (new Date(row.expiresAt) < new Date()) {
    await db.delete(sessions).where(eq(sessions.token, token));
    return null;
  }
  // 법인 정지 시: system_admin 은 우회 (정지 관리 위해 접근 필요), 나머지는 로그아웃 처리
  if (row.orgSuspendedAt && row.role !== "system_admin") {
    await db.delete(sessions).where(eq(sessions.token, token));
    return null;
  }
  // 비활성화된 계정: 세션 즉시 무효화 (법인 정지와 동일 — 관리자가 계정을 disable 하면
  // 기존 세션 만료를 기다리지 않고 즉시 로그아웃. 로그인 라우트는 이미 disabled 를 차단하므로
  // 여기서 걸리는 건 "로그인 후 disable 된" 세션뿐이다.)
  if (row.status === "disabled") {
    await db.delete(sessions).where(eq(sessions.token, token));
    return null;
  }

  // last_seen + 만료 슬라이딩 갱신 — throttle 간격 이상 차이날 때만. 매 요청 write 부하 회피.
  // expiresAt 를 now+TTL 로 밀어 "활동하는 한 유지, 비활동 시 TTL 후 만료"(슬라이딩) 구현.
  const now = Date.now();
  const lastSeenMs = row.lastSeenAt ? new Date(row.lastSeenAt).getTime() : 0;
  if (now - lastSeenMs > LAST_SEEN_UPDATE_INTERVAL_SEC * 1000) {
    void db
      .update(sessions)
      .set({
        lastSeenAt: new Date(now).toISOString(),
        expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
      })
      .where(eq(sessions.token, token))
      .catch(() => {
        /* 비치명적 */
      });
  }

  return {
    id: row.userId,
    email: row.email,
    name: row.name,
    isAdmin: !!row.isAdmin || row.role === "system_admin",
    orgId: row.orgId ?? null,
    role: row.role,
    status: row.status,
    mustChangePassword: !!row.mustChangePassword,
    setupGuideDismissedAt: row.setupGuideDismissedAt ?? null,
    sessionToken: token,
  };
});
void sql; // sql 은 향후 raw 쿼리에서 사용 예정

export function assertOrgAccess(
  user: CurrentUser | null,
  orgId: number | null | undefined
): boolean {
  if (!user) return false;
  if (user.role === "system_admin") return true;
  if (orgId == null) return false;
  return user.orgId === orgId;
}

export async function deleteSession(token: string) {
  await db.delete(sessions).where(eq(sessions.token, token));
}

export async function hasAnyUser(): Promise<boolean> {
  const [{ c }] = await db.select({ c: count() }).from(users);
  return c > 0;
}
