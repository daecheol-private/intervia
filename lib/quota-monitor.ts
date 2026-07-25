/**
 * 사용량 쿼터 모니터 — 메일 발송(일·월 한도) + Turso(행 읽기/쓰기·저장용량).
 * 일일 cron(/api/cron/quota-alerts)이 재서 임계 초과 시 Slack + 운영 메일로 통지.
 *
 * 순수 수집/판정만 — 발송은 cron 라우트가 담당(ops-alerts 와 동일 구조).
 *
 * 메일 한도는 발신 서버의 정책 한도라 env 로 주입한다(주 경로=회사 SMTP, 장애 시 Resend 로
 * 수동 전환 — RUNBOOK §5. 전환 시 한도가 크게 낮아지므로 env 도 함께 조정해야 한다).
 * 구 이름(RESEND_*)도 계속 읽는다 — 기존 운영 환경변수가 무효화되지 않게.
 */
import { sentToday, sentThisMonth } from "./mail-usage";
import { fetchTursoUsage } from "./turso-usage";

export type QuotaAlert = { level: "warn" | "critical"; message: string };

export type QuotaReport = {
  alerts: QuotaAlert[];
  /** 사람이 읽는 현황 요약(임계 미달이어도 항상 채워짐). */
  report: string;
  metrics: Record<string, unknown>;
};

function fmtBytes(n: number): string {
  return `${(n / 1e9).toFixed(2)}GB`;
}

export async function collectQuotaReport(): Promise<QuotaReport> {
  const alerts: QuotaAlert[] = [];
  const lines: string[] = [];

  // ── 메일 발송 ───────────────────────────────────────────────────────────
  const dailyCap = Number(process.env.MAIL_DAILY_BUDGET ?? 100);
  const monthlyCap = Number(
    process.env.MAIL_MONTHLY_CAP ?? process.env.RESEND_MONTHLY_CAP ?? 3000
  );
  const warnDaily = Number(
    process.env.MAIL_WARN_DAILY ?? process.env.RESEND_WARN_DAILY ?? 80
  );
  const warnMonthly = Number(
    process.env.MAIL_WARN_MONTHLY ?? process.env.RESEND_WARN_MONTHLY ?? 2400
  );
  const today = await sentToday();
  const month = await sentThisMonth();
  lines.push(`📧 메일 발송 — 오늘 ${today}/${dailyCap} · 이번달 ${month}/${monthlyCap}`);
  if (today >= warnDaily) {
    alerts.push({
      level: today >= dailyCap ? "critical" : "warn",
      message: `메일 일일 발송 ${today}/${dailyCap} (경고 임계 ${warnDaily}). 한도 도달 시 이후 발송 실패 — 초대·불합격 통보 지연 가능.`,
    });
  }
  if (month >= warnMonthly) {
    alerts.push({
      level: month >= monthlyCap ? "critical" : "warn",
      message: `메일 월간 발송 ${month}/${monthlyCap} (경고 임계 ${warnMonthly}). 발신 서버 한도·평판을 점검하고, 필요하면 한도 상향을 요청할 것.`,
    });
  }

  // ── Turso ──────────────────────────────────────────────────────────────
  const warnPct = Number(process.env.TURSO_WARN_PCT ?? 70);
  const critPct = Number(process.env.TURSO_CRIT_PCT ?? 90);
  let turso: Awaited<ReturnType<typeof fetchTursoUsage>> = null;
  try {
    turso = await fetchTursoUsage();
  } catch (e) {
    // 조회 실패는 경보로 올리지 않는다(외부 API 일시 장애로 매일 시끄러워지지 않게) — 현황에만 남김.
    lines.push(`🗄️ Turso — 조회 실패: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (turso === null && !process.env.TURSO_PLATFORM_TOKEN) {
    lines.push("🗄️ Turso — 미설정 (TURSO_PLATFORM_TOKEN·TURSO_ORG_SLUG 없음, 모니터 비활성)");
  }
  if (turso) {
    for (const m of turso.metrics) {
      const usedStr =
        m.key === "storage_bytes" ? fmtBytes(m.used) : m.used.toLocaleString();
      lines.push(
        `🗄️ Turso ${m.label} — ${usedStr}${m.pct != null ? ` (${m.pct}%)` : " (한도 미설정)"}`
      );
      if (m.pct != null && m.pct >= warnPct) {
        alerts.push({
          level: m.pct >= critPct ? "critical" : "warn",
          message:
            `Turso ${m.label} ${m.pct}% 사용 (${usedStr}).` +
            (m.key === "rows_read"
              ? " 폴링·매분 크론이 주 소모원 — 필요 시 폴링 주기·크론 빈도 조정."
              : ""),
        });
      }
    }
  }

  return {
    alerts,
    report: lines.join("\n"),
    metrics: {
      mail: { today, month, dailyCap, monthlyCap },
      turso: turso?.raw ?? null,
    },
  };
}
