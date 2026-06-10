import { db } from "@/lib/db";
import { marketingRecipients } from "@/lib/schema";
import { getCurrentUser } from "@/lib/auth";
import { requireUser, requirePasswordChanged } from "@/lib/tenant";
import { desc, eq, inArray } from "drizzle-orm";
import { randomBytes } from "crypto";

export const runtime = "nodejs";

async function guardAdmin(): Promise<Response | null> {
  const me = await getCurrentUser();
  const g = requireUser(me);
  if (g) return g;
  if (me!.role !== "system_admin")
    return new Response("권한 없음", { status: 403 });
  const pw = requirePasswordChanged(me);
  if (pw) return pw;
  return null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET() {
  const guard = await guardAdmin();
  if (guard) return guard;
  const rows = await db
    .select()
    .from(marketingRecipients)
    .orderBy(desc(marketingRecipients.createdAt));
  return Response.json({ recipients: rows });
}

export async function POST(req: Request) {
  const guard = await guardAdmin();
  if (guard) return guard;
  const body = (await req.json().catch(() => null)) as { emails?: string } | null;
  if (!body?.emails?.trim())
    return new Response("이메일을 입력하세요.", { status: 400 });

  // 줄바꿈·쉼표·세미콜론·공백 구분 일괄 입력 허용
  const parsed = body.emails
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const valid = [...new Set(parsed.filter((e) => EMAIL_RE.test(e)))];
  const invalidCount = new Set(parsed.filter((e) => !EMAIL_RE.test(e))).size;
  if (valid.length === 0)
    return new Response("유효한 이메일이 없습니다.", { status: 400 });
  if (valid.length > 500)
    return new Response("한 번에 500개까지 등록할 수 있습니다.", { status: 400 });

  const existing = await db
    .select({ email: marketingRecipients.email })
    .from(marketingRecipients)
    .where(inArray(marketingRecipients.email, valid));
  const existingSet = new Set(existing.map((r) => r.email));
  const fresh = valid.filter((e) => !existingSet.has(e));

  if (fresh.length > 0) {
    await db.insert(marketingRecipients).values(
      fresh.map((email) => ({
        email,
        unsubscribeToken: randomBytes(24).toString("base64url"),
      }))
    );
  }
  return Response.json({
    added: fresh.length,
    skipped: existingSet.size,
    invalid: invalidCount,
  });
}

export async function DELETE(req: Request) {
  const guard = await guardAdmin();
  if (guard) return guard;
  const body = (await req.json().catch(() => null)) as { id?: number } | null;
  if (!body?.id) return new Response("id가 필요합니다.", { status: 400 });
  await db
    .delete(marketingRecipients)
    .where(eq(marketingRecipients.id, body.id));
  return Response.json({ ok: true });
}
