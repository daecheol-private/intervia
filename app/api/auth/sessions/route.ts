/**
 * 내 활성 세션 목록 (전체 디바이스).
 * 보안: 토큰 전체는 절대 응답에 포함하지 않음 — 앞 12자만 displayId 로.
 */
import { db } from "@/lib/db";
import { sessions } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";

export const runtime = "nodejs";

function maskUa(ua: string | null): string {
  if (!ua) return "(알 수 없음)";
  // 매우 간단한 UA 분류 — 운영에선 ua-parser-js 권장
  if (/iPhone|iPad/i.test(ua)) return "iOS";
  if (/Android/i.test(ua)) return "Android";
  if (/Edg\//i.test(ua)) return "Edge";
  if (/Chrome/i.test(ua)) return "Chrome";
  if (/Firefox/i.test(ua)) return "Firefox";
  if (/Safari/i.test(ua)) return "Safari";
  return ua.slice(0, 60);
}

export async function GET() {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const rows = await db
    .select({
      token: sessions.token,
      ip: sessions.ip,
      userAgent: sessions.userAgent,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(eq(sessions.userId, me!.id))
    .orderBy(desc(sessions.lastSeenAt));

  const result = rows.map((r) => ({
    displayId: r.token.slice(0, 12),
    isCurrent: r.token === me!.sessionToken,
    ip: r.ip,
    browser: maskUa(r.userAgent),
    userAgent: r.userAgent, // 상세 표시용
    createdAt: r.createdAt,
    lastSeenAt: r.lastSeenAt,
    expiresAt: r.expiresAt,
  }));

  return Response.json(result);
}
