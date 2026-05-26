"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Metrics = {
  scope: "system" | "org";
  daysBack: number;
  totals: {
    orgs: number;
    users: number;
    jobs: number;
    candidates: number;
    candidatesRecent: number;
  };
  stages: Record<string, number>;
  interviews: Record<string, number>;
  queue: Record<string, number>;
  tokenUsage: { reason: string; sum: number; count: number }[];
  recentCrossOrg: Array<{
    id: number;
    action: string;
    actorUserId: number;
    orgId: number | null;
    metadata: Record<string, unknown> | null;
    createdAt: string;
  }>;
  perOrg: Array<{ orgId: number; orgName: string | null; c: number }>;
};

const STAGE_KO: Record<string, string> = {
  applied: "지원",
  screened: "서류평가",
  ai_pending: "AI면접·대기",
  ai_evaluated: "AI면접·평가",
  round1_candidate: "1차·후보",
  round1_scheduling: "1차·스케쥴",
  round1_waiting: "1차·대기",
  round1_passed: "1차 합격",
  round2_passed: "2차 합격",
  hired: "최종 합격",
  rejected: "불합격",
  withdrawn: "지원취소",
};
const REASON_KO: Record<string, string> = {
  charge: "충전",
  job_post: "공고",
  resume_upload: "이력서",
  interview: "면접",
  refund: "환불",
  admin_adjust: "조정",
};
const QUEUE_KO: Record<string, string> = {
  queued: "대기",
  processing: "처리중",
  done: "완료",
  failed: "실패",
};

