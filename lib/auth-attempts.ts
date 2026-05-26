/**
 * 로그인 시도 기록 + 잠금 판정.
 *
 * 정책:
 *  - 동일 email: 15분 내 5회 실패 → 15분 잠금
 *  - 동일 IP:    15분 내 20회 실패 → 15분 잠금 (다수 계정 무차별 공격 차단)
 *  - 성공 시 그 email/ip 의 실패 기록 reset
 *  - 30일 경과 기록은 cron 으로 정리
 *
 * 보안 노트:
 *  - 응답 메시지에 "이 이메일 잠김"이라고 노출하지 않음 (계정 존재 여부 노출 위험).
 *  - 그냥 "너무 많은 시도. 잠시 후 다시" 식 일반 메시지.
 */
import { db } from "./db";
import { authAttempts } from "./schema";
import { and, eq, gte, lt, sql } from "drizzle-orm";

export const EMAIL_FAIL_THRESHOLD = 5;
export const IP_FAIL_THRESHOLD = 20;
export const LOCK_WINDOW_MINUTES = 15;
const HISTORY_RETAIN_DAYS = 30;

// SQLite CURRENT_TIMESTAMP 포맷 ('YYYY-MM-DD HH:MM:SS', UTC). Date.toISOString() 와
// 다르므로 비교 시 같은 포맷으로 변환해야 함 (lexicographic 비교 깨짐 방지).
function sqliteTimestamp(d: Date): string {
  return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

// SQLite 포맷 timestamp 를 UTC Date 로 파싱 (Date 기본 파싱은 local 로 해석함).
function parseSqliteTimestamp(s: string): Date {
  return new Date(s.replace(" ", "T") + "Z");
}

function windowStart(): string {
  return sqliteTimestamp(new Date(Date.now() - LOCK_WINDOW_MINUTES * 60_000));
}

/**
 * 시도 기록. success=true 이면 그 identifier 의 이전 실패 row 삭제 (잠금 해제 효과).
 */
export async function recordAttempt(opts: {
  email: string;
  ip: string | null;
  success: boolean;
  userAgent?: string | null;
}): Promise<void> {
  const ua = opts.userAgent?.slice(0, 500) ?? null;
  const email = opts.email.toLowerCase().trim();

  // 1) 기록 insert (email + ip 각각 row)
  const rows: { identifier: string; kind: "email" | "ip"; success: boolean; userAgent: string | null }[] = [
    { identifier: email, kind: "email", success: opts.success, userAgent: ua },
  ];
  if (opts.ip) {
    rows.push({ identifier: opts.ip, kind: "ip", success: opts.success, userAgent: ua });
  }
  await db.insert(authAttempts).values(rows);

  // 2) 성공 시 그 email/ip 의 과거 실패 기록 삭제 → 잠금 즉시 해제
  if (opts.success) {
    await db
      .delete(authAttempts)
      .where(
        and(
          eq(authAttempts.identifier, email),
          eq(authAttempts.kind, "email"),
          eq(authAttempts.success, false)
        )
      );
    if (opts.ip) {
      await db
        .delete(authAttempts)
        .where(
          and(
            eq(authAttempts.identifier, opts.ip),
            eq(authAttempts.kind, "ip"),
            eq(authAttempts.success, false)
          )
        );
    }
  }
}

/**
 * 잠금 여부 판정. 잠겼으면 unlock 시간 반환.
 * 호출은 비밀번호 검증 전에. email 미입력이면 ip 만 체크.
 */
export async function isLocked(
  email: string | null,
  ip: string | null
): Promise<{ locked: false } | { locked: true; reason: "email" | "ip"; retryAfterSeconds: number }> {
  const since = windowStart();

  // email 체크
  if (email) {
    const normalized = email.toLowerCase().trim();
    const [emailCount] = await db
      .select({ c: sql<number>`COUNT(*)`, oldest: sql<string>`MIN(${authAttempts.attemptedAt})` })
      .from(authAttempts)
      .where(
        and(
          eq(authAttempts.identifier, normalized),
          eq(authAttempts.kind, "email"),
          eq(authAttempts.success, false),
          gte(authAttempts.attemptedAt, since)
        )
      );
    const count = Number(emailCount?.c ?? 0);
    if (count >= EMAIL_FAIL_THRESHOLD) {
      const oldest = emailCount?.oldest ?? sqliteTimestamp(new Date());
      const unlockAt =
        parseSqliteTimestamp(oldest).getTime() + LOCK_WINDOW_MINUTES * 60_000;
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((unlockAt - Date.now()) / 1000)
      );
      return { locked: true, reason: "email", retryAfterSeconds };
    }
  }

  // IP 체크
  if (ip) {
    const [ipCount] = await db
      .select({ c: sql<number>`COUNT(*)`, oldest: sql<string>`MIN(${authAttempts.attemptedAt})` })
      .from(authAttempts)
      .where(
        and(
          eq(authAttempts.identifier, ip),
          eq(authAttempts.kind, "ip"),
          eq(authAttempts.success, false),
          gte(authAttempts.attemptedAt, since)
        )
      );
    const count = Number(ipCount?.c ?? 0);
    if (count >= IP_FAIL_THRESHOLD) {
      const oldest = ipCount?.oldest ?? sqliteTimestamp(new Date());
      const unlockAt =
        parseSqliteTimestamp(oldest).getTime() + LOCK_WINDOW_MINUTES * 60_000;
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((unlockAt - Date.now()) / 1000)
      );
      return { locked: true, reason: "ip", retryAfterSeconds };
    }
  }

  return { locked: false };
}

