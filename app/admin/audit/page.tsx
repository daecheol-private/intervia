"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatLocalDateTime } from "@/lib/utils";

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

export default function AuditPage() {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [err, setErr] = useState("");
  const [days, setDays] = useState(7);
  const [actionFilter, setActionFilter] = useState("");

  const load = async () => {
    setErr("");
    const url = new URL("/api/admin/audit", window.location.origin);
    url.searchParams.set("days", String(days));
    if (actionFilter) url.searchParams.set("action", actionFilter);
    const r = await fetch(url);
    if (!r.ok) {
      setErr(await r.text());
      return;
    }
    setRows(await r.json());
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, actionFilter]);

  const fmt = (s: string) => formatLocalDateTime(s);
  const actionLabel: Record<string, string> = {
    "login.success": "로그인",
    "candidate.view": "후보자 조회",
    "candidate.download_resume": "이력서 다운로드",
    "candidate.delete": "후보자 삭제",
    "candidate.bulk_delete": "후보자 일괄 삭제",
    "screen.trigger": "AI 평가 시작",
    "screen.bulk_trigger": "AI 평가 일괄 시작",
    "interview.send_email": "면접 메일 발송",
    "appeal.submit": "이의제기 접수",
    "appeal.status_change": "이의제기 상태 변경",
    "user.role_change": "권한 변경",
    "user.status_change": "계정 상태 변경",
    "org.smtp_update": "SMTP 설정 변경",
    "org.smtp_delete": "SMTP 설정 삭제",
    "tokens.refund": "토큰 환불",
    "tokens.adjust": "토큰 수동 조정",
    "org.update": "법인 정보 수정",
    "org.suspend": "법인 정지",
    "org.resume": "법인 재개",
    "session.force_logout": "강제 로그아웃",
    "user.password_reset_email": "비밀번호 리셋 메일 발송",
    "candidate.admin_delete": "후보자 강제 삭제 (cross-org)",
    "org.admin_transfer": "법인 관리자 이전",
  };

  return (
    <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-6">
        <Link href="/" className="text-xs text-slate-500 hover:underline">
          ← 대시보드
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-2">감사 로그</h1>
        <p className="text-sm text-slate-500 mt-1">
          민감 액션 추적 기록. 시스템관리자가 타 법인 데이터에 접근한 경우 별도 표기.
        </p>
      </div>

      <div className="flex gap-3 mb-4 flex-wrap items-center">
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value={1}>최근 1일</option>
          <option value={7}>최근 7일</option>
          <option value={30}>최근 30일</option>
          <option value={90}>최근 90일</option>
        </select>
        <input
          type="text"
          placeholder="action 필터 (예: candidate.delete)"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="flex-1 min-w-[200px] border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
        />
        <button
          onClick={load}
          className="px-3 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 text-sm"
        >
          새로고침
        </button>
        <a
          href={`/api/admin/audit/export?days=${days}${actionFilter ? `&action=${encodeURIComponent(actionFilter)}` : ""}`}
          className="px-3 py-2 rounded-lg border border-primary/40 hover:bg-primary-soft text-sm text-primary-deep font-medium"
          title="현재 필터로 CSV 다운로드 (UTF-8 BOM, 엑셀 호환)"
        >
          CSV 다운로드
        </a>
      </div>

      {err && (
        <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2 mb-4">
          {err}
        </div>
      )}

      {!rows ? (
        <div className="text-sm text-slate-500">불러오는 중...</div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-slate-500 bg-white border border-slate-200 rounded-2xl p-8 text-center">
          기록이 없습니다.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600">
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
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const isCrossOrg =
                  r.actorRole === "system_admin" &&
                  r.metadata &&
                  (r.metadata as Record<string, unknown>).cross_org;
                return (
                  <tr key={r.id} className={isCrossOrg ? "bg-amber-50" : ""}>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                      {fmt(r.createdAt)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-900">
                        {r.actorName ?? r.actorRole ?? "-"}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {r.actorEmail ?? ""}
                      </div>
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-700">
                      {actionLabel[r.action] ?? r.action}
                      {isCrossOrg ? (
                        <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-200 text-amber-900 font-semibold">
                          타법인접근
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {r.resourceType && r.resourceId
                        ? `${r.resourceType}#${r.resourceId}`
                        : "-"}
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {r.orgName ?? (r.orgId ? `#${r.orgId}` : "-")}
                    </td>
                    <td className="px-3 py-2 text-slate-500">{r.ip ?? "-"}</td>
                    <td className="px-3 py-2 text-slate-500 max-w-[200px] truncate">
                      {r.metadata ? JSON.stringify(r.metadata) : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-400 mt-4">
        최대 500건 표시. 더 오래된 기록은 일자 범위를 늘리세요.
      </p>
    </main>
  );
}
