/**
 * 시스템 관리자 전용 운영 대시보드.
 * 매일 5분 내 운영 상태 파악을 목표로 한 alerts-only 화면.
 */
import { db } from "@/lib/db";
import {
  organizations,
  users,
  tokenWallets,
  screeningJobs,
  auditLogs,
} from "@/lib/schema";
import { and, count, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { formatLocalDate, formatLocalDateTime } from "@/lib/utils";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const me = await getCurrentUser();
  if (!me || me.role !== "system_admin") {
    redirect("/");
  }

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // 1) 마이너스 토큰 법인 — 운영 환불 위험
  const negative = await db
    .select({
      orgId: tokenWallets.orgId,
      balance: tokenWallets.balance,
      name: organizations.name,
    })
    .from(tokenWallets)
    .innerJoin(organizations, eq(organizations.id, tokenWallets.orgId))
    .where(lt(tokenWallets.balance, 0))
    .orderBy(tokenWallets.balance)
    .limit(10);

  // 2) 정지 법인
  const suspended = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      suspendedAt: organizations.suspendedAt,
      suspendedReason: organizations.suspendedReason,
    })
    .from(organizations)
    .where(isNotNull(organizations.suspendedAt))
    .orderBy(desc(organizations.suspendedAt));

  // 3) 신규 가입 24h (사용자 + 신규 법인)
  const [newUserAgg] = await db
    .select({ c: count() })
    .from(users)
    .where(gte(users.createdAt, dayAgo));
  const [newOrgAgg] = await db
    .select({ c: count() })
    .from(organizations)
    .where(gte(organizations.createdAt, dayAgo));
  const recentSignups = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      createdAt: users.createdAt,
      orgName: organizations.name,
    })
    .from(users)
    .leftJoin(organizations, eq(organizations.id, users.orgId))
    .where(gte(users.createdAt, dayAgo))
    .orderBy(desc(users.createdAt))
    .limit(8);

  // 4) 큐 적체 (queued + processing)
  const queueRows = await db
    .select({
      status: screeningJobs.status,
      c: count(),
    })
    .from(screeningJobs)
    .where(sql`${screeningJobs.status} IN ('queued','processing','failed')`)
    .groupBy(screeningJobs.status);
  const queue: Record<string, number> = {};
  for (const r of queueRows) queue[r.status] = Number(r.c);
  const queueTotal = (queue.queued ?? 0) + (queue.processing ?? 0);

  // 5) 최근 sysadmin critical 액션 — tokens.refund, org.suspend, session.force_logout, user.role_change(system_admin), org.update
  const criticalActions = [
    "tokens.refund",
    "tokens.adjust",
    "org.update",
    "org.suspend",
    "org.resume",
    "session.force_logout",
    "user.role_change",
  ];
  const recentActions = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      actorEmail: users.email,
      orgId: auditLogs.orgId,
      resourceId: auditLogs.resourceId,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .where(
      and(
        gte(auditLogs.createdAt, dayAgo),
        sql`${auditLogs.action} IN (${sql.join(
          criticalActions.map((a) => sql`${a}`),
          sql`, `
        )})`
      )
    )
    .orderBy(desc(auditLogs.id))
    .limit(10);

  // 6) 총 법인 수 (기준선)
  const [totalOrgsAgg] = await db.select({ c: count() }).from(organizations);

  return (
    <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">운영 대시보드</h1>
        <p className="text-sm text-slate-500 mt-1">
          시스템 관리자 — 매일 한 번 훑어보고 이상 상태 빠르게 잡기.
        </p>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <AlertCard
          label="전체 법인"
          value={Number(totalOrgsAgg?.c ?? 0)}
          tone="slate"
          href="/admin/orgs"
        />
        <AlertCard
          label="마이너스 토큰 법인"
          value={negative.length}
          tone={negative.length > 0 ? "rose" : "slate"}
          sub={
            negative.length > 0
              ? `${negative[0].name} ${negative[0].balance.toLocaleString()}…`
              : "없음"
          }
        />
        <AlertCard
          label="정지 법인"
          value={suspended.length}
          tone={suspended.length > 0 ? "amber" : "slate"}
        />
        <AlertCard
          label="신규 가입 (24h)"
          value={Number(newUserAgg?.c ?? 0)}
          sub={`신규 법인 ${Number(newOrgAgg?.c ?? 0)}개`}
          tone="blue"
        />
        <AlertCard
          label="평가 큐"
          value={queueTotal}
          sub={
            queue.failed
              ? `실패 ${queue.failed}건`
              : queueTotal > 0
                ? `진행 ${queue.processing ?? 0} · 대기 ${queue.queued ?? 0}`
                : "비어있음"
          }
          tone={queue.failed ? "rose" : queueTotal > 0 ? "amber" : "slate"}
        />
      </div>

      {/* 마이너스 토큰 법인 */}
      {negative.length > 0 && (
        <Section title="🔴 마이너스 토큰 법인" subtitle="환불·정지·결제 독촉 검토">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500">
              <tr>
                <th className="text-left py-2">법인</th>
                <th className="text-right py-2">잔액</th>
                <th className="text-right py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {negative.map((n) => (
                <tr key={n.orgId}>
                  <td className="py-2 font-medium">{n.name}</td>
                  <td className="py-2 text-right font-mono text-rose-700">
                    {n.balance.toLocaleString()}
                  </td>
                  <td className="py-2 text-right">
                    <Link
                      href="/admin/orgs"
                      className="text-xs text-primary hover:underline"
                    >
                      관리 →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {/* 정지 법인 */}
      {suspended.length > 0 && (
        <Section title="⏸️ 정지 법인">
          <ul className="space-y-2">
            {suspended.map((s) => (
              <li
                key={s.id}
                className="flex items-baseline justify-between gap-3 text-sm"
              >
                <span>
                  <strong>{s.name}</strong>
                  {s.suspendedReason && (
                    <span className="ml-2 text-xs text-slate-500">
                      {s.suspendedReason}
                    </span>
                  )}
                </span>
                <span className="text-xs text-slate-400 shrink-0">
                  {s.suspendedAt
                    ? formatLocalDate(s.suspendedAt)
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* 신규 가입 */}
      {recentSignups.length > 0 && (
        <Section
          title={`👋 신규 가입 (${recentSignups.length}건)`}
          subtitle="최근 24시간"
        >
          <ul className="divide-y divide-slate-100">
            {recentSignups.map((u) => (
              <li
                key={u.id}
                className="flex items-baseline justify-between gap-3 py-2 text-sm"
              >
                <span className="min-w-0">
                  <strong className="text-slate-900">{u.name}</strong>{" "}
                  <span className="text-xs text-slate-500">{u.email}</span>
                  {u.orgName && (
                    <span className="ml-2 text-xs text-slate-500">
                      · {u.orgName}
                    </span>
                  )}
                  <span className="ml-2 text-[10px] uppercase text-slate-400">
                    {u.role}
                  </span>
                </span>
                <span className="text-xs text-slate-400 shrink-0 tabular-nums">
                  {formatLocalDateTime(u.createdAt, {
                    format: { year: undefined },
                  })}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* 평가 큐 적체 */}
      {(queueTotal > 0 || queue.failed) && (
        <Section
          title="📊 평가 큐 상태"
          subtitle="대기/진행/실패 — 적체 시 워커 동시성 조정 검토"
        >
          <div className="flex gap-4 text-sm">
            <span>
              대기{" "}
              <strong className="text-amber-700">{queue.queued ?? 0}</strong>
            </span>
            <span>
              진행{" "}
              <strong className="text-primary-deep">{queue.processing ?? 0}</strong>
            </span>
            <span>
              실패{" "}
              <strong className="text-rose-700">{queue.failed ?? 0}</strong>
            </span>
          </div>
        </Section>
      )}

      {/* 최근 critical 액션 */}
      <Section title="🔔 최근 관리자 액션 (24h)">
        {recentActions.length === 0 ? (
          <p className="text-sm text-slate-400">최근 24시간 내 액션 없음.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {recentActions.map((a) => {
              const meta = (a.metadata ?? {}) as Record<string, unknown>;
              return (
                <li
                  key={a.id}
                  className="flex items-baseline justify-between gap-3 py-2 text-sm"
                >
                  <span className="min-w-0">
                    <span className="text-xs font-mono text-slate-500 mr-2">
                      {a.action}
                    </span>
                    <span className="text-xs text-slate-600">
                      {a.actorEmail}
                    </span>
                    {Boolean(meta.orgName) && (
                      <span className="ml-2 text-xs text-slate-500">
                        → {String(meta.orgName)}
                      </span>
                    )}
                    {Boolean(meta.targetEmail) && (
                      <span className="ml-2 text-xs text-slate-500">
                        → {String(meta.targetEmail)}
                      </span>
                    )}
                    {Boolean(meta.reason) && (
                      <span className="ml-2 text-xs text-slate-400 italic truncate">
                        “{String(meta.reason)}”
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-slate-400 shrink-0 tabular-nums">
                    {formatLocalDateTime(a.createdAt, {
                      format: { year: undefined },
                    })}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-3 text-right">
          <Link href="/admin/audit" className="text-xs text-primary hover:underline">
            전체 감사 로그 →
          </Link>
        </div>
      </Section>
    </main>
  );
}

function AlertCard({
  label,
  value,
  sub,
  href,
  tone,
}: {
  label: string;
  value: number;
  sub?: string;
  href?: string;
  tone: "slate" | "blue" | "amber" | "rose";
}) {
  const toneMap: Record<string, string> = {
    slate: "border-slate-100 text-slate-600",
    blue: "border-primary/30 text-primary-deep bg-primary-soft/40",
    amber: "border-amber-200 text-amber-700 bg-amber-50/40",
    rose: "border-rose-200 text-rose-700 bg-rose-50/40",
  };
  const inner = (
    <div
      className={`bg-white border rounded-2xl p-4 shadow-sm h-full ${toneMap[tone]} ${
        href ? "hover:shadow-md transition-shadow" : ""
      }`}
    >
      <div className="text-xs text-slate-500 font-medium">{label}</div>
      <div className="mt-2 text-2xl font-bold tabular-nums">{value}</div>
      {sub && (
        <div className="text-[11px] text-slate-500 mt-1 truncate">{sub}</div>
      )}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 mb-4">
      <header className="mb-3">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {subtitle && (
          <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>
        )}
      </header>
      {children}
    </section>
  );
}
