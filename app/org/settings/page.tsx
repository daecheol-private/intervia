"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * 법인 설정 — 법인 단위 정책을 org_admin / system_admin 이 관리.
 * 회사 주소, 스캔 PDF AI OCR 허용 등. (이전에는 계정 설정에 있던 항목을 이리로 이동)
 */
type Org = {
  id: number | null;
  name?: string;
  emailDomain?: string | null;
  officeAddress?: string | null;
  officeAddressDetail?: string | null;
  allowScanOcr?: boolean;
};

export default function OrgSettingsPage() {
  const [org, setOrg] = useState<Org | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [addr, setAddr] = useState("");
  const [detail, setDetail] = useState("");
  const [addrBusy, setAddrBusy] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "error" | "success"; text: string } | null>(
    null
  );

  const load = async () => {
    const [orgRes, statusRes] = await Promise.all([
      fetch("/api/orgs/me"),
      fetch("/api/auth/status"),
    ]);
    if (orgRes.ok) {
      const o = (await orgRes.json()) as Org;
      setOrg(o);
      setAddr(o.officeAddress ?? "");
      setDetail(o.officeAddressDetail ?? "");
    }
    if (statusRes.ok) {
      const s = await statusRes.json();
      setRole(s.user?.role ?? null);
    }
    setLoaded(true);
  };

  useEffect(() => {
    void load();
  }, []);

  const canEdit = role === "org_admin" || role === "system_admin";

  const saveAddr = async () => {
    setAddrBusy(true);
    setMsg(null);
    const r = await fetch("/api/orgs/me/address", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        officeAddress: addr.trim() || null,
        officeAddressDetail: detail.trim() || null,
      }),
    });
    setAddrBusy(false);
    if (!r.ok) {
      setMsg({ type: "error", text: await r.text() });
      return;
    }
    setOrg((o) =>
      o
        ? {
            ...o,
            officeAddress: addr.trim() || null,
            officeAddressDetail: detail.trim() || null,
          }
        : o
    );
    setMsg({ type: "success", text: "회사 주소가 저장되었습니다." });
  };

  const toggleOcr = async (next: boolean) => {
    setOcrBusy(true);
    setMsg(null);
    const r = await fetch("/api/orgs/me/scan-ocr", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allowScanOcr: next }),
    });
    setOcrBusy(false);
    if (!r.ok) {
      setMsg({ type: "error", text: await r.text() });
      return;
    }
    setOrg((o) => (o ? { ...o, allowScanOcr: next } : o));
    setMsg({
      type: "success",
      text: next
        ? "스캔 PDF AI OCR 을 허용했습니다."
        : "스캔 PDF AI OCR 을 비활성화했습니다.",
    });
  };

  return (
    <main className="max-w-3xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-6">
        <Link href="/" className="text-xs text-slate-500 hover:underline">
          ← 대시보드
        </Link>
        <h1 className="text-xl font-semibold text-slate-800 mt-1">법인 설정</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          법인 전체에 적용되는 정책입니다. 법인 관리자만 변경할 수 있습니다.
        </p>
      </div>

      {!loaded ? (
        <p className="text-sm text-slate-500">불러오는 중...</p>
      ) : !canEdit ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-800">
            법인 관리자만 볼 수 있는 페이지입니다
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            법인 설정 변경 권한이 없습니다. 법인 관리자에게 문의하세요.
          </p>
        </div>
      ) : !org || !org.id ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <p className="text-sm text-slate-500">소속된 법인이 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* 법인 정보 + 회사 주소 */}
          <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
              법인 정보
            </h2>
            <div className="space-y-2 text-sm">
              <Row label="법인명" value={org.name ?? "-"} />
              {org.emailDomain && (
                <Row label="이메일 도메인" value={org.emailDomain} />
              )}
            </div>

            <div className="pt-4 mt-4 border-t border-slate-100 space-y-2">
              <label className="text-sm font-medium text-slate-700">
                회사 주소
              </label>
              <input
                value={addr}
                onChange={(e) => setAddr(e.target.value)}
                placeholder="예: 서울시 강남구 테헤란로 123"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <input
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                placeholder="상세 (호수·층 등, 선택)"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-[11px] text-slate-500">
                주소는 같은 법인 모든 멤버에게 공유되며, 오프라인 면접 일정
                메일에 자동으로 포함됩니다.
              </p>
              <div className="pt-1">
                <button
                  onClick={saveAddr}
                  disabled={addrBusy}
                  className="px-3 py-1.5 rounded-md bg-primary hover:bg-primary-deep text-white text-sm font-medium disabled:opacity-50"
                >
                  {addrBusy ? "저장 중..." : "주소 저장"}
                </button>
              </div>
            </div>
          </section>

          {/* 스캔 PDF AI OCR */}
          <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-700">
                  스캔 PDF 이력서 AI OCR
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  글자가 이미지로 들어간 스캔 이력서를 평가할 수 있게 합니다.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={!!org.allowScanOcr}
                disabled={ocrBusy}
                onClick={() => toggleOcr(!org.allowScanOcr)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                  org.allowScanOcr ? "bg-primary" : "bg-slate-300"
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                    org.allowScanOcr ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mt-3 leading-relaxed">
              ⚠️ 켜면 스캔 이력서의 <b>마스킹 전 원본</b>이 AI 처리 수탁자(Vertex
              AI 서울 리전)로 전송됩니다. 일반 이력서의 “로컬 마스킹 후 전송”
              원칙과 달라지므로, <b>개인정보 처리방침·후보자 동의 범위를 먼저
              정비</b>한 뒤 켜세요. 데이터는 국내(서울 리전)에 머물러 국외이전은
              발생하지 않으며, 모든 OCR 전송은 감사 로그에 기록됩니다. 꺼두면
              스캔 이력서는 평가되지 않고 재업로드 안내만 표시됩니다.
            </p>
          </section>

          {msg && (
            <div
              className={`text-xs rounded-lg px-3 py-2 ${
                msg.type === "error"
                  ? "text-danger bg-danger-soft border border-danger/30"
                  : "text-primary-deep bg-primary-soft border border-primary/30"
              }`}
            >
              {msg.text}
            </div>
          )}
        </div>
      )}
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-800 text-right">{value}</span>
    </div>
  );
}
