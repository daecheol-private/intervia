/**
 * 가입 전 안내용 — 특정 법인의 org_admin "수"만 반환.
 *
 * 비로그인 접근 허용. 담당자 신원(이름·이메일)은 노출하지 않는다 — 마스킹본이라도
 * 익명 enumeration 으로 모으면 스피어피싱 정찰에 쓰이기 때문. 합류 요청을 넣으면
 * 시스템이 담당자에게 알림을 보내므로, 가입자는 "검토할 담당자가 있는지(수)"만 알면 충분.
 * 분당 5회 제한 (enumeration 차단).
 */
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { sql, count } from "drizzle-orm";
import { rateLimit } from "@/lib/rate-limit";

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

  const [{ c }] = await db
    .select({ c: count() })
    .from(users)
    .where(
      sql`${users.orgId} = ${orgId} AND ${users.role} = 'org_admin' AND ${users.status} = 'active'`
    );

  return Response.json({ count: Number(c) });
}
