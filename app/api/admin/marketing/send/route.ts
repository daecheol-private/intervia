import { db } from "@/lib/db";
import { marketingRecipients } from "@/lib/schema";
import { getCurrentUser } from "@/lib/auth";
import { requireUser, requirePasswordChanged } from "@/lib/tenant";
import { sendMail, isSmtpAvailable } from "@/lib/mailer";
import {
  renderBrochureHtml,
  MARKETING_MAIL_SUBJECT,
} from "@/lib/marketing-brochure";
import { SITE_INFO } from "@/lib/site-info";
import { and, eq, inArray } from "drizzle-orm";

export const runtime = "nodejs";
export const maxDuration = 60;

// 서버리스 타임아웃 내 안전 발송 한도 — 초과분은 응답의 remaining 으로 알리고 재요청 유도.
const BATCH_LIMIT = 50;

export async function POST(req: Request) {
  const me = await getCurrentUser();
  const g = requireUser(me);
  if (g) return g;
  if (me!.role !== "system_admin")
    return new Response("권한 없음", { status: 403 });
  const pw = requirePasswordChanged(me);
  if (pw) return pw;

  if (!(await isSmtpAvailable(null)))
    return new Response("시스템 SMTP가 설정되지 않았습니다.", { status: 503 });

  const body = (await req.json().catch(() => null)) as
    | { ids?: number[] }
    | null;
  const ids = body?.ids?.filter((n) => Number.isInteger(n));

  const targets = await db
    .select()
    .from(marketingRecipients)
    .where(
      ids && ids.length > 0
        ? and(
            eq(marketingRecipients.status, "active"),
            inArray(marketingRecipients.id, ids)
          )
        : eq(marketingRecipients.status, "active")
    );

  const batch = targets.slice(0, BATCH_LIMIT);
  const remaining = targets.length - batch.length;

  let sent = 0;
  const failed: Array<{ email: string; error: string }> = [];
  for (const r of batch) {
    const unsubUrl = `${SITE_INFO.baseUrl}/unsubscribe/${r.unsubscribeToken}`;
    try {
      // audience=candidate — preview 환경에서 MAIL_OVERRIDE_TO 로 차단 (외부 오발송 방지)
      await sendMail({
        to: r.email,
        subject: MARKETING_MAIL_SUBJECT,
        html: renderBrochureHtml(unsubUrl),
        audience: "candidate",
      });
      await db
        .update(marketingRecipients)
        .set({ lastSentAt: new Date().toISOString() })
        .where(eq(marketingRecipients.id, r.id));
      sent++;
    } catch (e) {
      failed.push({
        email: r.email,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return Response.json({ sent, failed, remaining });
}
