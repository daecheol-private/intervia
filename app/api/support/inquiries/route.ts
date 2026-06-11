/**
 * 로그인 고객(org_admin/member) 고객센터 문의.
 *
 * POST — 문의 접수. 회신 이메일은 계정 이메일 사용.
 * GET  — 본인이 접수한 문의 내역(상태 포함) 조회.
 *
 * Rate limit: 사용자당 분당 5회.
 */
import { after } from "next/server";
import { db } from "@/lib/db";
import { inquiries, organizations } from "@/lib/schema";
import { and, desc, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { extractIp } from "@/lib/auth-attempts";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { notifyNewInquiry } from "@/lib/inquiry-notify";
import { isValidCategory, MESSAGE_MIN, MESSAGE_MAX } from "@/lib/inquiry";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const limited = await rateLimit(
    req,
    "support_inquiry",
    { limit: 5, windowSec: 60 },
    me!.id
  );
  if (limited) return limited;

  const body = (await req.json().catch(() => null)) as {
    category?: string;
    message?: string;
  } | null;
  const category = body?.category?.trim();
  const message = body?.message?.trim();

  if (!category || !message)
    return new Response("분류와 내용을 모두 입력해 주세요.", { status: 400 });
  if (!isValidCategory("org_user", category))
    return new Response("분류 값이 올바르지 않습니다.", { status: 400 });
  if (message.length < MESSAGE_MIN || message.length > MESSAGE_MAX)
    return new Response(
      `내용은 ${MESSAGE_MIN}자 이상, ${MESSAGE_MAX}자 이하로 작성해 주세요.`,
      { status: 400 }
    );

  const orgId = me!.orgId ?? null;
  let orgName: string | null = null;
  if (orgId) {
    const [org] = await db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, orgId));
    orgName = org?.name ?? null;
  }

  const [row] = await db
    .insert(inquiries)
    .values({
      source: "org_user",
      category,
      message,
      contactEmail: me!.email,
      orgId,
      userId: me!.id,
      ip: extractIp(req),
      userAgent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
    })
    .returning({ id: inquiries.id });

  logAudit(req, {
    actor: me!,
    action: "inquiry.submit",
    resourceType: "inquiry",
    resourceId: row.id,
    orgId,
    metadata: { category, message_length: message.length },
  });

  // after() — 응답 반환 후 실행 보장. void fire-and-forget 은 서버리스 suspend 로 유실됨.
  after(() =>
    notifyNewInquiry({
      source: "org_user",
      category,
      message,
      contactEmail: me!.email,
      orgName,
      orgId,
    }).catch((e) => console.error("[support] 접수 통지 실패:", e))
  );

  return Response.json({ ok: true, id: row.id });
}

export async function GET() {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const rows = await db
    .select({
      id: inquiries.id,
      category: inquiries.category,
      message: inquiries.message,
      status: inquiries.status,
      adminNote: inquiries.adminNote,
      createdAt: inquiries.createdAt,
      resolvedAt: inquiries.resolvedAt,
    })
    .from(inquiries)
    .where(
      and(eq(inquiries.source, "org_user"), eq(inquiries.userId, me!.id))
    )
    .orderBy(desc(inquiries.createdAt))
    .limit(50);

  return Response.json({ results: rows });
}
