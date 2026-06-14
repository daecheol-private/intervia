/**
 * 가입 전 안내용 — 특정 법인의 org_admin 수 + 부분 마스킹된 담당자(이름·이메일) 목록 반환.
 *
 * 비로그인 접근 허용하되, 신원은 마스킹본만 노출한다(이름 "홍*동", 이메일 "ki***@회사.com").
 * 합류 요청자가 "내 회사 담당자가 맞는지" 확인할 최소 단서만 제공하는 게 목적 — 익명
 * enumeration 으로 모아도 풀네임/전체 이메일은 얻지 못한다. 분당 5회 + 최대 20명 cap 으로
 * 정찰 비용을 높인다. 합류 요청을 넣으면 시스템이 담당자에게 알림을 보낸다.
 */
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { sql } from "drizzle-orm";
import { rateLimit } from "@/lib/rate-limit";
import { maskPersonName, maskEmail } from "@/lib/email-domain";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = await rateLimit(req, "org-admins", {
    limit: 5,
    windowSec: 60,
  });
  if (limited) return limited;

  const { id } = await params;
  const orgId = Number(id);
  if (!Number.isInteger(orgId))
    return new Response("Bad request", { status: 400 });

  const rows = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(
      sql`${users.orgId} = ${orgId} AND ${users.role} = 'org_admin' AND ${users.status} = 'active'`
    )
    .orderBy(users.id)
    .limit(20);

  return Response.json({
    count: rows.length,
    admins: rows.map((r) => ({
      name: maskPersonName(r.name),
      email: maskEmail(r.email),
    })),
  });
}
