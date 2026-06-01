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

  // 작업 버튼 묶음 — 데스크톱 테이블 / 모바일 카드 공용
  const renderActionButtons = (u: Row) => (
    <>
      {!u.emailVerifiedAt && (
        <button
          onClick={() => {
            if (
              confirm(
                `'${u.name}' (${u.email}) 의 이메일을 인증 완료로 처리합니다.\n\n인증 메일이 도달하지 않는 사용자를 위한 기능입니다. 본인 소유 이메일이 맞는지 확인 후 진행하세요. 처리 즉시 로그인이 가능해집니다.`
              )
            )
              update(u.id, { emailVerified: true });
          }}
          disabled={busyId === u.id}
          className="px-2.5 py-1 max-sm:py-2.5 max-sm:px-3 text-xs bg-primary-soft border border-primary/40 hover:bg-primary/10 text-primary-deep rounded disabled:opacity-50 font-medium"
        >
          ✓ 이메일 인증
        </button>
      )}
      {u.role === "member" && (
        <button
          onClick={() => {
            if (
              confirm(
                `'${u.name}' (${u.email}) 를 ${u.orgName ?? "법인"} 의 org_admin 으로 승급합니다.\n법인의 멤버 관리·합류 승인 권한을 가지게 됩니다.`
              )
            )
              update(u.id, { role: "org_admin" });
          }}
          disabled={busyId === u.id}
          className={btnSec}
        >
          → org_admin
        </button>
      )}
      {u.role === "org_admin" && (
        <button
          onClick={() => {
            if (
              confirm(
                `'${u.name}' (${u.email}) 를 일반 member 로 강등합니다.\n법인 관리 권한이 즉시 회수됩니다.`
              )
            )
              update(u.id, { role: "member" });
          }}
          disabled={busyId === u.id}
          className={btnSec}
        >
          → member
        </button>
      )}
      {u.role !== "system_admin" && (
        <button
          onClick={() => {
            if (
              confirm(
                `'${u.name}' (${u.email}) 에게 시스템 관리자 권한을 부여합니다.\n\n시스템 관리자는 모든 법인 데이터에 접근 가능합니다. 진행하시겠습니까?`
              )
            )
              update(u.id, { role: "system_admin" });
          }}
          disabled={busyId === u.id}
          className="px-2.5 py-1 max-sm:py-2.5 max-sm:px-3 text-xs bg-amber-50 border border-amber-300 hover:bg-amber-100 text-amber-700 rounded disabled:opacity-50"
        >
          → system_admin
        </button>
      )}
      {u.role === "system_admin" && (
        <button
          onClick={() => {
            if (
              confirm(
                `'${u.name}' 의 시스템 관리자 권한을 회수합니다.\n(현재 법인의 ${u.orgName ? "org_admin" : "member"}으로 복귀)`
              )
            )
              update(u.id, {
                role: u.orgName ? "org_admin" : "member",
              });
          }}
          disabled={busyId === u.id}
          className={btnDanger}
        >
          sysadmin 회수
        </button>
      )}
      {u.status === "active" && (
        <button
          onClick={() => {
            if (
              confirm(
                `'${u.name}' (${u.email}) 를 비활성화합니다.\n사용자는 즉시 로그인 불가가 되며, 보유 세션도 만료됩니다.`
              )
            )
              update(u.id, { status: "disabled" });
          }}
          disabled={busyId === u.id}
          className={btnDanger}
        >
          비활성
        </button>
      )}
      {u.status !== "active" && (
        <button
          onClick={() => {
            if (
              confirm(
                `'${u.name}' (${u.email}) 를 활성 상태로 전환합니다.\n${
                  u.status === "pending"
                    ? "이 사용자는 합류 승인 대기 중입니다 — 일반적으로는 멤버 관리 > 합류 요청 탭에서 승인하는 것이 권장됩니다."
                    : "재로그인이 가능해집니다."
                }`
              )
            )
              update(u.id, { status: "active" });
          }}
          disabled={busyId === u.id}
          className={btnSec}
        >
          활성
        </button>
      )}
      <button
        onClick={async () => {
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
        }}
        disabled={busyId === u.id}
        className="px-2.5 py-1 max-sm:py-2.5 max-sm:px-3 text-xs bg-white border border-orange-300 hover:bg-orange-50 text-orange-700 rounded disabled:opacity-50"
      >
        강제 로그아웃
      </button>
      <button
        onClick={async () => {
          if (!confirm(`'${u.email}' 로 비밀번호 리셋 메일을 발송합니다.`))
            return;
          setBusyId(u.id);
          const res = await fetch(`/api/admin/users/${u.id}/password-reset`, {
            method: "POST",
          });
          setBusyId(null);
          if (!res.ok) {
            setErr(await res.text());
            return;
          }
          const d = (await res.json()) as {
            mailSent: boolean;
            error: string | null;
          };
          alert(
            d.mailSent
              ? "메일 발송 완료. 사용자가 메일함을 확인하면 됩니다."
              : `메일 발송 실패: ${d.error ?? "알 수 없는 오류"}`
          );
        }}
        disabled={busyId === u.id}
        className="px-2.5 py-1 max-sm:py-2.5 max-sm:px-3 text-xs bg-card border border-accent/50 hover:bg-accent-soft text-accent-deep rounded disabled:opacity-50 transition-colors"
      >
        비번 리셋
      </button>
    </>
  );

  // 권한/상태 배지 — 공용
  const roleBadge = (u: Row) =>
    u.role === "system_admin" ? (
      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200 uppercase tracking-wide">
        system_admin
      </span>
    ) : (
      <span className="text-slate-600">{u.role}</span>
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
    ) : (
      <span className="text-slate-600">{u.status}</span>
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
            <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap gap-1.5">
              {renderActionButtons(u)}
            </div>
          </div>
        ))}
      </div>

      {/* 데스크톱: 전체 테이블 */}
      <div className="hidden sm:block bg-white border border-slate-200 rounded-2xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs">
            <tr>
              <th className="text-left px-4 py-3 font-medium">이름</th>
              <th className="text-left px-4 py-3 font-medium">이메일</th>
              <th className="text-left px-4 py-3 font-medium">법인</th>
              <th className="text-left px-4 py-3 font-medium">권한</th>
              <th className="text-left px-4 py-3 font-medium">상태</th>
              <th className="text-right px-4 py-3 font-medium">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr>
                <td className="px-4 py-6 text-slate-400" colSpan={6}>
                  불러오는 중...
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-slate-400" colSpan={6}>
                  결과가 없습니다.
                </td>
              </tr>
            )}
            {rows.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-3 font-medium text-slate-900">{u.name}</td>
                <td className="px-4 py-3 text-slate-600">{u.email}</td>
                <td className="px-4 py-3 text-slate-600">{u.orgName || "-"}</td>
                <td className="px-4 py-3 text-xs">
                  {u.role === "system_admin" ? (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200 uppercase tracking-wide">
                      system_admin
                    </span>
                  ) : (
                    u.role
                  )}
                </td>
                <td className="px-4 py-3 text-xs">
                  {u.status === "pending" ? (
                    <Link
                      href="/org/members?tab=requests"
                      className="inline-flex items-center gap-1 text-warning hover:text-warning/80 hover:underline"
                      title="합류 요청 탭으로 이동 — 정식 승인 권장"
                    >
                      pending
                      <span aria-hidden>↗</span>
                    </Link>
                  ) : (
                    u.status
                  )}
                  {verifyBadge(u)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-1.5 justify-end flex-wrap">
                    {!u.emailVerifiedAt && (
                      <button
                        onClick={() => {
                          if (
                            confirm(
                              `'${u.name}' (${u.email}) 의 이메일을 인증 완료로 처리합니다.\n\n인증 메일이 도달하지 않는 사용자를 위한 기능입니다. 본인 소유 이메일이 맞는지 확인 후 진행하세요. 처리 즉시 로그인이 가능해집니다.`
                            )
                          )
                            update(u.id, { emailVerified: true });
                        }}
                        disabled={busyId === u.id}
                        className="px-2.5 py-1 max-sm:py-2.5 max-sm:px-3 text-xs bg-primary-soft border border-primary/40 hover:bg-primary/10 text-primary-deep rounded disabled:opacity-50 font-medium"
                      >
                        ✓ 이메일 인증
                      </button>
                    )}
                    {u.role === "member" && (
                      <button
                        onClick={() => {
                          if (
                            confirm(
                              `'${u.name}' (${u.email}) 를 ${u.orgName ?? "법인"} 의 org_admin 으로 승급합니다.\n법인의 멤버 관리·합류 승인 권한을 가지게 됩니다.`
                            )
                          )
                            update(u.id, { role: "org_admin" });
                        }}
                        disabled={busyId === u.id}
                        className={btnSec}
                      >
                        → org_admin
                      </button>
                    )}
                    {u.role === "org_admin" && (
                      <button
                        onClick={() => {
                          if (
                            confirm(
                              `'${u.name}' (${u.email}) 를 일반 member 로 강등합니다.\n법인 관리 권한이 즉시 회수됩니다.`
                            )
                          )
                            update(u.id, { role: "member" });
                        }}
                        disabled={busyId === u.id}
                        className={btnSec}
                      >
                        → member
                      </button>
                    )}
                    {u.role !== "system_admin" && (
                      <button
                        onClick={() => {
                          if (
                            confirm(
                              `'${u.name}' (${u.email}) 에게 시스템 관리자 권한을 부여합니다.\n\n시스템 관리자는 모든 법인 데이터에 접근 가능합니다. 진행하시겠습니까?`
                            )
                          )
                            update(u.id, { role: "system_admin" });
                        }}
                        disabled={busyId === u.id}
                        className="px-2.5 py-1 max-sm:py-2.5 max-sm:px-3 text-xs bg-amber-50 border border-amber-300 hover:bg-amber-100 text-amber-700 rounded disabled:opacity-50"
                      >
                        → system_admin
                      </button>
                    )}
                    {u.role === "system_admin" && (
                      <button
                        onClick={() => {
                          if (
                            confirm(
                              `'${u.name}' 의 시스템 관리자 권한을 회수합니다.\n(현재 법인의 ${u.orgName ? "org_admin" : "member"}으로 복귀)`
                            )
                          )
                            update(u.id, {
                              role: u.orgName ? "org_admin" : "member",
                            });
                        }}
                        disabled={busyId === u.id}
                        className={btnDanger}
                      >
                        sysadmin 회수
                      </button>
                    )}
                    {u.status === "active" && (
                      <button
                        onClick={() => {
                          if (
                            confirm(
                              `'${u.name}' (${u.email}) 를 비활성화합니다.\n사용자는 즉시 로그인 불가가 되며, 보유 세션도 만료됩니다.`
                            )
                          )
                            update(u.id, { status: "disabled" });
                        }}
                        disabled={busyId === u.id}
                        className={btnDanger}
                      >
                        비활성
                      </button>
                    )}
                    {u.status !== "active" && (
                      <button
                        onClick={() => {
                          if (
                            confirm(
                              `'${u.name}' (${u.email}) 를 활성 상태로 전환합니다.\n${
                                u.status === "pending"
                                  ? "이 사용자는 합류 승인 대기 중입니다 — 일반적으로는 멤버 관리 > 합류 요청 탭에서 승인하는 것이 권장됩니다."
                                  : "재로그인이 가능해집니다."
                              }`
                            )
                          )
                            update(u.id, { status: "active" });
                        }}
                        disabled={busyId === u.id}
                        className={btnSec}
                      >
                        활성
                      </button>
                    )}
                    <button
                      onClick={async () => {
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
                      }}
                      disabled={busyId === u.id}
                      className="px-2.5 py-1 max-sm:py-2.5 max-sm:px-3 text-xs bg-white border border-orange-300 hover:bg-orange-50 text-orange-700 rounded disabled:opacity-50"
                    >
                      강제 로그아웃
                    </button>
                    <button
                      onClick={async () => {
                        if (
                          !confirm(
                            `'${u.email}' 로 비밀번호 리셋 메일을 발송합니다.`
                          )
                        )
                          return;
                        setBusyId(u.id);
                        const res = await fetch(
                          `/api/admin/users/${u.id}/password-reset`,
                          { method: "POST" }
                        );
                        setBusyId(null);
                        if (!res.ok) {
                          setErr(await res.text());
                          return;
                        }
                        const d = (await res.json()) as {
                          mailSent: boolean;
                          error: string | null;
                        };
                        alert(
                          d.mailSent
                            ? "메일 발송 완료. 사용자가 메일함을 확인하면 됩니다."
                            : `메일 발송 실패: ${d.error ?? "알 수 없는 오류"}`
                        );
                      }}
                      disabled={busyId === u.id}
                      className="px-2.5 py-1 max-sm:py-2.5 max-sm:px-3 text-xs bg-card border border-accent/50 hover:bg-accent-soft text-accent-deep rounded disabled:opacity-50 transition-colors"
                    >
                      비번 리셋
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

// max-sm:* — 모바일(<640px) 터치 타깃 ~40px 확보. 데스크톱 테이블 밀도는 유지.
const btnSec =
  "px-2.5 py-1 max-sm:py-2.5 max-sm:px-3 text-xs bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded disabled:opacity-50";
const btnDanger =
  "px-2.5 py-1 max-sm:py-2.5 max-sm:px-3 text-xs bg-danger-soft border border-danger/30 hover:bg-danger-soft/70 text-danger rounded disabled:opacity-50 transition-colors";