/**
 * 관리자 강제 unlock — 특정 email / ip 의 실패 기록을 즉시 삭제.
 * 락아웃 DoS 공격 대응 (공격자가 타인 이메일 5회 실패시켜 잠금)
 * 반환: 삭제된 row 수.
 */
export async function adminUnlock(opts: {
  email?: string;
  ip?: string;
}): Promise<number> {
  let deleted = 0;
  if (opts.email) {
    const normalized = opts.email.toLowerCase().trim();
    const r = await db
      .delete(authAttempts)
      .where(
        and(
          eq(authAttempts.identifier, normalized),
          eq(authAttempts.kind, "email"),
          eq(authAttempts.success, false)
        )
      )
      .returning({ id: authAttempts.id });
    deleted += r.length;
  }
  if (opts.ip) {
    const r = await db
      .delete(authAttempts)
      .where(
        and(
          eq(authAttempts.identifier, opts.ip),
          eq(authAttempts.kind, "ip"),
          eq(authAttempts.success, false)
        )
      )
      .returning({ id: authAttempts.id });
    deleted += r.length;
  }
  return deleted;
}

/**
 * 현재 잠긴 식별자 목록 — 관리자 UI 용.
 * 활성 윈도우 내 실패 횟수가 임계치 이상인 email/ip 만 반환.
 */
export async function listLockedIdentifiers(): Promise<
  Array<{ identifier: string; kind: "email" | "ip"; failCount: number; oldestAt: string }>
> {
  const since = windowStart();
  const rows = await db
    .select({
      identifier: authAttempts.identifier,
      kind: authAttempts.kind,
      c: sql<number>`COUNT(*)`.as("c"),
      oldest: sql<string>`MIN(${authAttempts.attemptedAt})`.as("oldest"),
    })
    .from(authAttempts)
    .where(
      and(
        eq(authAttempts.success, false),
        gte(authAttempts.attemptedAt, since)
      )
    )
    .groupBy(authAttempts.identifier, authAttempts.kind);

  return rows
    .map((r) => ({
      identifier: r.identifier,
      kind: r.kind,
      failCount: Number(r.c),
      oldestAt: r.oldest,
    }))
    .filter(
      (r) =>
        (r.kind === "email" && r.failCount >= EMAIL_FAIL_THRESHOLD) ||
        (r.kind === "ip" && r.failCount >= IP_FAIL_THRESHOLD)
    );
}

/** 30일 경과 기록 삭제. cron 에서 호출. */
export async function cleanupOldAttempts(): Promise<number> {
  const cutoff = sqliteTimestamp(
    new Date(Date.now() - HISTORY_RETAIN_DAYS * 86_400_000)
  );
  const r = await db
    .delete(authAttempts)
    .where(lt(authAttempts.attemptedAt, cutoff))
    .returning({ id: authAttempts.id });
  return r.length;
}

/** Request 에서 client IP 추출 (Vercel proxy 헤더 우선). */
export function extractIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return null;
}
