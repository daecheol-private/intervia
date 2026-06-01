"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useStepUpFetch } from "@/app/components/StepUpModal";

type Org = {
  id: number;
  name: string;
  bizRegistrationNo: string | null;
  emailDomain: string | null;
  createdAt: string;
  suspendedAt: string | null;
  suspendedReason: string | null;
  verificationStatus:
    | "dart_matched"
    | "verified"
    | "pending_review"
    | "rejected";
  verifiedAt: string | null;
  verificationNote: string | null;
  balance: number;
  memberCount: number;
  jobCount: number;
};

export default function AdminOrgsPage() {
  const [rows, setRows] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [grantId, setGrantId] = useState<number | null>(null);
  const [grantAmount, setGrantAmount] = useState("");
  const [refundId, setRefundId] = useState<number | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editBizno, setEditBizno] = useState("");
  const [editDomain, setEditDomain] = useState("");
  const [busy, setBusy] = useState(false);

  const startEdit = (o: Org) => {
    setEditId(o.id);
    setEditName(o.name);
    setEditBizno(o.bizRegistrationNo ?? "");
    setEditDomain(o.emailDomain ?? "");
    setGrantId(null);
    setRefundId(null);
  };

  const suspend = async (orgId: number, orgName: string) => {
    const reason = prompt(
      `'${orgName}' 법인을 정지합니다.\n\n사유 (5자 이상, 멤버에게 노출됨):`
    );
    if (reason === null) return;
    if (reason.trim().length < 5) {
      setErr("정지 사유는 5자 이상 입력하세요.");
      return;
    }
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/admin/orgs/${orgId}/suspend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason.trim() }),
    });
    setBusy(false);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    void load();
  };

  const resume = async (orgId: number, orgName: string) => {
    if (!confirm(`'${orgName}' 법인 정지를 해제합니다. 계속하시겠습니까?`)) return;
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/admin/orgs/${orgId}/suspend`, {
      method: "DELETE",
    });
    setBusy(false);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    void load();
  };

  const saveEdit = async (orgId: number) => {
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/admin/orgs/${orgId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editName,
        bizRegistrationNo: editBizno || null,
        emailDomain: editDomain || null,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    setEditId(null);
    void load();
  };

  const load = async () => {
    setLoading(true);
    const res = await fetch("/api/admin/orgs");
    setLoading(false);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    setRows(await res.json());
  };

  useEffect(() => {
    void load();
  }, []);

  const { ensureFetch, modal: stepUpModal } = useStepUpFetch();

  const unmapDomain = async (orgId: number, orgName: string, domain: string) => {
    const reason = prompt(
      `${orgName} 의 도메인 매핑 '${domain}' 을 해제합니다.\n` +
        `이후 이 도메인은 자동매칭에 사용되지 않으며 같은 도메인으로 다른 법인 등록이 가능합니다.\n\n` +
        `사유 (5자 이상, 감사 로그):\n예) SaaS 메일 호스팅 확인됨 / 사칭 신고 / 공용도메인 추가`,
      "SaaS·공용 메일 도메인으로 확인되어 해제"
    );
    if (reason === null) return;
    if (reason.trim().length < 5) {
      setErr("사유는 5자 이상");
      return;
    }
    let res: Response;
    try {
      res = await ensureFetch(
        `/api/admin/orgs/${orgId}/unmap-domain`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: reason.trim() }),
        },
        `${orgName} 의 이메일 도메인(${domain}) 매핑을 해제합니다.`
      );
    } catch {
      return;
    }
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    void load();
  };

  const verifyOrg = async (
    orgId: number,
    action: "approve" | "reject",
    note: string
  ) => {
    let res: Response;
    try {
      res = await ensureFetch(
        `/api/admin/orgs/${orgId}/verify`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, note }),
        },
        action === "approve"
          ? "이 법인을 검증된 정상 법인으로 승인합니다."
          : "이 법인을 사칭·부정 법인으로 거절합니다. 멤버 합류·로그인이 차단됩니다."
      );
    } catch {
      return;
    }
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    void load();
  };

  const grant = async (orgId: number) => {
    const delta = parseInt(grantAmount, 10);
    if (!Number.isInteger(delta) || delta === 0) {
      setErr("0이 아닌 정수를 입력하세요.");
      return;
    }
    setBusy(true);
    setErr("");
    let res: Response;
    try {
      res = await ensureFetch(
        `/api/admin/orgs/${orgId}/grant-tokens`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ delta, memo: "관리자 수동 충전" }),
        },
        `토큰 ${delta > 0 ? "충전" : "회수"} ${Math.abs(delta)} 토큰을 진행합니다.`
      );
    } catch {
      setBusy(false);
      return; // 사용자 취소
    }
    setBusy(false);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    setGrantId(null);
    setGrantAmount("");
    void load();
  };

  const refund = async (orgId: number) => {
    const delta = parseInt(refundAmount, 10);
    if (!Number.isInteger(delta) || delta === 0) {
      setErr("0이 아닌 정수를 입력하세요. (양수=적립, 음수=회수)");
      return;
    }
    if (refundReason.trim().length < 5) {
      setErr("환불 사유는 5자 이상 입력하세요.");
      return;
    }
    setBusy(true);
    setErr("");
    const res = await fetch(`/api/admin/orgs/${orgId}/refund`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delta, reason: refundReason.trim() }),
    });
    setBusy(false);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    setRefundId(null);
    setRefundAmount("");
    setRefundReason("");
    void load();
  };

  return (
    <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      {stepUpModal}
      <div className="mb-6">
        <Link href="/" className="text-xs text-slate-500 hover:underline">
          ← 대시보드
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-2">법인 관리</h1>
        <p className="text-sm text-slate-500 mt-1">
          전체 법인 {rows.length}개. 토큰 충전은 (추후) 단가 페이지에서.
        </p>
      </div>

      {err && (
        <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2 mb-4">
          {err}
        </div>
      )}

      {/* 모바일: 카드 리스트 (충전/조정·환불·정지·재개 — 급한 운영 처리용) */}
      <div className="sm:hidden space-y-3">
        {loading && (
          <div className="text-slate-400 text-sm py-6 text-center">불러오는 중...</div>
        )}
        {!loading && rows.length === 0 && (
          <div className="text-slate-400 text-sm py-6 text-center">법인이 없습니다.</div>
        )}
        {rows.map((o) => (
          <div
            key={o.id}
            className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium text-slate-900 flex items-center gap-2 flex-wrap">
                  <span className="break-keep">{o.name}</span>
                  {o.suspendedAt && (
                    <span
                      className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-200"
                      title={o.suspendedReason ?? "정지됨"}
                    >
                      정지
                    </span>
                  )}
                </div>
                <div className="mt-1.5">
                  <VerificationBadge org={o} onVerify={verifyOrg} />
                </div>
              </div>
              <div className="text-right shrink-0">
                <div
                  className={`font-mono text-lg leading-none ${o.balance < 0 ? "text-danger" : "text-slate-900"}`}
                >
                  {o.balance.toLocaleString()}
                </div>
                <div className="text-[11px] text-slate-400 mt-1">토큰 잔액</div>
              </div>
            </div>

            <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
              <span>멤버 {o.memberCount}</span>
              <span>공고 {o.jobCount}</span>
              {o.bizRegistrationNo && (
                <span className="font-mono">{o.bizRegistrationNo}</span>
              )}
              {o.emailDomain && <span>{o.emailDomain}</span>}
            </div>

            <div className="mt-3 pt-3 border-t border-slate-100">
              {grantId === o.id ? (
                <div className="flex flex-col gap-2">
                  <input
                    type="number"
                    inputMode="numeric"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-right font-mono"
                    placeholder="±수량 (예: 100 충전, -50 차감)"
                    value={grantAmount}
                    onChange={(e) => setGrantAmount(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => grant(o.id)}
                      disabled={busy}
                      className="flex-1 px-3 py-2 text-sm bg-primary hover:bg-primary-deep text-white rounded-lg disabled:opacity-50 font-medium"
                    >
                      적용
                    </button>
                    <button
                      onClick={() => {
                        setGrantId(null);
                        setGrantAmount("");
                      }}
                      className="px-4 py-2 text-sm bg-white border border-slate-300 hover:bg-slate-50 rounded-lg"
                    >
                      취소
                    </button>
                  </div>
                </div>
              ) : refundId === o.id ? (
                <div className="flex flex-col gap-2">
                  <input
                    type="number"
                    inputMode="numeric"
                    className="w-full border border-amber-300 rounded-lg px-3 py-2 text-sm text-right font-mono"
                    placeholder="±수량"
                    value={refundAmount}
                    onChange={(e) => setRefundAmount(e.target.value)}
                  />
                  <input
                    type="text"
                    className="w-full border border-amber-300 rounded-lg px-3 py-2 text-sm"
                    placeholder="환불 사유 (5자+, 필수)"
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => refund(o.id)}
                      disabled={busy}
                      className="flex-1 px-3 py-2 text-sm bg-amber-600 hover:bg-amber-700 text-white rounded-lg disabled:opacity-50 font-medium"
                    >
                      환불
                    </button>
                    <button
                      onClick={() => {
                        setRefundId(null);
                        setRefundAmount("");
                        setRefundReason("");
                      }}
                      className="px-4 py-2 text-sm bg-white border border-slate-300 hover:bg-slate-50 rounded-lg"
                    >
                      취소
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setGrantId(o.id)}
                    className="px-3 py-2 text-sm bg-primary hover:bg-primary-deep text-white rounded-lg font-medium"
                  >
                    충전 / 조정
                  </button>
                  <button
                    onClick={() => setRefundId(o.id)}
                    className="px-3 py-2 text-sm bg-white border border-amber-300 hover:bg-amber-50 text-amber-700 rounded-lg"
                  >
                    환불
                  </button>
                  {o.suspendedAt ? (
                    <button
                      onClick={() => resume(o.id, o.name)}
                      disabled={busy}
                      className="px-3 py-2 text-sm bg-white border border-primary/40 hover:bg-primary-soft text-primary-deep rounded-lg disabled:opacity-50"
                    >
                      재개
                    </button>
                  ) : (
                    <button
                      onClick={() => suspend(o.id, o.name)}
                      disabled={busy}
                      className="px-3 py-2 text-sm bg-white border border-rose-300 hover:bg-rose-50 text-rose-700 rounded-lg disabled:opacity-50"
                    >
                      정지
                    </button>
                  )}
                </div>
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
              <th className="text-left px-4 py-3 font-medium">법인명</th>
              <th className="text-left px-4 py-3 font-medium">검증</th>
              <th className="text-left px-4 py-3 font-medium">사업자번호</th>
              <th className="text-left px-4 py-3 font-medium">도메인</th>
              <th className="text-right px-4 py-3 font-medium">멤버</th>
              <th className="text-right px-4 py-3 font-medium">공고</th>
              <th className="text-right px-4 py-3 font-medium">잔액</th>
              <th className="text-left px-4 py-3 font-medium">생성일</th>
              <th className="text-right px-4 py-3 font-medium">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr>
                <td className="px-4 py-6 text-slate-400" colSpan={8}>
                  불러오는 중...
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-slate-400" colSpan={8}>
                  법인이 없습니다.
                </td>
              </tr>
            )}
            {rows.map((o) => (
              <tr key={o.id}>
                <td className="px-4 py-3 font-medium text-slate-900">
                  {editId === o.id ? (
                    <input
                      className="w-full border border-primary/40 rounded px-2 py-1 text-sm"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                  ) : (
                    <>
                      {o.name}
                      {o.suspendedAt && (
                        <span
                          className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-200"
                          title={o.suspendedReason ?? "정지됨"}
                        >
                          정지
                        </span>
                      )}
                    </>
                  )}
                </td>
                <td className="px-4 py-3 text-xs">
                  <VerificationBadge org={o} onVerify={verifyOrg} />
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {editId === o.id ? (
                    <input
                      className="w-32 border border-primary/40 rounded px-2 py-1 text-sm font-mono"
                      placeholder="000-00-00000"
                      value={editBizno}
                      onChange={(e) => setEditBizno(e.target.value)}
                    />
                  ) : (
                    o.bizRegistrationNo || "-"
                  )}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {editId === o.id ? (
                    <input
                      className="w-40 border border-primary/40 rounded px-2 py-1 text-sm"
                      placeholder="example.com"
                      value={editDomain}
                      onChange={(e) => setEditDomain(e.target.value)}
                    />
                  ) : o.emailDomain ? (
                    <div className="flex items-center gap-1.5">
                      <span>{o.emailDomain}</span>
                      <button
                        title="SaaS·공용 메일이면 매핑 해제 — 자동매칭 비활성화"
                        onClick={() => unmapDomain(o.id, o.name, o.emailDomain!)}
                        className="text-[10px] text-amber-700 hover:text-amber-900 underline"
                      >
                        해제
                      </button>
                    </div>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-4 py-3 text-right">{o.memberCount}</td>
                <td className="px-4 py-3 text-right">{o.jobCount}</td>
                <td className={`px-4 py-3 text-right font-mono ${o.balance < 0 ? "text-danger" : ""}`}>
                  {o.balance.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {new Date(o.createdAt).toLocaleDateString("ko-KR")}
                </td>
                <td className="px-4 py-3 text-right">
                  {editId === o.id ? (
                    <div className="flex gap-1 justify-end">
                      <button
                        onClick={() => saveEdit(o.id)}
                        disabled={busy}
                        className="px-2 py-1 text-xs bg-primary hover:bg-primary-deep text-white rounded disabled:opacity-50"
                      >
                        저장
                      </button>
                      <button
                        onClick={() => setEditId(null)}
                        className="px-2 py-1 text-xs bg-white border border-slate-300 hover:bg-slate-50 rounded"
                      >
                        취소
                      </button>
                    </div>
                  ) : grantId === o.id ? (
                    <div className="flex gap-1 justify-end">
                      <input
                        type="number"
                        className="w-24 border border-slate-300 rounded px-2 py-1 text-xs text-right font-mono"
                        placeholder="±수량"
                        value={grantAmount}
                        onChange={(e) => setGrantAmount(e.target.value)}
                      />
                      <button
                        onClick={() => grant(o.id)}
                        disabled={busy}
                        className="px-2 py-1 text-xs bg-primary hover:bg-primary-deep text-white rounded disabled:opacity-50"
                      >
                        적용
                      </button>
                      <button
                        onClick={() => {
                          setGrantId(null);
                          setGrantAmount("");
                        }}
                        className="px-2 py-1 text-xs bg-white border border-slate-300 hover:bg-slate-50 rounded"
                      >
                        취소
                      </button>
                    </div>
                  ) : refundId === o.id ? (
                    <div className="flex flex-col gap-1 items-end">
                      <div className="flex gap-1">
                        <input
                          type="number"
                          className="w-24 border border-amber-300 rounded px-2 py-1 text-xs text-right font-mono"
                          placeholder="±수량"
                          value={refundAmount}
                          onChange={(e) => setRefundAmount(e.target.value)}
                        />
                        <button
                          onClick={() => refund(o.id)}
                          disabled={busy}
                          className="px-2 py-1 text-xs bg-amber-600 hover:bg-amber-700 text-white rounded disabled:opacity-50"
                        >
                          환불
                        </button>
                        <button
                          onClick={() => {
                            setRefundId(null);
                            setRefundAmount("");
                            setRefundReason("");
                          }}
                          className="px-2 py-1 text-xs bg-white border border-slate-300 hover:bg-slate-50 rounded"
                        >
                          취소
                        </button>
                      </div>
                      <input
                        type="text"
                        className="w-64 border border-amber-300 rounded px-2 py-1 text-xs"
                        placeholder="환불 사유 (5자+, 필수)"
                        value={refundReason}
                        onChange={(e) => setRefundReason(e.target.value)}
                      />
                    </div>
                  ) : (
                    <div className="flex gap-1 justify-end flex-wrap">
                      <button
                        onClick={() => startEdit(o)}
                        className="px-2 py-1 text-xs bg-white border border-primary/40 hover:bg-primary-soft text-primary-deep rounded"
                      >
                        수정
                      </button>
                      <Link
                        href={`/admin/orgs/${o.id}/transfer-admin`}
                        className="px-2 py-1 text-xs bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded"
                      >
                        관리자 이전
                      </Link>
                      <button
                        onClick={() => setGrantId(o.id)}
                        className="px-2 py-1 text-xs bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded"
                      >
                        충전/조정
                      </button>
                      <button
                        onClick={() => setRefundId(o.id)}
                        className="px-2 py-1 text-xs bg-white border border-amber-300 hover:bg-amber-50 text-amber-700 rounded"
                      >
                        환불
                      </button>
                      {o.suspendedAt ? (
                        <button
                          onClick={() => resume(o.id, o.name)}
                          disabled={busy}
                          className="px-2 py-1 text-xs bg-card border border-primary/40 hover:bg-primary-soft text-primary-deep rounded disabled:opacity-50 transition-colors"
                        >
                          재개
                        </button>
                      ) : (
                        <button
                          onClick={() => suspend(o.id, o.name)}
                          disabled={busy}
                          className="px-2 py-1 text-xs bg-white border border-rose-300 hover:bg-rose-50 text-rose-700 rounded disabled:opacity-50"
                        >
                          정지
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function VerificationBadge({
  org,
  onVerify,
}: {
  org: Org;
  onVerify: (orgId: number, action: "approve" | "reject", note: string) => void;
}) {
  const status = org.verificationStatus;
  if (status === "dart_matched") {
    return (
      <span
        className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200"
        title={org.verificationNote ?? "DART 자동 매칭"}
      >
        ✓ DART
      </span>
    );
  }
  if (status === "verified") {
    return (
      <span
        className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200"
        title={org.verificationNote ?? "운영자 수동 검증"}
      >
        ✓ 검증
      </span>
    );
  }
  if (status === "rejected") {
    return (
      <span
        className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 border border-rose-200"
        title={org.verificationNote ?? "거절"}
      >
        ✕ 거절
      </span>
    );
  }
  // pending_review
  return (
    <div className="flex flex-col gap-1 items-start">
      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
        ⏳ 검토 대기
      </span>
      <div className="flex gap-1 mt-0.5">
        <button
          onClick={() => {
            const note = prompt("승인 사유 (선택, 감사 로그 기록):", "");
            if (note === null) return;
            onVerify(org.id, "approve", note);
          }}
          className="px-1.5 py-0.5 text-[10px] bg-emerald-50 border border-emerald-300 hover:bg-emerald-100 text-emerald-700 rounded"
        >
          승인
        </button>
        <button
          onClick={() => {
            const note = prompt(
              "거절 사유 (필수, 감사 로그 기록):",
              "사칭 의심"
            );
            if (note === null || !note.trim()) return;
            onVerify(org.id, "reject", note);
          }}
          className="px-1.5 py-0.5 text-[10px] bg-rose-50 border border-rose-300 hover:bg-rose-100 text-rose-700 rounded"
        >
          거절
        </button>
      </div>
    </div>
  );
}
