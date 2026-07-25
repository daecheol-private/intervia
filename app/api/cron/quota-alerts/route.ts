import { getCurrentUser } from "@/lib/auth";
import { secretEquals } from "@/lib/secret-compare";
import { collectQuotaReport } from "@/lib/quota-monitor";
import { notifyOps } from "@/lib/error-reporter";
import { sendMail, isSmtpAvailable } from "@/lib/mailer";
import { COMPANY_INFO } from "@/lib/site-info";
import { log } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * 사용량 쿼터 알림 cron. 권장 주기: 매일 1회 (vercel.json `30 9 * * *` = 18:30 KST).
 *
 * 메일 발송(일·월 한도, env 주입) + Turso(행 읽기/쓰기·저장용량) 사용량을 재서 임계 초과 시
 * Slack(SLACK_WEBHOOK_URL) + 운영 메일(OPS_ALERT_EMAIL)로 통지. 월 단위 쿼터라 하루 1회로 충분.
 * ops-alerts(매시간 큐 헬스)와 분리 — 외부 API 실패가 큐 경보 경로에 전파되지 않게.
 * 둘 다 미설정이면 응답 JSON·로그로만 남는다(graceful).
 */
async function authorize(req: Request): Promise<Response | null> {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  if (secret && secretEquals(header, `Bearer ${secret}`)) return null;
  if (req.headers.get("x-vercel-cron") === "1" && !secret) return null;
  const me = await getCurrentUser();
  if (me?.role === "system_admin") return null;
  return new Response("권한 없음", { status: 401 });
}

export async function GET(req: Request) {
  const denied = await authorize(req);
  if (denied) return denied;

  const { alerts, report, metrics } = await collectQuotaReport();

  const notified: { slack: boolean; email: boolean } = {
    slack: false,
    email: false,
  };
  if (alerts.length > 0) {
    const hasCritical = alerts.some((a) => a.level === "critical");
    const body = `사용량 쿼터 경고 (${alerts.length}건)\n\n${alerts
      .map((a) => `${a.level === "critical" ? "🔴" : "🟠"} ${a.message}`)
      .join("\n")}\n\n[현황]\n${report}`;

    // Slack — 쿼터 소진(특히 메일 발송 한도)은 메일로 못 알릴 수 있어 Slack 이 1차 채널.
    await notifyOps(body).then(
      () => {
        notified.slack = !!process.env.SLACK_WEBHOOK_URL;
      },
      () => {}
    );

    const to = process.env.OPS_ALERT_EMAIL ?? COMPANY_INFO.email;
    if (to && (await isSmtpAvailable(null))) {
      const subject = `[Intervia ${hasCritical ? "🔴 긴급" : "🟠 주의"}] 사용량 쿼터 경고 (${alerts.length}건)`;
      try {
        await sendMail({
          to,
          subject,
          text: body,
          html: `<pre style="font-family:monospace;font-size:13px;white-space:pre-wrap;line-height:1.6;">${body.replace(
            /[<>&]/g,
            (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!
          )}</pre>`,
          orgId: null,
          audience: "org",
          kind: "ops_quota",
        });
        notified.email = true;
      } catch (e) {
        log.error("quota_alert_email_failed", e);
      }
    }
  }

  return Response.json({ ok: true, metrics, alerts, notified });
}

export async function POST(req: Request) {
  return GET(req);
}
