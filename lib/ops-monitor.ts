/**
 * 운영 헬스 메트릭 수집 + 임계 평가 (6-C-6 운영 알림).
 *
 * instrumentation(onRequestError → Sentry)은 *예외*를 잡지만, "큐가 안 빠진다 / 평가가
 * 계속 실패한다 / 워커가 멈췄다 / 한 법인이 깊은 마이너스" 같은 **느린 장애**는 예외를 안
 * 던지므로 안 잡힌다. 이 모듈이 그 지표를 주기적으로(cron) 재서 임계 초과 시 알린다.
 *
 * 순수 측정/판정만 — 발송(Slack/메일)은 cron 라우트가 담당(이 모듈은 DB만 의존).
 */
import { db } from "./db";
import { screeningJobs, tokenWallets, auditLogs } from "./schema";
import { and, eq, sql, lt, lte, or, isNull, gte } from "drizzle-orm";

export type OpsMetrics = {
  queued: number;
  processing: number;
  failedLastHour: number;
  stuck: number; // processing 인데 lock 이 오래된(또는 NULL) — 워커 비정상
  negativeBalanceOrgs: number; // 잔액 <= 0 법인 수 (후불 정책상 정상일 수 있음 — 참고용)
  worstBalance: number | null; // 최저 잔액 (가장 깊은 마이너스)
  // 최근 1시간 이력서·첨부 다운로드 최다 사용자 — 대량 유출(계정 탈취·내부자) 조기 감지
  resumeDownloadsTopUser: { userId: number | null; count: number } | null;
};

export type OpsAlert = { level: "warn" | "critical"; message: string };

// 임계값 — env 로 조정. 기본값은 소규모 운영 기준 보수적 설정.
const QUEUE_BACKLOG = Number(process.env.OPS_QUEUE_BACKLOG ?? 50);
const FAILED_LAST_HOUR = Number(process.env.OPS_FAILED_LAST_HOUR ?? 20);
const STUCK_THRESHOLD = Number(process.env.OPS_STUCK ?? 5);
const STUCK_MINUTES = 10; // cleanupStuck(5분)보다 길게 — 그래도 멈춰 있으면 진짜 문제
// 잔액 바닥 — 이보다 더 깊은 마이너스 법인이 있으면 알림. 후불정책상 음수는 정상이라
// 단순 음수가 아니라 "비정상적으로 깊은" 경우만(과금 버그·악용 의심). 미설정 시 비활성.
const BALANCE_FLOOR = process.env.OPS_BALANCE_FLOOR
  ? Number(process.env.OPS_BALANCE_FLOOR)
  : null;
// 한 사용자의 시간당 이력서 다운로드 임계 — 다운로드는 명시적 클릭이라 정상 사용은 낮다.
const RESUME_DL_PER_USER_HOUR = Number(
  process.env.OPS_RESUME_DL_PER_USER_HOUR ?? 100
);

export async function collectOpsMetrics(): Promise<OpsMetrics> {
  const nowIso = new Date().toISOString();
  const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const stuckBefore = new Date(Date.now() - STUCK_MINUTES * 60_000).toISOString();

  // 큐 상태별 카운트 (한 쿼리)
  const statusRows = await db
    .select({ status: screeningJobs.status, c: sql<number>`COUNT(*)` })
    .from(screeningJobs)
    .where(or(eq(screeningJobs.status, "queued"), eq(screeningJobs.status, "processing")))
    .groupBy(screeningJobs.status);
  let queued = 0;
  let processing = 0;
  for (const r of statusRows) {
    if (r.status === "queued") queued = Number(r.c);
    else if (r.status === "processing") processing = Number(r.c);
  }

  // 최근 1시간 영구 실패 — completedAt 은 toISOString(T 포맷) 저장이라 같은 포맷과 비교.
  const [failedRow] = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(screeningJobs)
    .where(
      and(
        eq(screeningJobs.status, "failed"),
        gte(screeningJobs.completedAt, oneHourAgo)
      )
    );
  const failedLastHour = Number(failedRow?.c ?? 0);

  // stuck — processing 인데 lockedAt 이 오래됐거나 NULL (lockedAt 도 toISOString 저장).
  const [stuckRow] = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(screeningJobs)
    .where(
      and(
        eq(screeningJobs.status, "processing"),
        or(lt(screeningJobs.lockedAt, stuckBefore), isNull(screeningJobs.lockedAt))
      )
    );
  const stuck = Number(stuckRow?.c ?? 0);

  // 잔액 — 음수 법인 수 + 최저 잔액
  const [negRow] = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(tokenWallets)
    .where(lte(tokenWallets.balance, 0));
  const [worstRow] = await db
    .select({ m: sql<number | null>`MIN(${tokenWallets.balance})` })
    .from(tokenWallets);

  // 최근 1시간 사용자별 이력서·첨부 다운로드 최다 건수.
  // audit_logs.created_at 은 CURRENT_TIMESTAMP('YYYY-MM-DD HH:MM:SS' 공백 포맷) — 같은 포맷으로 비교.
  const oneHourAgoSqlite = oneHourAgo.replace("T", " ").replace(/\.\d+Z$/, "");
  const [dlRow] = await db
    .select({ userId: auditLogs.actorUserId, c: sql<number>`COUNT(*)` })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.action, "candidate.download_resume"),
        gte(auditLogs.createdAt, oneHourAgoSqlite)
      )
    )
    .groupBy(auditLogs.actorUserId)
    .orderBy(sql`COUNT(*) DESC`)
    .limit(1);

  void nowIso;
  return {
    queued,
    processing,
    failedLastHour,
    stuck,
    negativeBalanceOrgs: Number(negRow?.c ?? 0),
    worstBalance: worstRow?.m == null ? null : Number(worstRow.m),
    resumeDownloadsTopUser: dlRow
      ? { userId: dlRow.userId ?? null, count: Number(dlRow.c) }
      : null,
  };
}

