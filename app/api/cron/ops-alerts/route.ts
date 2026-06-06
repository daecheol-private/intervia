import { getCurrentUser } from "@/lib/auth";
import { collectOpsMetrics, evaluateAlerts, formatOpsReport } from "@/lib/ops-monitor";
import { notifyOps } from "@/lib/error-reporter";
import { sendMail, isSmtpAvailable } from "@/lib/mailer";
import { COMPANY_INFO } from "@/lib/site-info";
import { log } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * 운영 알림 cron (6-C-6). 권장 주기: 매시간 (cron-job.org 또는 vercel.json Pro).
 *
 * 느린 장애(큐 적체·평가 실패율 급증·워커 멈춤·비정상 마이너스 잔액)를 주기적으로 재서
 * 임계 초과 시 Slack(SLACK_WEBHOOK_URL) + 운영 메일(OPS_ALERT_EMAIL, 미설정 시 회사 이메일)로 통지.
 *
 * 안티스팸: 상태 저장 없이 임계 초과 시마다 보낸다 — 문제가 지속되면 주기마다 반복 통지(의도).
 * 둘 다 미설정이면 응답 JSON·로그로만 남는다(graceful).
 */
async function authorize(req: Request): Promise<Response | null> {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  if (secret && header === `Bearer ${secret}`) return null;
  // 시크릿 미설정 시에만 Vercel cron 헤더 허용. 운영(시크릿 설정)에선 헤더 위조 우회 차단.
  if (req.headers.get("x-vercel-cron") === "1" && !secret) return null;
  const me = await getCurrentUser();
  if (me?.role === "system_admin") return null;
  return new Response("권한 없음", { status: 401 });
}

export async function GET(req: Request) {
  const denied = await authorize(req);
  if (denied) return denied;

  const metrics = await collectOpsMetrics();
  const alerts = evaluateAlerts(metrics);

  let notified: { slack: boolean; email: boolean } = { slack: false, email: false };
  if (alerts.length > 0) {
    const report = formatOpsReport(alerts, metrics);

    // Slack (SLACK_WEBHOOK_URL 미설정 시 graceful no-op)
    await notifyOps(report).then(
      () => {
        notified.slack = !!process.env.SLACK_WEBHOOK_URL;
      },
      () => {}
    );

    // 운영 메일 — 시스템 SMTP(env) 사용. 미설정 시 스킵.
    const to = process.env.OPS_ALERT_EMAIL ?? COMPANY_INFO.email;
    if (to && (await isSmtpAvailable(null))) {
      const hasCritical = alerts.some((a) => a.level === "critical");
      const subject = `[Intervia ${hasCritical ? "🔴 긴급" : "🟠 주의"}] 운영 알림 (${alerts.length}건)`;
      try {
        await sendMail({
          to,
          subject,
          text: report,
          html: `<pre style="font-family:monospace;font-size:13px;white-space:pre-wrap;line-height:1.6;">${report.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!)}</pre>`,
          orgId: null,
          audience: "org",
        });
        notified.email = true;
      } catch (e) {
        log.error("ops_alert_email_failed", e);
      }
    }
  }

  return Response.json({ ok: true, metrics, alerts, notified });
}

export async function POST(req: Request) {
  return GET(req);
}
