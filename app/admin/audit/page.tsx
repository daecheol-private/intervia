"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatLocalDateTime } from "@/lib/utils";
import { AUDIT_ACTION_LABELS } from "@/lib/audit-labels";

type AuditRow = {
  id: number;
  action: string;
  resourceType: string | null;
  resourceId: number | null;
  orgId: number | null;
  orgName: string | null;
  actorUserId: number | null;
  actorRole: string | null;
  actorName: string | null;
  actorEmail: string | null;
  ip: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

/** KST 기준 오늘/N일 전의 'YYYY-MM-DD' — date input 값과 서버 필터가 같은 기준을 쓰게. */
function kstDay(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString(
    "en-CA",
    { timeZone: "Asia/Seoul" }
  );
}

const PRESETS: Array<{ label: string; days: number }> = [
  { label: "오늘", days: 0 },
  { label: "7일", days: 6 },
  { label: "30일", days: 29 },
  { label: "90일", days: 89 },
];

export default function AuditPage() {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState("");
  const [start, setStart] = useState(() => kstDay(-6));
  const [end, setEnd] = useState(() => kstDay());
  // 입력 중인 검색어와 실제 질의어를 분리 — 타이핑마다 조회하지 않는다.
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(200);
  const [loading, setLoading] = useState(false);

  const params = () => {
    const p = new URLSearchParams();
    if (start) p.set("start", start);
    if (end) p.set("end", end);
    if (query) p.set("q", query);
    return p;
  };

  const load = async () => {
    setErr("");
    setLoading(true);
    const p = params();
    p.set("limit", String(limit));
    const r = await fetch(`/api/admin/audit?${p.toString()}`);
    setLoading(false);
    if (!r.ok) {
      setErr(await r.text());
      return;
    }
    const data = (await r.json()) as { rows: AuditRow[]; total: number };
    setRows(data.rows);
    setTotal(data.total);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end, query, limit]);

  const applyPreset = (days: number) => {
    setStart(kstDay(-days));
    setEnd(kstDay());
  };

  const fmt = (s: string) => formatLocalDateTime(s);
  const truncated = rows != null && total > rows.length;

  return (
    <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-6">
        <Link href="/" className="text-xs text-ink-muted hover:underline">
          ← 대시보드
        </Link>
        <h1 className="text-2xl font-bold text-ink mt-2">감사 로그</h1>
        <p className="text-sm text-ink-muted mt-1">
          민감 액션 추적 기록. 시스템관리자가 타 법인 데이터에 접근한 경우 별도 표기.
        </p>
      </div>

      <div className="space-y-3 mb-4">
        {/* 기간 — 날짜 직접 지정 + 자주 쓰는 범위 프리셋 */}
        <div className="flex gap-2 flex-wrap items-center">
          <input
            type="date"
            value={start}
            max={end || undefined}
            onChange={(e) => setStart(e.target.value)}
            className="border border-border-strong rounded-lg px-3 py-2 text-sm bg-card"
            aria-label="시작일"
          />
          <span className="text-ink-muted text-sm">~</span>
          <input
            type="date"
            value={end}
            min={start || undefined}
            onChange={(e) => setEnd(e.target.value)}
            className="border border-border-strong rounded-lg px-3 py-2 text-sm bg-card"
            aria-label="종료일"
          />
          <div className="flex gap-1">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => applyPreset(p.days)}
                className="px-2.5 py-2 rounded-lg border border-border-strong text-xs hover:bg-surface-alt"
              >
                {p.label}
              </button>
            ))}
          </div>
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="border border-border-strong rounded-lg px-3 py-2 text-sm bg-card"
            aria-label="표시 건수"
          >
            <option value={200}>200건</option>
            <option value={500}>500건</option>
            <option value={1000}>1000건</option>
            <option value={2000}>2000건</option>
          </select>
        </div>

        {/* 통합 검색 — 액터·액션·대상·법인·IP·메타 전체 */}
        <div className="flex gap-2 flex-wrap items-center">
          <input
            type="text"
            placeholder="액터·액션·대상·법인·IP·메타 검색 (예: 홍길동, 공고 종결, candidate#12, 1.2.3.4)"
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setQuery(queryInput.trim());
            }}
            className="flex-1 min-w-[240px] border border-border-strong rounded-lg px-3 py-2 text-sm bg-card"
          />
          <button
            onClick={() => setQuery(queryInput.trim())}
            className="px-3 py-2 rounded-lg border border-primary/40 hover:bg-primary-soft text-sm text-primary-deep font-medium"
          >
            검색
          </button>
          {query && (
            <button
              onClick={() => {
                setQueryInput("");
                setQuery("");
              }}
              className="px-3 py-2 rounded-lg border border-border-strong hover:bg-surface-alt text-sm"
            >
              초기화
            </button>
          )}
          <button
            onClick={load}
            className="px-3 py-2 rounded-lg border border-border-strong hover:bg-surface-alt text-sm"
          >
            새로고침
          </button>
          <a
            href={`/api/admin/audit/export?${params().toString()}`}
            className="px-3 py-2 rounded-lg border border-primary/40 hover:bg-primary-soft text-sm text-primary-deep font-medium"
            title="현재 필터 그대로 CSV 다운로드 (UTF-8 BOM, 엑셀 호환)"
          >
            CSV 다운로드
          </a>
        </div>
      </div>

      {err && (
        <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2 mb-4">
          {err}
        </div>
      )}

      {rows != null && (
        <div className="flex items-center justify-between gap-3 mb-2 text-xs">
          <span className="text-ink-soft">
            전체 <span className="font-semibold text-ink">{total}</span>건
            {truncated ? ` 중 최근 ${rows.length}건 표시` : ""}
            {query ? ` · 검색어 "${query}"` : ""}
          </span>
          {truncated && (
            <span className="text-warning">
              표시 건수 상한에 걸렸습니다. 기간을 좁히거나 표시 건수를 늘리세요.
            </span>
          )}
        </div>
      )}

      {!rows ? (
        <div className="text-sm text-ink-muted">불러오는 중...</div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-ink-muted bg-card border border-border-default rounded-2xl p-8 text-center">
          {loading ? "불러오는 중..." : "기록이 없습니다."}
        </div>
      ) : (
        <div className="bg-card border border-border-default rounded-2xl shadow-sm overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-surface-alt text-ink-soft">
              <tr>
                <th className="text-left px-3 py-2.5 font-medium">시각</th>
                <th className="text-left px-3 py-2.5 font-medium">액터</th>
                <th className="text-left px-3 py-2.5 font-medium">액션</th>
                <th className="text-left px-3 py-2.5 font-medium">대상</th>
                <th className="text-left px-3 py-2.5 font-medium">법인</th>
                <th className="text-left px-3 py-2.5 font-medium">IP</th>
                <th className="text-left px-3 py-2.5 font-medium">메타</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {rows.map((r) => {
                const isCrossOrg =
                  r.actorRole === "system_admin" &&
                  r.metadata &&
                  (r.metadata as Record<string, unknown>).cross_org;
                return (
                  <tr key={r.id} className={isCrossOrg ? "bg-warning-soft" : ""}>
                    <td className="px-3 py-2 text-ink-muted whitespace-nowrap">
                      {fmt(r.createdAt)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-ink">
                        {r.actorName ?? r.actorRole ?? "-"}
                      </div>
                      <div className="text-[10px] text-ink-muted">
                        {r.actorEmail ?? ""}
                      </div>
                    </td>
                    <td className="px-3 py-2 font-mono text-ink-soft">
                      {AUDIT_ACTION_LABELS[r.action] ?? r.action}
                      {isCrossOrg ? (
                        <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-warning-soft text-warning font-semibold">
                          타법인접근
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-ink-soft">
                      {r.resourceType && r.resourceId
                        ? `${r.resourceType}#${r.resourceId}`
                        : "-"}
                    </td>
                    <td className="px-3 py-2 text-ink-soft">
                      {r.orgName ?? (r.orgId ? `#${r.orgId}` : "-")}
                    </td>
                    <td className="px-3 py-2 text-ink-muted">{r.ip ?? "-"}</td>
                    <td
                      className="px-3 py-2 text-ink-muted max-w-[200px] truncate"
                      title={r.metadata ? JSON.stringify(r.metadata) : ""}
                    >
                      {r.metadata ? JSON.stringify(r.metadata) : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
