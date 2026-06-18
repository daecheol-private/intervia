import { db } from "@/lib/db";
import { marketingRecipients, marketingBrochures } from "@/lib/schema";
import { getCurrentUser } from "@/lib/auth";
import { requireUser, requirePasswordChanged } from "@/lib/tenant";
import { sendMail, isSmtpAvailable } from "@/lib/mailer";
import {
  DEFAULT_BROCHURE,
  DEFAULT_BROCHURE_ID,
  withAdLabel,
  renderMarketingHtml,
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
    | { ids?: number[]; brochureId?: string | number }
    | null;
  const ids = body?.ids?.filter((n) => Number.isInteger(n));

  // 발송할 브로슈어 결정 — 기본(코드 상수) 또는 사용자가 추가한 것(DB).
  const brochureId = body?.brochureId ?? DEFAULT_BROCHURE_ID;
  let subject: string;
  let rawHtml: string;
  if (brochureId === DEFAULT_BROCHURE_ID) {
    subject = DEFAULT_BROCHURE.subject;
    rawHtml = DEFAULT_BROCHURE.html;
  } else {
    const n = Number(brochureId);
    const [b] = Number.isInteger(n)
      ? await db
          .select()
          .from(marketingBrochures)
          .where(eq(marketingBrochures.id, n))
      : [];
    if (!b)
      return new Response("선택한 브로슈어를 찾을 수 없습니다.", {
        status: 404,
      });
    subject = b.subject;
    rawHtml = b.html;
  }
  // (광고) 표시 의무 — 발송 직전 자동 보장.
  const finalSubject = withAdLabel(subject);

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
        subject: finalSubject,
        // 수신거부 링크 보장 — {{UNSUBSCRIBE_URL}} 치환 또는 푸터 자동 삽입.
        html: renderMarketingHtml(rawHtml, unsubUrl),
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
