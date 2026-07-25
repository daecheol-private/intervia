"use client";

import { useEffect, useState, useCallback } from "react";
import { useStepUpFetch } from "@/app/components/StepUpModal";
import { Users } from "lucide-react";

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

// 같은 이메일 도메인을 쓰는 다른 법인 — "같은 도메인 새 법인 등록" 알림의 확인 대상.
type DomainOrg = {
  id: number;
  name: string;
  createdAt: string | null;
  verificationStatus:
    | "dart_matched"
    | "verified"
    | "pending_review"
    | "rejected";
  // 내 법인이 이 코테넌트를 검토한 상태. null = 미검토 (영속).
  reviewStatus: "acknowledged" | "reported" | null;
};

export default function OrgMembersPage() {
  const [rows, setRows] = useState<Member[]>([]);
  const [domainShared, setDomainShared] = useState(false);
  const [domainOrgs, setDomainOrgs] = useState<DomainOrg[]>([]);
  const [reviewBusyId, setReviewBusyId] = useState<number | null>(null);
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
    const data = (await res.json()) as {
      members: Member[];
      domainShared: boolean;
      domainOrgs?: DomainOrg[];
    };
    const members = data.members ?? [];
    // 승인대기(합류 요청) 행을 맨 위로. 그 외는 API 정렬(createdAt desc) 유지 — JS sort 는 stable.
    members.sort(
      (a, b) => (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1)
    );
    setRows(members);
    setDomainShared(!!data.domainShared);
    setDomainOrgs(data.domainOrgs ?? []);
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

  // 같은 도메인 코테넌트 검토 — acknowledge(아는 법인, 안내 숨김) / report(모르는 법인, 운영자 신고).
  // 상태는 서버(org_domain_reviews)에 영속 저장되어 리프레시 후에도 유지된다.
  const review = async (org: DomainOrg, action: "acknowledge" | "report") => {
    const confirmMsg =
      action === "report"
        ? `'${org.name}' 법인을 모르는(미인지) 법인으로 운영자에게 신고합니다.\n\n계열사 등 아는 법인이면 신고하지 마세요. 신고 내용은 시스템 운영자에게 전달되어 검토됩니다.`
        : `'${org.name}' 법인을 아는(관계사) 법인으로 확인 처리합니다.\n\n확인하면 이 목록에서 더 이상 표시되지 않습니다.`;
    if (!confirm(confirmMsg)) return;
    setReviewBusyId(org.id);
    setErr("");
    const res = await fetch("/api/orgs/domain-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: org.id, action }),
    });
    setReviewBusyId(null);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    // 서버 상태를 다시 읽어 reviewStatus 반영 (영속 — 리프레시해도 유지).
    void load();
  };

  return (
    <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-6">
        <div className="flex items-center gap-2">
          <Users className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold text-ink">법인 멤버 관리</h1>
        </div>
        <p className="text-sm text-ink-soft mt-1">
          멤버 권한을 부여·비활성화하거나, 법인 합류 요청을 승인할 수 있습니다.
        </p>
      </div>

      {stepUpModal}

      <div className="mb-4 rounded-lg border border-border-default bg-surface-alt/60 px-4 py-3 text-xs text-ink-soft leading-relaxed">
        <div className="font-semibold text-ink mb-1">동료를 합류시키려면?</div>
        <ol className="list-decimal list-inside space-y-0.5">
          <li>동료가 회사 이메일로 <strong>회원가입</strong></li>
          <li>같은 도메인이면 자동으로 본 법인에 합류 요청이 생성됩니다</li>
          <li>아래 목록 상단의 <strong>승인대기</strong> 항목에서 승인</li>
        </ol>
      </div>

      {/* 같은 도메인을 쓰는 다른 법인 — "같은 도메인 새 법인 등록" 알림의 확인·조치 지점.
          아는(관계사) 법인은 "확인"으로 숨기고, 모르는 법인이면 운영자에게 신고(검토 요청).
          확인된(acknowledged) 법인은 목록에서 제외 — 검토가 필요한 것만 남긴다. */}
      {domainOrgs.filter((o) => o.reviewStatus !== "acknowledged").length > 0 && (
        <div className="mb-4 rounded-lg border border-warning bg-warning-soft/60 px-4 py-3">
          <div className="text-sm font-semibold text-warning mb-1">
            같은 도메인을 쓰는 다른 법인
          </div>
          <p className="text-xs text-warning leading-relaxed mb-3">
            아래 법인이 같은 이메일 도메인으로 등록되어 있습니다. 계열사 등{" "}
            <strong>아는 법인</strong>이면 “확인”을 눌러 정리하고,{" "}
            <strong>모르는 법인</strong>이면 신고해 주세요 — 시스템 운영자가
            검토합니다.
          </p>
          <ul className="space-y-2">
            {domainOrgs
              .filter((o) => o.reviewStatus !== "acknowledged")
              .map((o) => (
                <li
                  key={o.id}
                  className="flex items-center justify-between gap-3 bg-card border border-warning rounded-lg px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-ink text-sm break-words">
                      {o.name}
                    </div>
                    <div className="text-[11px] text-ink-muted mt-0.5 flex items-center gap-2 flex-wrap">
                      <OrgVerifyBadge status={o.verificationStatus} />
                      {o.createdAt && (
                        <span>등록일 {o.createdAt.slice(0, 10)}</span>
                      )}
                    </div>
                  </div>
                  {o.reviewStatus === "reported" ? (
                    <span className="shrink-0 text-xs text-danger bg-danger-soft border border-danger rounded px-2 py-1">
                      ✓ 신고됨 — 운영자 검토 중
                    </span>
                  ) : (
                    <div className="shrink-0 flex gap-1.5">
                      <button
                        onClick={() => review(o, "acknowledge")}
                        disabled={reviewBusyId === o.id}
                        className="px-2.5 py-1.5 text-xs bg-card border border-border-strong text-ink-soft hover:bg-surface-alt rounded disabled:opacity-50"
                      >
                        {reviewBusyId === o.id ? "처리 중..." : "아는 법인 (확인)"}
                      </button>
                      <button
                        onClick={() => review(o, "report")}
                        disabled={reviewBusyId === o.id}
                        className="px-2.5 py-1.5 text-xs bg-card border border-danger text-danger hover:bg-danger-soft rounded disabled:opacity-50"
                      >
                        모르는 법인 신고
                      </button>
                    </div>
                  )}
                </li>
              ))}
          </ul>
        </div>
      )}

      {err && (
        <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2 mb-4">
          {err}
        </div>
      )}

      {/* 모바일: 카드 리스트 (테이블 셀 폭 부족으로 이름이 세로로 깨지는 문제 해결) */}
      <div className="sm:hidden space-y-3">
        {loading && (
          <div className="text-ink-muted text-sm py-6 text-center">불러오는 중...</div>
        )}
        {!loading && rows.length === 0 && (
          <div className="text-ink-muted text-sm py-6 text-center">멤버가 없습니다.</div>
        )}
        {rows.map((m) => {
          const isPending = m.status === "pending" && m.joinRequestId != null;
          return (
            <div
              key={m.id}
              className={`border rounded-xl p-4 shadow-sm ${
                isPending
                  ? "bg-warning-soft/60 border-warning"
                  : "bg-card border-border-default"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-ink break-words">
                    {m.name && m.name.trim() ? (
                      m.name
                    ) : (
                      <span className="text-ink-muted italic font-normal">
                        이름 미등록
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-ink-muted break-all mt-0.5">
                    {m.email}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <RoleBadge role={m.role} />
                  <StatusBadge status={m.status} />
                  {!m.emailVerifiedAt && !isPending && <UnverifiedBadge />}
                </div>
              </div>

              {isPending && <JoinRequestNotice verified={!!m.emailVerifiedAt} sharedDomain={domainShared} />}

              <div className="mt-3 pt-3 border-t border-border-default flex flex-wrap gap-1.5">
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
      <div className="hidden sm:block bg-card border border-border-default rounded-2xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-alt text-ink-soft text-xs">
            <tr>
              <th className="text-left px-4 py-3 font-medium">이름</th>
              <th className="text-left px-4 py-3 font-medium">이메일</th>
              <th className="text-left px-4 py-3 font-medium">권한</th>
              <th className="text-left px-4 py-3 font-medium">상태</th>
              <th className="text-right px-4 py-3 font-medium">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-default">
            {loading && (
              <tr>
                <td className="px-4 py-6 text-ink-muted" colSpan={5}>
                  불러오는 중...
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-ink-muted" colSpan={5}>
                  멤버가 없습니다.
                </td>
              </tr>
            )}
            {rows.map((m) => {
              const isPending = m.status === "pending" && m.joinRequestId != null;
              return (
                <tr key={m.id} className={isPending ? "bg-warning-soft/50" : undefined}>
                  <td className="px-4 py-3 font-medium text-ink">
                    {m.name && m.name.trim() ? (
                      m.name
                    ) : (
                      <span className="text-ink-muted italic font-normal">
                        이름 미등록
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink-soft">{m.email}</td>
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
                          <JoinRequestNotice verified={!!m.emailVerifiedAt} sharedDomain={domainShared} />
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
                `${m.name || m.email} 님의 이메일을 관리자 권한으로 대신 인증 처리합니다.\n\n` +
                  `⚠ 이메일 인증은 "본인이 그 메일함을 소유한다"는 증명입니다. 관리자가 대신 인증하면 이 증명을 건너뛰므로, 타인이 이 사람의 이메일로 가입을 시도한 경우 사칭 계정을 활성화시킬 수 있습니다.\n\n` +
                  `반드시 요청자가 실제 본인이자 우리 회사 재직자임을 직접 확인한 뒤에만 진행하세요. (인증 메일이 회사 보안필터에 막혀 도달하지 않는 경우의 구제용)\n\n` +
                  `이 작업은 감사 로그에 기록됩니다. 처리 즉시 로그인이 가능해집니다.`
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
// 공유 도메인(여러 법인이 한 도메인 사용)이면 메일 소유가 확인돼도 우리 회사 소속 보장이
// 안 되므로 별도 경고를 추가로 띄운다 (H2 — 동명이인·외부 co-tenant 침투 방지).
function JoinRequestNotice({
  verified,
  sharedDomain,
}: {
  verified: boolean;
  sharedDomain: boolean;
}) {
  return (
    <div className="mt-1.5 space-y-1.5">
      {verified ? (
        <div className="inline-flex items-center gap-1 text-[11px] font-medium text-success bg-success-soft border border-success rounded px-1.5 py-0.5">
          ✓ 메일 소유 확인됨
        </div>
      ) : (
        <div className="text-[11px] text-warning bg-warning-soft border border-warning rounded px-2 py-1 leading-relaxed text-left">
          ⚠ 메일 소유 미확인 — 요청자가 인증 메일을 아직 확인하지 않았습니다. 본인·재직
          여부를 직접 확인한 뒤 승인하세요.
        </div>
      )}
      {sharedDomain && (
        <div className="text-[11px] text-danger bg-danger-soft border border-danger rounded px-2 py-1 leading-relaxed text-left">
          ⚠ 공유 도메인 — 이 이메일 도메인은 여러 법인이 함께 사용합니다. 메일 소유가
          확인되더라도 우리 회사 소속이 아닐 수 있으니, 실제 본인·재직 여부를 직접 확인한
          뒤 승인하세요.
        </div>
      )}
    </div>
  );
}

// 같은 도메인 법인의 검증 상태 배지 (신호용). rejected 는 서버에서 제외되어 보통 안 뜸.
function OrgVerifyBadge({
  status,
}: {
  status: DomainOrg["verificationStatus"];
}) {
  const cfg =
    status === "dart_matched"
      ? { label: "✓ DART", cls: "bg-success-soft text-success border-success/30" }
      : status === "verified"
        ? { label: "✓ 검증", cls: "bg-success-soft text-success border-success/30" }
        : status === "pending_review"
          ? { label: "⏳ 검토 대기", cls: "bg-warning-soft text-warning border-warning/30" }
          : { label: "✕ 거절", cls: "bg-danger-soft text-danger border-danger/30" };
  return (
    <span
      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${cfg.cls}`}
    >
      {cfg.label}
    </span>
  );
}

function RoleBadge({ role }: { role: Member["role"] }) {
  const map = {
    system_admin: { label: "시스템 관리자", cls: "bg-surface-alt text-ink-soft" },
    org_admin: { label: "법인 관리자", cls: "bg-primary-soft text-primary-deep" },
    member: { label: "일반", cls: "bg-surface-alt text-ink-soft" },
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
    pending: { label: "승인대기", cls: "bg-warning-soft text-warning" },
    disabled: { label: "비활성", cls: "bg-surface-alt text-ink-muted" },
  };
  const { label, cls } = map[status];
  return <span className={`text-xs px-2 py-0.5 rounded ${cls}`}>{label}</span>;
}

// max-sm:* — 모바일(<640px) 터치 타깃 ~40px 확보. 데스크톱 테이블 밀도는 유지.
const btnPrimary =
  "px-2.5 py-1 max-sm:py-2.5 max-sm:px-3.5 text-xs bg-primary hover:bg-primary-deep text-surface rounded disabled:opacity-50";
const btnSecondary =
  "px-2.5 py-1 max-sm:py-2.5 max-sm:px-3.5 text-xs bg-card border border-border-strong hover:bg-surface-alt text-ink-soft rounded disabled:opacity-50";
const btnDanger =
  "px-2.5 py-1 max-sm:py-2.5 max-sm:px-3.5 text-xs bg-danger-soft border border-danger/30 hover:bg-danger-soft/70 text-danger rounded disabled:opacity-50 transition-colors";
