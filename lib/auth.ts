import { db } from "./db";
import { users, sessions, organizations } from "./schema";
import { eq, count, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import { addDays } from "./utils";

export const SESSION_COOKIE = "session";
const SESSION_DAYS = 14;
// last_seen 갱신 빈도 — 매 요청마다 쓰면 DB 부하. 최소 간격(초) 이상 차이 나면 update.
// SQLite/Turso 는 단일 writer 라 전 법인 쓰기가 직렬화됨 → 인증된 모든 요청이 세션
// write 를 유발하면 쓰기 경합의 큰 축이 된다. 5분 간격이면 "현재 디바이스 마지막 활동"
// 표시 정밀도는 5분 단위로만 떨어지고(허용), 세션 write 는 ~5배 감소.
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
  const expiresAt = addDays(new Date(), SESSION_DAYS).toISOString();
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
    maxAge: 60 * 60 * 24 * SESSION_DAYS,
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

  // last_seen 갱신 — 최소 간격 (60초) 이상 차이날 때만. 매 요청 write 부하 회피.
  const now = Date.now();
  const lastSeenMs = row.lastSeenAt ? new Date(row.lastSeenAt).getTime() : 0;
  if (now - lastSeenMs > LAST_SEEN_UPDATE_INTERVAL_SEC * 1000) {
    void db
      .update(sessions)
      .set({ lastSeenAt: new Date(now).toISOString() })
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
