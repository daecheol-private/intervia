import { db } from "@/lib/db";
import { marketingBrochures } from "@/lib/schema";
import { getCurrentUser } from "@/lib/auth";
import { requireUser, requirePasswordChanged } from "@/lib/tenant";
import { DEFAULT_BROCHURE } from "@/lib/marketing-brochure";
import { desc, eq } from "drizzle-orm";

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

// 발송 시 고를 브로슈어 목록 — 코드 상수 기본 브로슈어를 맨 위에, 사용자 추가분을 최신순으로.
export async function GET() {
  const guard = await guardAdmin();
  if (guard) return guard;
  const rows = await db
    .select({
      id: marketingBrochures.id,
      subject: marketingBrochures.subject,
      createdAt: marketingBrochures.createdAt,
    })
    .from(marketingBrochures)
    .orderBy(desc(marketingBrochures.createdAt));
  return Response.json({
    brochures: [
      {
        id: DEFAULT_BROCHURE.id,
        subject: DEFAULT_BROCHURE.subject,
        createdAt: null,
        builtin: true,
      },
      ...rows.map((r) => ({ ...r, builtin: false })),
    ],
  });
}

// 메일 본문 HTML 상한 — 과대 입력 방어.
const MAX_HTML_BYTES = 2 * 1024 * 1024;

export async function POST(req: Request) {
  const guard = await guardAdmin();
  if (guard) return guard;
  const body = (await req.json().catch(() => null)) as
    | { subject?: string; html?: string }
    | null;
  const subject = body?.subject?.trim();
  const html = body?.html;
  if (!subject) return new Response("제목을 입력하세요.", { status: 400 });
  if (!html?.trim())
    return new Response("본문 HTML 파일을 올려주세요.", { status: 400 });
  if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES)
    return new Response("본문이 너무 큽니다 (최대 2MB).", { status: 400 });

  const [row] = await db
    .insert(marketingBrochures)
    .values({ subject, html })
    .returning({ id: marketingBrochures.id });
  return Response.json({ id: row.id });
}

export async function DELETE(req: Request) {
  const guard = await guardAdmin();
  if (guard) return guard;
  const body = (await req.json().catch(() => null)) as { id?: number } | null;
  if (!body?.id) return new Response("id가 필요합니다.", { status: 400 });
  await db.delete(marketingBrochures).where(eq(marketingBrochures.id, body.id));
  return Response.json({ ok: true });
}