export default function MetricsPage() {
  const [data, setData] = useState<Metrics | null>(null);
  const [days, setDays] = useState(30);
  const [err, setErr] = useState("");

  const load = async () => {
    setErr("");
    const r = await fetch(`/api/admin/metrics?days=${days}`);
    if (!r.ok) {
      setErr(await r.text());
      return;
    }
    setData(await r.json());
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  return (
    <main className="max-w-6xl mx-auto w-full px-6 py-8">
      <div className="mb-6">
        <Link href="/" className="text-xs text-slate-500 hover:underline">
          ← 대시보드
        </Link>
        <div className="flex justify-between items-end mt-2">
          <h1 className="text-2xl font-bold text-slate-900">운영 메트릭</h1>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white"
          >
            <option value={7}>최근 7일</option>
            <option value={30}>최근 30일</option>
            <option value={90}>최근 90일</option>
            <option value={365}>최근 1년</option>
          </select>
        </div>
      </div>

      {err && (
        <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2 mb-4">
          {err}
        </div>
      )}

      {!data ? (
        <div className="text-sm text-slate-500">불러오는 중...</div>
      ) : (
        <div className="space-y-6">
          <Section title="요약">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {data.scope === "system" && (
                <Stat label="법인" value={data.totals.orgs} />
              )}
              <Stat label="사용자" value={data.totals.users} />
              <Stat label="공고" value={data.totals.jobs} />
              <Stat label="후보자" value={data.totals.candidates} />
              <Stat
                label={`${days}일 신규`}
                value={data.totals.candidatesRecent}
                accent="blue"
              />
            </div>
          </Section>

          <Section title="채용 단계 분포">
            <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2">
              {Object.entries(STAGE_KO).map(([k, label]) => (
                <Cell
                  key={k}
                  label={label}
                  value={data.stages[k] ?? 0}
                  highlight={k === "hired"}
                />
              ))}
            </div>
          </Section>

          <Section title="면접 / 큐">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <div className="text-xs text-slate-500 mb-2">면접 세션</div>
                <div className="grid grid-cols-4 gap-2">
                  {(
                    [
                      ["pending", "미접속"],
                      ["in_progress", "진행중"],
                      ["completed", "완료"],
                      ["expired", "만료"],
                    ] as const
                  ).map(([k, label]) => (
                    <Cell
                      key={k}
                      label={label}
                      value={data.interviews[k] ?? 0}
                    />
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-2">평가 큐</div>
                <div className="grid grid-cols-4 gap-2">
                  {Object.entries(QUEUE_KO).map(([k, label]) => (
                    <Cell
                      key={k}
                      label={label}
                      value={data.queue[k] ?? 0}
                      highlight={k === "failed" && (data.queue[k] ?? 0) > 0}
                      warning={k === "failed"}
                    />
                  ))}
                </div>
              </div>
            </div>
          </Section>

          <Section title={`토큰 사용 (지난 ${days}일)`}>
            <table className="w-full text-sm">
              <thead className="text-slate-500 text-xs border-b border-slate-200">
                <tr>
                  <th className="text-left py-2">항목</th>
                  <th className="text-right py-2">횟수</th>
                  <th className="text-right py-2">토큰 변동</th>
                </tr>
              </thead>
              <tbody>
                {data.tokenUsage.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="text-slate-400 py-4 text-center">
                      기록 없음
                    </td>
                  </tr>
                ) : (
                  data.tokenUsage.map((u) => (
                    <tr
                      key={u.reason}
                      className="border-b border-slate-100"
                    >
                      <td className="py-2">{REASON_KO[u.reason] ?? u.reason}</td>
                      <td className="text-right text-slate-700">{u.count}</td>
                      <td
                        className={`text-right font-medium ${
                          u.sum < 0 ? "text-danger" : "text-primary"
                        }`}
                      >
                        {u.sum > 0 ? "+" : ""}
                        {u.sum.toLocaleString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </Section>

          {data.scope === "system" && data.perOrg.length > 0 && (
            <Section title="법인별 후보자 분포">
              <table className="w-full text-sm">
                <thead className="text-slate-500 text-xs border-b border-slate-200">
                  <tr>
                    <th className="text-left py-2">법인</th>
                    <th className="text-right py-2">후보자</th>
                  </tr>
                </thead>
                <tbody>
                  {data.perOrg.map((o) => (
                    <tr
                      key={o.orgId ?? "null"}
                      className="border-b border-slate-100"
                    >
                      <td className="py-2">
                        {o.orgName ?? `#${o.orgId ?? "(없음)"}`}
                      </td>
                      <td className="text-right text-slate-700 font-medium">
                        {o.c}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {data.scope === "system" && data.recentCrossOrg.length > 0 && (
            <Section
              title="시스템관리자 액션 (최근)"
              hint="법인 데이터 접근 추적"
            >
              <ul className="text-xs space-y-1.5 font-mono">
                {data.recentCrossOrg.map((r) => (
                  <li key={r.id} className="text-slate-700">
                    <span className="text-slate-400">
                      {new Date(r.createdAt).toLocaleString("ko-KR")}
                    </span>{" "}
                    {r.action}{" "}
                    {r.orgId ? (
                      <span className="text-amber-700">org#{r.orgId}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
    </main>
  );
}

function Section({
  title,
  children,
  hint,
}: {
  title: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
      <div className="flex items-baseline gap-2 mb-3">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {hint && <span className="text-[11px] text-slate-400">— {hint}</span>}
      </div>
      {children}
    </section>
  );
}

function Stat({
  label,
  value,
  accent = "slate",
}: {
  label: string;
  value: number;
  accent?: "slate" | "blue";
}) {
  return (
    <div className="bg-slate-50 rounded-lg px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div
        className={`text-2xl font-bold mt-0.5 ${
          accent === "blue" ? "text-primary" : "text-slate-900"
        }`}
      >
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function Cell({
  label,
  value,
  highlight,
  warning,
}: {
  label: string;
  value: number;
  highlight?: boolean;
  warning?: boolean;
}) {
  const cls = warning
    ? "bg-danger-soft text-danger border-danger/30"
    : highlight
      ? "bg-primary-soft text-primary-deep border-primary/30"
      : "bg-surface-alt text-ink-soft border-border-default";
  return (
    <div className={`text-center rounded-md border px-2 py-2 ${cls}`}>
      <div className="text-[10px] uppercase tracking-wider opacity-80">
        {label}
      </div>
      <div className="text-base font-bold mt-0.5">{value}</div>
    </div>
  );
}
