"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useStepUpFetch } from "@/app/components/StepUpModal";

type Row = {
  id: number;
  email: string;
  name: string;
  role: "system_admin" | "org_admin" | "member";
  status: "active" | "pending" | "disabled";
  orgId: number | null;
  orgName: string | null;
  createdAt: string;
  emailVerifiedAt: string | null;
};

const ROLE_LABELS: Record<Row["role"], string> = {
  member: "일반 멤버",
  org_admin: "법인 관리자",
  system_admin: "시스템 관리자",
};

export default function AdminUsersPage() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    const url = q.trim()
      ? `/api/admin/users?q=${encodeURIComponent(q.trim())}`
      : "/api/admin/users";
    const res = await fetch(url);
    setLoading(false);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    setRows(await res.json());
  }, [q]);

  useEffect(() => {
    void load();
  }, [load]);

  const { ensureFetch, modal: stepUpModal } = useStepUpFetch();

  const update = async (
    id: number,
    body: {
      role?: Row["role"];
      status?: "active" | "disabled";
      emailVerified?: boolean;
    }
  ) => {
    setBusyId(id);
    const reason = body.emailVerified
      ? "사용자 이메일을 관리자가 대신 인증 처리합니다."
      : body.role
        ? `사용자 권한을 ${body.role} 으로 변경합니다.`
        : `사용자 상태를 ${body.status === "disabled" ? "비활성" : "활성"} 으로 변경합니다.`;
    let res: Response;
    try {
      res = await ensureFetch(
        `/api/users/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        reason
      );
    } catch {
      setBusyId(null);
      return;
    }
    setBusyId(null);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    void load();
  };

  // 권한 변경 — select 에서 호출. 전이별 확인 문구 분기 (취소 시 select 는 controlled 라 원복).
  const changeRole = (u: Row, newRole: Row["role"]) => {
    if (newRole === u.role) return;
    let msg: string;
    if (newRole === "system_admin") {
      msg = `'${u.name}' (${u.email}) 에게 시스템 관리자 권한을 부여합니다.\n\n시스템 관리자는 모든 법인 데이터에 접근 가능합니다. 진행하시겠습니까?`;
    } else if (u.role === "system_admin") {
      msg = `'${u.name}' 의 시스템 관리자 권한을 회수하고 '${ROLE_LABELS[newRole]}' 로 전환합니다.`;
    } else if (newRole === "org_admin") {
      msg = `'${u.name}' (${u.email}) 를 ${u.orgName ?? "법인"} 의 법인 관리자(org_admin)로 승급합니다.\n법인의 멤버 관리·합류 승인 권한을 가지게 됩니다.`;
    } else {
      msg = `'${u.name}' (${u.email}) 를 일반 멤버(member)로 강등합니다.\n법인 관리 권한이 즉시 회수됩니다.`;
    }
    if (confirm(msg)) void update(u.id, { role: newRole });
  };

  // 활성/비활성 토글
  const toggleStatus = (u: Row, next: "active" | "disabled") => {
    const msg =
      next === "disabled"
        ? `'${u.name}' (${u.email}) 를 비활성화합니다.\n사용자는 즉시 로그인 불가가 되며, 보유 세션도 만료됩니다.`
        : `'${u.name}' (${u.email}) 를 활성 상태로 전환합니다.\n${
            u.status === "pending"
              ? "이 사용자는 합류 승인 대기 중입니다 — 일반적으로는 멤버 관리 > 합류 요청 탭에서 승인하는 것이 권장됩니다."
              : "재로그인이 가능해집니다."
          }`;
    if (confirm(msg)) void update(u.id, { status: next });
  };

  // 관리자 대리 이메일 인증 — 인증 메일이 도달하지 않는 사용자 구제용.
  const verifyEmail = (u: Row) => {
    if (
      confirm(
        `'${u.name}' (${u.email}) 의 이메일을 인증 완료로 처리합니다.\n\n인증 메일이 도달하지 않는 사용자를 위한 기능입니다. 본인 소유 이메일이 맞는지 확인 후 진행하세요. 처리 즉시 로그인이 가능해집니다.`
      )
    )
      void update(u.id, { emailVerified: true });
  };

  // 강제 로그아웃 — 활성 세션 전부 만료
  const forceLogout = async (u: Row) => {
    if (
      !confirm(
        `'${u.name}' (${u.email}) 의 모든 활성 세션을 강제 만료합니다. 다음 접속 시 재로그인해야 합니다.`
      )
    )
      return;
    setBusyId(u.id);
    const res = await fetch(`/api/admin/users/${u.id}/sessions`, {
      method: "DELETE",
    });
    setBusyId(null);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    const d = (await res.json()) as { sessionsRevoked: number };
    alert(`${d.sessionsRevoked}개 세션을 만료했습니다.`);
  };

  // 비밀번호 리셋 메일 발송
  const passwordReset = async (u: Row) => {
    if (!confirm(`'${u.email}' 로 비밀번호 리셋 메일을 발송합니다.`)) return;
    setBusyId(u.id);
    const res = await fetch(`/api/admin/users/${u.id}/password-reset`, {
      method: "POST",
    });
    setBusyId(null);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    const d = (await res.json()) as { mailSent: boolean; error: string | null };
    alert(
      d.mailSent
        ? "메일 발송 완료. 사용자가 메일함을 확인하면 됩니다."
        : `메일 발송 실패: ${d.error ?? "알 수 없는 오류"}`
    );
  };

  // 계정 영구 삭제 — sysadmin 전용. step-up + 사유 + 이메일 확인.
  // disabled 면 일반 삭제, 그 외(active/pending)면 강제 삭제(force) — 한 단계 더 경고.
  const deleteUser = async (u: Row) => {
    const force = u.status !== "disabled";
    if (
      force &&
      !confirm(
        `⚠️ '${u.name}' (${u.email}) 는 '${u.status}' 상태입니다.\n\n` +
          `보통은 비활성화 후 삭제하지만, 강제로 즉시 영구 삭제합니다.\n` +
          `이 계정이 법인의 유일한 관리자라면 삭제 후 그 법인은 관리자가 없는 상태로 남습니다 ` +
          `— 법인 자체를 정리하려면 '법인 관리'에서 정지→삭제하세요.\n\n계속할까요?`
      )
    )
      return;
    const reason = prompt(
      `'${u.name}' (${u.email}) 계정을 영구 삭제합니다.\n\n` +
        `세션·알림·즐겨찾기·면접관 메모가 함께 삭제되며 복구할 수 없습니다.\n\n` +
        `사유 (5자 이상, 감사 로그에 기록):`
    );
    if (reason === null) return;
    if (reason.trim().length < 5) {
      setErr("삭제 사유는 5자 이상");
      return;
    }
    const confirmEmail = prompt(
      `실수 방지: 이메일을 정확히 입력하세요.\n\n  ${u.email}`
    );
    if (confirmEmail === null) return;
    if (confirmEmail.trim() !== u.email.trim()) {
      setErr("이메일 불일치");
      return;
    }
    setBusyId(u.id);
    let res: Response;
    try {
      res = await ensureFetch(
        `/api/users/${u.id}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: reason.trim(),
            confirm: confirmEmail.trim(),
            force,
          }),
        },
        `'${u.name}' (${u.email}) 계정을 영구 삭제합니다.`
      );
    } catch {
      setBusyId(null);
      return;
    }
    setBusyId(null);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== u.id));
    alert("삭제 완료. 감사 로그에 기록되었습니다.");
  };

  // 비-sysadmin 계정에 삭제 버튼 노출. disabled=일반 삭제 / 그 외=강제 삭제.
  // (system_admin 은 보호 — 먼저 권한 회수 후 삭제)
  const canDelete = (u: Row) => u.role !== "system_admin";

  // ── 공용 표시 헬퍼 ──
  const roleBadge = (u: Row) =>
    u.role === "system_admin" ? (
      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200 uppercase tracking-wide">
        system_admin
      </span>
    ) : (
      <span className="text-slate-600">{ROLE_LABELS[u.role]}</span>
    );

  const statusBadge = (u: Row) =>
    u.status === "pending" ? (
      <Link
        href="/org/members?tab=requests"
        className="inline-flex items-center gap-1 text-warning hover:text-warning/80 hover:underline"
        title="합류 요청 탭으로 이동 — 정식 승인 권장"
      >
        pending
        <span aria-hidden>↗</span>
      </Link>
    ) : u.status === "disabled" ? (
      <span className="text-danger font-medium">비활성</span>
    ) : (
      <span className="text-emerald-600 font-medium">활성</span>
    );

  // 이메일 미인증 표시 — 로그인이 차단된 상태임을 관리자가 즉시 인지하도록.
  const verifyBadge = (u: Row) =>
    !u.emailVerifiedAt ? (
      <span
        className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-danger-soft text-danger border border-danger/30"
        title="이메일 미인증 — 현재 로그인 불가"
      >
        메일 미인증
      </span>
    ) : null;

  // ── 작업 영역 (데스크톱 테이블 / 모바일 카드 공용) ──
  // 권한은 버튼 묶음 대신 select 로 — 4개 버튼이 한 컨트롤로 합쳐져 영역이 단순해진다.
  // [ 권한 select ] [ 활성/비활성 ] [ 이메일 인증 ]  |  [ 강제 로그아웃 ] [ 비번 리셋 ] [ 삭제 ]
  const renderActions = (u: Row) => {
    const busy = busyId === u.id;
    return (
      <div className="flex flex-wrap items-center gap-2">
        {/* 권한 변경 */}
        <label className="inline-flex items-center gap-1.5">
          <span className="text-[11px] text-slate-400">권한</span>
          <select
            aria-label="권한 변경"
            title="권한 변경"
            value={u.role}
            disabled={busy}
            onChange={(e) => changeRole(u, e.target.value as Row["role"])}
            className={selectCls}
          >
            <option value="member">일반 멤버</option>
            <option value="org_admin">법인 관리자</option>
            <option value="system_admin">시스템 관리자</option>
          </select>
        </label>

        {/* 상태 토글 */}
        {u.status === "active" ? (
          <button
            onClick={() => toggleStatus(u, "disabled")}
            disabled={busy}
            className={btnDanger}
          >
            비활성화
          </button>
        ) : (
          <button
            onClick={() => toggleStatus(u, "active")}
            disabled={busy}
            className={btnSec}
          >
            활성화
          </button>
        )}

        {/* 이메일 인증 (미인증 시) */}
        {!u.emailVerifiedAt && (
          <button onClick={() => verifyEmail(u)} disabled={busy} className={btnVerify}>
            ✓ 이메일 인증
          </button>
        )}

        {/* 상태 변경 ↔ 계정 유틸 구분선 (데스크톱) */}
        <span aria-hidden className="hidden sm:block w-px h-5 bg-slate-200 mx-0.5" />

        {/* 계정 유틸 */}
        <button onClick={() => forceLogout(u)} disabled={busy} className={btnWarn}>
          강제 로그아웃
        </button>
        <button onClick={() => passwordReset(u)} disabled={busy} className={btnAccent}>
          비번 리셋
        </button>
        {canDelete(u) && (
          <button
            onClick={() => deleteUser(u)}
            disabled={busy}
            title={
              u.status === "disabled"
                ? "계정 영구 삭제 (복구 불가)"
                : "강제 영구 삭제 — 활성/대기 계정도 즉시 삭제 (복구 불가)"
            }
            className={btnDeleteSolid}
          >
            {u.status === "disabled" ? "삭제" : "강제 삭제"}
          </button>
        )}
      </div>
    );
  };

  return (
    <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      {stepUpModal}
      <div className="mb-6">
        <Link href="/" className="text-xs text-slate-500 hover:underline">
          ← 대시보드
        </Link>
        <div className="flex items-end justify-between mt-2 gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">사용자 관리</h1>
            <p className="text-sm text-slate-500 mt-1">
              전체 사용자 검색 및 권한/상태 변경.
            </p>
          </div>
          <button
            onClick={async () => {
              const reason = prompt(
                "보안사고 대응 — 전체 사용자의 활성 세션을 강제 만료합니다.\n본인 세션은 보호됩니다.\n\n사유 (5자 이상, 감사 로그에 기록):"
              );
              if (reason === null) return;
              if (reason.trim().length < 5) {
                setErr("사유는 5자 이상");
                return;
              }
              if (
                !confirm(
                  "정말로 전체 사용자를 강제 로그아웃 시키시겠습니까?\n모든 사용자가 다음 접속 시 재로그인 필요합니다."
                )
              )
                return;
              const res = await fetch("/api/admin/sessions/all", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  confirm: "FORCE-LOGOUT-ALL",
                  reason: reason.trim(),
                }),
              });
              if (!res.ok) {
                setErr(await res.text());
                return;
              }
              const d = (await res.json()) as { sessionsRevoked: number };
              alert(`${d.sessionsRevoked}개 세션을 만료했습니다.`);
            }}
            className="shrink-0 px-3 py-2 text-xs bg-white border border-rose-300 hover:bg-rose-50 text-rose-700 rounded font-medium"
          >
            🚨 전체 강제 로그아웃
          </button>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        <input
          className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
          placeholder="이름 또는 이메일"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
        />
        <button
          onClick={load}
          className="px-3 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary-deep"
        >
          검색
        </button>
      </div>

      {err && (
        <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2 mb-4">
          {err}
        </div>
      )}

      {/* 모바일: 카드 리스트 (테이블 셀 폭 부족으로 이름·법인이 세로로 깨지는 문제 해결) */}
      <div className="sm:hidden space-y-3">
        {loading && (
          <div className="text-slate-400 text-sm py-6 text-center">불러오는 중...</div>
        )}
        {!loading && rows.length === 0 && (
          <div className="text-slate-400 text-sm py-6 text-center">결과가 없습니다.</div>
        )}
        {rows.map((u) => (
          <div
            key={u.id}
            className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium text-slate-900 break-words">
                  {u.name}
                </div>
                <div className="text-xs text-slate-500 break-all mt-0.5">
                  {u.email}
                </div>
                <div className="text-xs text-slate-400 mt-0.5">
                  {u.orgName || "법인 없음"}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0 text-xs">
                {roleBadge(u)}
                <span>
                  {statusBadge(u)}
                  {verifyBadge(u)}
                </span>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-slate-100">
              {renderActions(u)}
            </div>
          </div>
        ))}
      </div>

      {/* 데스크톱: 테이블. 권한은 작업 영역의 select 가 곧 현재값 표시를 겸하므로 별도 컬럼 제거 */}
      <div className="hidden sm:block bg-white border border-slate-200 rounded-2xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs">
            <tr>
              <th className="text-left px-4 py-3 font-medium">이름</th>
              <th className="text-left px-4 py-3 font-medium">이메일</th>
              <th className="text-left px-4 py-3 font-medium">법인</th>
              <th className="text-left px-4 py-3 font-medium">상태</th>
              <th className="text-right px-4 py-3 font-medium">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr>
                <td className="px-4 py-6 text-slate-400" colSpan={5}>
                  불러오는 중...
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-slate-400" colSpan={5}>
                  결과가 없습니다.
                </td>
              </tr>
            )}
            {rows.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-3 font-medium text-slate-900">{u.name}</td>
                <td className="px-4 py-3 text-slate-600">{u.email}</td>
                <td className="px-4 py-3 text-slate-600">{u.orgName || "-"}</td>
                <td className="px-4 py-3 text-xs whitespace-nowrap">
                  {statusBadge(u)}
                  {verifyBadge(u)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end">{renderActions(u)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

// max-sm:* — 모바일(<640px) 터치 타깃 ~40px 확보. 데스크톱 밀도는 유지.
const btnBase =
  "px-2.5 py-1 max-sm:py-2.5 max-sm:px-3 text-xs rounded disabled:opacity-50";
const btnSec = `${btnBase} bg-white border border-slate-300 hover:bg-slate-50 text-slate-700`;
const btnDanger = `${btnBase} bg-danger-soft border border-danger/30 hover:bg-danger-soft/70 text-danger transition-colors`;
const btnVerify = `${btnBase} bg-primary-soft border border-primary/40 hover:bg-primary/10 text-primary-deep font-medium`;
const btnWarn = `${btnBase} bg-white border border-orange-300 hover:bg-orange-50 text-orange-700`;
const btnAccent = `${btnBase} bg-card border border-accent/50 hover:bg-accent-soft text-accent-deep transition-colors`;
const btnDeleteSolid = `${btnBase} bg-rose-600 hover:bg-rose-700 text-white`;
const selectCls =
  "px-2 py-1 max-sm:py-2.5 text-xs rounded-md border border-slate-300 bg-white text-slate-700 disabled:opacity-50 cursor-pointer hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/30";
