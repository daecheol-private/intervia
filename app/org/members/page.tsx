"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { formatLocalDateTime } from "@/lib/utils";
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
};

type JoinRequest = {
  id: number;
  orgId: number;
  userId: number;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  decidedAt: string | null;
  userEmail: string;
  userName: string;
  userEmailVerifiedAt: string | null;
  orgName: string;
};

type Tab = "members" | "requests";

function OrgMembersInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tab: Tab = searchParams.get("tab") === "requests" ? "requests" : "members";

  // 합류 요청 탭 배지용 — 대기 건수. 두 탭 모두에서 보이도록 페이지 레벨에서 보관.
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const loadPendingCount = useCallback(async () => {
    const res = await fetch("/api/orgs/join-requests?status=pending");
    if (!res.ok) return;
    const rows = (await res.json()) as JoinRequest[];
    setPendingCount(rows.length);
  }, []);
  useEffect(() => {
    void loadPendingCount();
  }, [loadPendingCount]);

  const setTab = (t: Tab) => {
    router.replace(t === "requests" ? "/org/members?tab=requests" : "/org/members");
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

      {/* 탭 — 멤버 / 합류 요청(대기 배지) */}
      <div className="flex items-center gap-1 mb-5 border-b border-slate-200">
        <TabButton active={tab === "members"} onClick={() => setTab("members")}>
          멤버
        </TabButton>
        <TabButton active={tab === "requests"} onClick={() => setTab("requests")}>
          합류 요청
          {pendingCount != null && pendingCount > 0 && (
            <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-white text-[11px] font-semibold leading-none">
              {pendingCount}
            </span>
          )}
        </TabButton>
      </div>

      {tab === "members" ? (
        <MembersTab />
      ) : (
        <RequestsTab onChanged={loadPendingCount} />
      )}
    </main>
  );
}

export default function OrgMembersPage() {
  // useSearchParams 는 Suspense 경계가 필요 (Next 16).
  return (
    <Suspense fallback={null}>
      <OrgMembersInner />
    </Suspense>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
        active
          ? "border-primary text-primary-deep"
          : "border-transparent text-slate-500 hover:text-slate-800"
      }`}
    >
      {children}
    </button>
  );
}

/* ──────────────────────────── 멤버 탭 ──────────────────────────── */

function MembersTab() {
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
    setRows(await res.json());
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

  return (
    <>
      {stepUpModal}
      <div className="mb-4 rounded-lg border border-border-default bg-surface-alt/60 px-4 py-3 text-xs text-ink-soft leading-relaxed">
        <div className="font-semibold text-ink mb-1">동료를 합류시키려면?</div>
        <ol className="list-decimal list-inside space-y-0.5">
          <li>동료가 회사 이메일로 <Link href="/signup" className="text-primary underline">회원가입</Link></li>
          <li>같은 도메인이면 자동으로 본 법인에 합류 요청이 생성됩니다</li>
          <li>관리자가 위의 <strong>합류 요청</strong> 탭에서 승인</li>
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
        {rows.map((m) => (
          <div
            key={m.id}
            className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm"
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
                {!m.emailVerifiedAt && <UnverifiedBadge />}
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap gap-1.5">
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
            {rows.map((m) => (
              <tr key={m.id}>
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
                  {!m.emailVerifiedAt && <UnverifiedBadge />}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-1.5 justify-end flex-wrap">
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
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ──────────────────────────── 합류 요청 탭 ──────────────────────────── */

function RequestsTab({ onChanged }: { onChanged: () => void }) {
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected">(
    "pending"
  );
  const [rows, setRows] = useState<JoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    const res = await fetch(`/api/orgs/join-requests?status=${filter}`);
    setLoading(false);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    setRows(await res.json());
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (id: number, action: "approve" | "reject") => {
    setBusyId(id);
    const res = await fetch(`/api/orgs/join-requests/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setBusyId(null);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    // 헤더 알림 배지 즉시 재조회 — 서버에서 관련 join_request 알림을 읽음 처리했으므로
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("intervia:notifications-refresh"));
    }
    void load();
    onChanged(); // 탭 배지(대기 건수) 갱신
  };

  return (
    <>
      <p className="text-sm text-slate-500 mb-4">
        법인에 합류를 요청한 사용자를 승인하거나 거절합니다.
      </p>

      <div className="flex gap-2 mb-4">
        {(["pending", "approved", "rejected"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 text-xs rounded-lg border ${
              filter === s
                ? "bg-primary text-white border-primary-deep"
                : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
            }`}
          >
            {s === "pending" ? "대기" : s === "approved" ? "승인됨" : "거절됨"}
          </button>
        ))}
      </div>

      {err && (
        <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2 mb-4">
          {err}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm divide-y divide-slate-100">
        {loading && <div className="p-6 text-sm text-slate-400">불러오는 중...</div>}
        {!loading && rows.length === 0 && (
          <div className="p-6 text-sm text-slate-400">요청이 없습니다.</div>
        )}
        {rows.map((r) => (
          <div key={r.id} className="p-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium text-slate-900 break-words">
                {r.userName}{" "}
                <span className="text-xs text-slate-500 break-all">{r.userEmail}</span>
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {r.orgName} · {formatLocalDateTime(r.createdAt, { format: { second: "2-digit" } })}
              </div>
              {r.status === "pending" && (
                r.userEmailVerifiedAt ? (
                  <div className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">
                    ✓ 메일 소유 확인됨
                  </div>
                ) : (
                  <div className="mt-1.5 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 leading-relaxed">
                    ⚠ 메일 소유 미확인 — 요청자가 인증 메일을 아직 확인하지 않았습니다.
                    본인·재직 여부를 직접 확인한 뒤 승인하세요.
                  </div>
                )
              )}
            </div>
            {r.status === "pending" ? (
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => decide(r.id, "approve")}
                  disabled={busyId === r.id}
                  className="px-3 py-1.5 text-xs bg-primary hover:bg-primary-deep text-white rounded-lg disabled:opacity-50"
                >
                  승인
                </button>
                <button
                  onClick={() => decide(r.id, "reject")}
                  disabled={busyId === r.id}
                  className="px-3 py-1.5 text-xs bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg disabled:opacity-50"
                >
                  거절
                </button>
              </div>
            ) : (
              <span
                className={`text-xs px-2 py-1 rounded ${
                  r.status === "approved"
                    ? "bg-primary-soft text-primary-deep"
                    : "bg-slate-100 text-slate-500"
                }`}
              >
                {r.status === "approved" ? "승인됨" : "거절됨"}
              </span>
            )}
          </div>
        ))}
      </div>
    </>
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
