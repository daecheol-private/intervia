import { db } from "@/lib/db";
import { marketingBrochures } from "@/lib/schema";
import { getCurrentUser } from "@/lib/auth";
import { requireUser, requirePasswordChanged } from "@/lib/tenant";
import {
  DEFAULT_BROCHURE,
  DEFAULT_BROCHURE_ID,
  renderMarketingHtml,
} from "@/lib/marketing-brochure";
import { SITE_INFO } from "@/lib/site-info";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

// 발송될 최종 본문을 그대로 미리보기 — 수신거부 처리(치환/푸터)까지 적용해 보여준다.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const g = requireUser(me);
  if (g) return g;
  if (me!.role !== "system_admin")
    return new Response("권한 없음", { status: 403 });
  const pw = requirePasswordChanged(me);
  if (pw) return pw;

  const { id } = await params;
  let rawHtml: string;
  if (id === DEFAULT_BROCHURE_ID) {
    rawHtml = DEFAULT_BROCHURE.html;
  } else {
    const n = Number(id);
    if (!Number.isInteger(n)) return new Response("not found", { status: 404 });
    const [b] = await db
      .select()
      .from(marketingBrochures)
      .where(eq(marketingBrochures.id, n));
    if (!b) return new Response("not found", { status: 404 });
    rawHtml = b.html;
  }
  // 미리보기용 더미 토큰 — 실제 발송 시엔 수신자별 토큰으로 치환된다.
  const html = renderMarketingHtml(
    rawHtml,
    `${SITE_INFO.baseUrl}/unsubscribe/preview-token`
  );
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