/** 메트릭 → 알림 라인. 임계 초과한 것만 반환(빈 배열이면 정상). */
export function evaluateAlerts(m: OpsMetrics): OpsAlert[] {
  const alerts: OpsAlert[] = [];
  if (m.queued >= QUEUE_BACKLOG) {
    alerts.push({
      level: "warn",
      message: `평가 큐 적체: queued=${m.queued} (임계 ${QUEUE_BACKLOG}). 워커가 처리량을 못 따라가거나 멈춤 의심.`,
    });
  }
  if (m.failedLastHour >= FAILED_LAST_HOUR) {
    alerts.push({
      level: "critical",
      message: `최근 1시간 평가 영구실패 ${m.failedLastHour}건 (임계 ${FAILED_LAST_HOUR}). LLM/파싱/저장소 장애 의심.`,
    });
  }
  if (m.stuck >= STUCK_THRESHOLD) {
    alerts.push({
      level: "critical",
      message: `멈춘(stuck) 평가 작업 ${m.stuck}건 (${STUCK_MINUTES}분+ lock). 워커 비정상 종료/cleanupStuck 미작동 의심.`,
    });
  }
  if (
    BALANCE_FLOOR != null &&
    m.worstBalance != null &&
    m.worstBalance <= BALANCE_FLOOR
  ) {
    alerts.push({
      level: "warn",
      message: `법인 잔액 비정상 마이너스: 최저 ${m.worstBalance} (바닥 ${BALANCE_FLOOR}). 과금 버그·악용 점검 필요.`,
    });
  }
  if (
    m.resumeDownloadsTopUser &&
    m.resumeDownloadsTopUser.count >= RESUME_DL_PER_USER_HOUR
  ) {
    alerts.push({
      level: "warn",
      message: `이력서 대량 다운로드 감지: user=${m.resumeDownloadsTopUser.userId ?? "?"} 최근 1시간 ${m.resumeDownloadsTopUser.count}건 (임계 ${RESUME_DL_PER_USER_HOUR}). 계정 탈취·내부 유출 의심 — /admin/audit 확인, 필요 시 해당 사용자 세션 강제 로그아웃(RUNBOOK §0-2).`,
    });
  }
  return alerts;
}

/** 알림 메시지 텍스트화 (Slack·메일 공용). */
export function formatOpsReport(alerts: OpsAlert[], m: OpsMetrics): string {
  const head = alerts
    .map((a) => `${a.level === "critical" ? "🔴" : "🟠"} ${a.message}`)
    .join("\n");
  const metricLine = `queued=${m.queued} processing=${m.processing} failed/1h=${m.failedLastHour} stuck=${m.stuck} neg법인=${m.negativeBalanceOrgs} 최저잔액=${m.worstBalance ?? "-"} 이력서DL최다/1h=${m.resumeDownloadsTopUser?.count ?? 0}`;
  return `${head}\n\n[지표] ${metricLine}`;
}
