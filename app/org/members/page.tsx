"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useStepUpFetch } from "@/app/components/StepUpModal";

type Member = {
  id: number;
  email: string;
  name: string;
  role: "system_admin" | "org_admin" | "member";
  status: "active" | "pending" | "disabled";
  createdAt: string;
  orgName: string | null;
  emailVerifiedAt: string | null;
  // 대기 중인 합류 요청 id (있으면 이 행에서 바로 승인/거절). null 이면 일반 멤버.
  joinRequestId: number | null;
};

export default function OrgMembersPage() {
  const [rows, setRows] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    const res = await fetch("/api/orgs/members");
    setLoading(false);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    const data = (await res.json()) as Member[];
    // 승인대기(합류 요청) 행을 맨 위로. 그 외는 API 정렬(createdAt desc) 유지 — JS sort 는 stable.
    data.sort(
      (a, b) => (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1)
    );
    setRows(data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const { ensureFetch, modal: stepUpModal } = useStepUpFetch();

  const update = async (
    id: number,
    body: {
      role?: Member["role"];
      status?: "active" | "disabled";
      emailVerified?: boolean;
    }
  ) => {
    setBusyId(id);
    setErr("");
    const reason = body.emailVerified
      ? "멤버 이메일을 관리자가 대신 인증 처리합니다."
      : body.role
        ? `멤버 권한을 ${body.role} 으로 변경합니다.`
        : `멤버 상태를 ${body.status === "disabled" ? "비활성" : "활성"} 으로 변경합니다.`;
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

  // 합류 요청 승인/거절 — join_requests 엔티티에 작용(승인 시 본인확인·orgId 확정·공유 공고
  // 면접관 자동등록·알림 읽음 처리 포함). 멤버 권한 변경(/api/users)과는 다른 엔드포인트.
  const decide = async (m: Member, action: "approve" | "reject") => {
    if (m.joinRequestId == null) return;
    setBusyId(m.id);
    setErr("");
    const res = await fetch(`/api/orgs/join-requests/${m.joinRequestId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setBusyId(null);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    // 헤더 알림 배지 즉시 재조회 — 서버가 관련 join_request 알림을 읽음 처리했으므로.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("intervia:notifications-refresh"));
    }
    void load();
  };

  return (
    <main className="max-w-5xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-6">
        <Link href="/" className="text-xs text-slate-500 hover:underline">
          ← 대시보드
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-2">법인 멤버 관리</h1>
        <p className="text-sm text-slate-500 mt-1">
          멤버 권한을 부여·비활성화하거나, 법인 합류 요청을 승인할 수 있습니다.
        </p>
      </div>

      {stepUpModal}

      <div className="mb-4 rounded-lg border border-border-default bg-surface-alt/60 px-4 py-3 text-xs text-ink-soft leading-relaxed">
        <div className="font-semibold text-ink mb-1">동료를 합류시키려면?</div>
        <ol className="list-decimal list-inside space-y-0.5">
          <li>동료가 회사 이메일로 <Link href="/signup" className="text-primary underline">회원가입</Link></li>
          <li>같은 도메인이면 자동으로 본 법인에 합류 요청이 생성됩니다</li>
          <li>아래 목록 상단의 <strong>승인대기</strong> 항목에서 승인</li>
        </ol>
      </div>

      {err && (
        <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2 mb-4">
          {err}
        </div>
      )}

      {/* 모바일: 카드 리스트 (테이블 셀 폭 부족으로 이름이 세로로 깨지는 문제 해결) */}
      <div className="sm:hidden space-y-3">
        {loading && (
          <div className="text-slate-400 text-sm py-6 text-center">불러오는 중...</div>
        )}
        {!loading && rows.length === 0 && (
          <div className="text-slate-400 text-sm py-6 text-center">멤버가 없습니다.</div>
        )}
        {rows.map((m) => {
          const isPending = m.status === "pending" && m.joinRequestId != null;
          return (
            <div
              key={m.id}
              className={`border rounded-xl p-4 shadow-sm ${
                isPending
                  ? "bg-amber-50/60 border-amber-200"
                  : "bg-white border-slate-200"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-slate-900 break-words">
                    {m.name && m.name.trim() ? (
                      m.name
                    ) : (
                      <span className="text-slate-400 italic font-normal">
                        이름 미등록
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 break-all mt-0.5">
                    {m.email}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <RoleBadge role={m.role} />
                  <StatusBadge status={m.status} />
                  {!m.emailVerifiedAt && !isPending && <UnverifiedBadge />}
                </div>
              </div>

              {isPending && <JoinRequestNotice verified={!!m.emailVerifiedAt} />}

              <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap gap-1.5">
                {isPending ? (
                  <>
                    <button
                      onClick={() => decide(m, "approve")}
                      disabled={busyId === m.id}
                      className={btnPrimary}
                    >
                      승인
                    </button>
                    <button
                      onClick={() => decide(m, "reject")}
                      disabled={busyId === m.id}
                      className={btnSecondary}
                    >
                      거절
                    </button>
                  </>
                ) : (
                  <MemberActions m={m} busyId={busyId} update={update} />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 데스크톱: 전체 테이블 */}
      <div className="hidden sm:block bg-white border border-slate-200 rounded-2xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs">
            <tr>
              <th className="text-left px-4 py-3 font-medium">이름</th>
              <th className="text-left px-4 py-3 font-medium">이메일</th>
              <th className="text-left px-4 py-3 font-medium">권한</th>
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
                  멤버가 없습니다.
                </td>
              </tr>
            )}
            {rows.map((m) => {
              const isPending = m.status === "pending" && m.joinRequestId != null;
              return (
                <tr key={m.id} className={isPending ? "bg-amber-50/50" : undefined}>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {m.name && m.name.trim() ? (
                      m.name
                    ) : (
                      <span className="text-slate-400 italic font-normal">
                        이름 미등록
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{m.email}</td>
                  <td className="px-4 py-3">
                    <RoleBadge role={m.role} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={m.status} />
                    {!m.emailVerifiedAt && !isPending && <UnverifiedBadge />}
                  </td>
                  <td className="px-4 py-3">
                    {isPending ? (
                      <div className="flex flex-col items-end gap-1.5">
                        <div className="flex gap-1.5 justify-end">
                          <button
                            onClick={() => decide(m, "approve")}
                            disabled={busyId === m.id}
                            className={btnPrimary}
                          >
                            승인
                          </button>
                          <button
                            onClick={() => decide(m, "reject")}
                            disabled={busyId === m.id}
                            className={btnSecondary}
                          >
                            거절
                          </button>
                        </div>
                        <div className="max-w-[260px]">
                          <JoinRequestNotice verified={!!m.emailVerifiedAt} />
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-1.5 justify-end flex-wrap">
                        <MemberActions m={m} busyId={busyId} update={update} />
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}

/* 일반 멤버(비-pending) 액션 버튼 묶음 — 데스크톱/모바일 공용. */
function MemberActions({
  m,
  busyId,
  update,
}: {
  m: Member;
  busyId: number | null;
  update: (
    id: number,
    body: {
      role?: Member["role"];
      status?: "active" | "disabled";
      emailVerified?: boolean;
    }
  ) => void;
}) {
  return (
    <>
      {!m.emailVerifiedAt && (
        <button
          onClick={() => {
            if (
              confirm(
                `${m.name || m.email} 님의 이메일을 인증 완료로 처리합니다.\n\n인증 메일이 도달하지 않는 멤버를 위한 기능입니다. 본인 소유 이메일이 맞는지 확인 후 진행하세요. 처리 즉시 로그인이 가능해집니다.`
              )
            )
              void update(m.id, { emailVerified: true });
          }}
          disabled={busyId === m.id}
          className={btnPrimary}
        >
          ✓ 이메일 인증
        </button>
      )}
      {m.role === "member" && m.status === "active" && (
        <button
          onClick={() => update(m.id, { role: "org_admin" })}
          disabled={busyId === m.id}
          className={btnPrimary}
        >
          관리자 부여
        </button>
      )}
      {m.role === "org_admin" && (
        <button
          onClick={() => update(m.id, { role: "member" })}
          disabled={busyId === m.id}
          className={btnSecondary}
        >
          일반으로
        </button>
      )}
      {m.status === "active" && m.role !== "system_admin" && (
        <button
          onClick={() => {
            if (confirm(`${m.name} 님을 비활성화합니다.`))
              void update(m.id, { status: "disabled" });
          }}
          disabled={busyId === m.id}
          className={btnDanger}
        >
          비활성화
        </button>
      )}
      {m.status === "disabled" && (
        <button
          onClick={() => update(m.id, { status: "active" })}
          disabled={busyId === m.id}
          className={btnSecondary}
        >
          활성화
        </button>
      )}
    </>
  );
}

// 합류 요청 대기 행의 메일 소유 확인 안내 — 사회공학 방어(사칭 가입 조기 차단).
// 미확인이면 승인 전에 본인·재직 여부를 직접 확인하도록 경고.
function JoinRequestNotice({ verified }: { verified: boolean }) {
  if (verified) {
    return (
      <div className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">
        ✓ 메일 소유 확인됨
      </div>
    );
  }
  return (
    <div className="mt-1.5 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 leading-relaxed text-left">
      ⚠ 메일 소유 미확인 — 요청자가 인증 메일을 아직 확인하지 않았습니다. 본인·재직
      여부를 직접 확인한 뒤 승인하세요.
    </div>
  );
}

function RoleBadge({ role }: { role: Member["role"] }) {
  const map = {
    system_admin: { label: "시스템 관리자", cls: "bg-amber-50 text-amber-700" },
    org_admin: { label: "법인 관리자", cls: "bg-primary-soft text-primary-deep" },
    member: { label: "일반", cls: "bg-slate-100 text-slate-700" },
  };
  const { label, cls } = map[role];
  return <span className={`text-xs px-2 py-0.5 rounded ${cls}`}>{label}</span>;
}

// 이메일 미인증 — 로그인이 차단된 상태임을 관리자가 즉시 인지하도록.
function UnverifiedBadge() {
  return (
    <span
      className="text-xs px-2 py-0.5 rounded bg-danger-soft text-danger border border-danger/30 ml-1"
      title="이메일 미인증 — 현재 로그인 불가"
    >
      메일 미인증
    </span>
  );
}

function StatusBadge({ status }: { status: Member["status"] }) {
  const map = {
    active: { label: "활성", cls: "bg-primary-soft text-primary-deep" },
    pending: { label: "승인대기", cls: "bg-amber-50 text-amber-700" },
    disabled: { label: "비활성", cls: "bg-slate-100 text-slate-500" },
  };
  const { label, cls } = map[status];
  return <span className={`text-xs px-2 py-0.5 rounded ${cls}`}>{label}</span>;
}

// max-sm:* — 모바일(<640px) 터치 타깃 ~40px 확보. 데스크톱 테이블 밀도는 유지.
const btnPrimary =
  "px-2.5 py-1 max-sm:py-2.5 max-sm:px-3.5 text-xs bg-primary hover:bg-primary-deep text-white rounded disabled:opacity-50";
const btnSecondary =
  "px-2.5 py-1 max-sm:py-2.5 max-sm:px-3.5 text-xs bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded disabled:opacity-50";
const btnDanger =
  "px-2.5 py-1 max-sm:py-2.5 max-sm:px-3.5 text-xs bg-danger-soft border border-danger/30 hover:bg-danger-soft/70 text-danger rounded disabled:opacity-50 transition-colors";
