/**
 * 가입 전 안내용 — 특정 법인의 org_admin 목록 (이름·이메일 부분 마스킹).
 *
 * 비로그인 접근 허용. 검색을 통해 법인을 알아낸 뒤 합류 단계에서 담당자 정보 표시용.
 * 분당 5회 제한 (enumeration 차단).
 * lastSeenAt(접속 시각)은 노출하지 않음 — 인증 전 활동 시간대 정찰 차단.
 */
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { sql, desc } from "drizzle-orm";
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

  const rows = await db
    .select({
      email: users.email,
      name: users.name,
    })
    .from(users)
    .where(
      sql`${users.orgId} = ${orgId} AND ${users.role} = 'org_admin' AND ${users.status} = 'active'`
    )
    .orderBy(desc(users.id))
    .limit(5);

  const masked = rows.map((r) => ({
    email: maskEmail(r.email),
    name: maskName(r.name),
  }));
  return Response.json(masked);
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const visible = local.slice(0, Math.max(1, Math.min(2, local.length - 1)));
  return `${visible}${"*".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

function maskName(name: string): string {
  if (name.length <= 1) return name;
  if (name.length === 2) return name[0] + "*";
  return name[0] + "*".repeat(name.length - 2) + name[name.length - 1];
}
