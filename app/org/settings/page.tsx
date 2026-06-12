"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { CultureFitProfile, QualItem } from "@/lib/prompts";

/**
 * 법인 설정 — 법인 단위 정책을 org_admin / system_admin 이 관리.
 * 회사 주소, 스캔 PDF AI OCR 허용, 컬처핏 프로필 등.
 */
type Org = {
  id: number | null;
  name?: string;
  emailDomain?: string | null;
  bizRegistrationNo?: string | null;
  officeAddress?: string | null;
  officeAddressDetail?: string | null;
  allowScanOcr?: boolean;
  cultureFitProfile?: CultureFitProfile | null;
};

const QUAL_KEYS = [
  "selfIntro",
  "motivation",
  "interpersonal",
  "strengthWeakness",
  "lifeExperience",
  "futureAmbition",
] as const;

type QualKey = (typeof QUAL_KEYS)[number];

// 저장 결과 메시지를 누른 버튼 옆에 표시하기 위한 섹션 구분
type SaveSection = "biz" | "addr" | "ocr" | "cf";
type SaveMsgState = {
  section: SaveSection;
  type: "error" | "success";
  text: string;
} | null;

const QUAL_LABELS: Record<QualKey, string> = {
  selfIntro: "자기소개서",
  motivation: "지원동기",
  interpersonal: "대인관계",
  strengthWeakness: "장점과 단점",
  lifeExperience: "학창시절/사회생활",
  futureAmbition: "입사후 포부",
};

function qualItem(
  enabled: boolean,
  weight: QualItem["weight"],
  guide: string
): QualItem {
  return { enabled, weight, guide };
}

// 미설정 법인의 초기 기본값 — "저장" 을 눌러야 평가에 반영됨
function defaultProfile(): CultureFitProfile {
  return {
    idealTalent:
      "자기주도적으로 문제를 정의하고 실행까지 책임지며, 동료와 협력해 함께 성장하는 인재",
    qualitativeItems: {
      selfIntro: qualItem(
        true,
        "medium",
        "핵심 경험이 직무와 연결되는지, 구체적인 사례 중심으로 서술했는지"
      ),
      motivation: qualItem(
        true,
        "high",
        "회사·직무에 대한 이해도와 지원 이유의 진정성·구체성"
      ),
      interpersonal: qualItem(
        true,
        "medium",
        "협업·갈등 상황에서의 소통 방식과 해결 경험"
      ),
      strengthWeakness: qualItem(
        true,
        "medium",
        "단점을 스스로 인지하고 보완하려는 노력이 있는지"
      ),
      lifeExperience: qualItem(
        false,
        "medium",
        "성실함과 꾸준함을 보여주는 경험이 있는지"
      ),
      futureAmbition: qualItem(
        true,
        "medium",
        "포부가 직무·회사 방향과 맞고 실현 가능한 계획인지"
      ),
    },
  };
}

export default function OrgSettingsPage() {
  const [org, setOrg] = useState<Org | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [addr, setAddr] = useState("");
  const [detail, setDetail] = useState("");
  const [bizNo, setBizNo] = useState("");
  const [addrBusy, setAddrBusy] = useState(false);
  const [bizBusy, setBizBusy] = useState(false);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [msg, setMsg] = useState<SaveMsgState>(null);

  // 컬처핏 로컬 상태
  const [cfProfile, setCfProfile] = useState<CultureFitProfile>(defaultProfile());
  const [cfBusy, setCfBusy] = useState(false);

  const load = async () => {
    const [orgRes, statusRes, cfRes] = await Promise.all([
      fetch("/api/orgs/me"),
      fetch("/api/auth/status"),
      fetch("/api/orgs/me/culture-fit"),
    ]);
    if (orgRes.ok) {
      const o = (await orgRes.json()) as Org;
      setOrg(o);
      setAddr(o.officeAddress ?? "");
      setDetail(o.officeAddressDetail ?? "");
      setBizNo(o.bizRegistrationNo ?? "");
    }
    if (statusRes.ok) {
      const s = await statusRes.json();
      setRole(s.user?.role ?? null);
    }
    if (cfRes.ok) {
      const { cultureFitProfile } = (await cfRes.json()) as {
        cultureFitProfile: CultureFitProfile | null;
      };
      if (cultureFitProfile) setCfProfile(cultureFitProfile);
    }
    setLoaded(true);
    // 본문이 fetch 후에 렌더되므로 브라우저 기본 앵커 스크롤이 동작하지 않음 — 직접 이동
    if (window.location.hash === "#culture-fit") {
      requestAnimationFrame(() =>
        document.getElementById("culture-fit")?.scrollIntoView({ behavior: "smooth" })
      );
    }
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
      setMsg({ section: "addr", type: "error", text: await r.text() });
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
    setMsg({ section: "addr", type: "success", text: "회사 주소가 저장되었습니다." });
  };

  const saveBizNo = async () => {
    setBizBusy(true);
    setMsg(null);
    const r = await fetch("/api/orgs/me/biz", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bizRegistrationNo: bizNo.trim() || null }),
    });
    setBizBusy(false);
    if (!r.ok) {
      setMsg({ section: "biz", type: "error", text: await r.text() });
      return;
    }
    const d = (await r.json()) as { bizRegistrationNo: string | null };
    setBizNo(d.bizRegistrationNo ?? "");
    setOrg((o) => (o ? { ...o, bizRegistrationNo: d.bizRegistrationNo } : o));
    setMsg({ section: "biz", type: "success", text: "사업자등록번호가 저장되었습니다." });
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
      setMsg({ section: "ocr", type: "error", text: await r.text() });
      return;
    }
    setOrg((o) => (o ? { ...o, allowScanOcr: next } : o));
    setMsg({
      section: "ocr",
      type: "success",
      text: next
        ? "스캔 PDF AI OCR 을 허용했습니다."
        : "스캔 PDF AI OCR 을 비활성화했습니다.",
    });
  };

  const saveCultureFit = async () => {
    setCfBusy(true);
    setMsg(null);
    // traitProfile 은 공고 단위로 이동 — 법인 JSON 의 레거시 값은 저장 시 제거
    const { traitProfile: _legacy, ...payload } = cfProfile;
    const r = await fetch("/api/orgs/me/culture-fit", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cultureFitProfile: payload }),
    });
    setCfBusy(false);
    if (!r.ok) {
      setMsg({ section: "cf", type: "error", text: await r.text() });
      return;
    }
    setMsg({ section: "cf", type: "success", text: "컬처핏 설정이 저장되었습니다." });
  };

  const updateQualItem = (key: QualKey, patch: Partial<QualItem>) => {
    setCfProfile((prev) => ({
      ...prev,
      qualitativeItems: {
        ...prev.qualitativeItems,
        [key]: { ...prev.qualitativeItems[key], ...patch },
      },
    }));
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
                사업자등록번호
              </label>
              <div className="flex gap-2">
                <input
                  value={bizNo}
                  onChange={(e) => setBizNo(e.target.value)}
                  placeholder="000-00-00000 (선택)"
                  className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <button
                  onClick={saveBizNo}
                  disabled={bizBusy}
                  className="shrink-0 px-3 py-1.5 rounded-md bg-primary hover:bg-primary-deep text-white text-sm font-medium disabled:opacity-50"
                >
                  {bizBusy ? "저장 중..." : "저장"}
                </button>
              </div>
              <SaveMsg msg={msg} section="biz" />
              <p className="text-[11px] text-slate-500">
                가입에는 필요하지 않습니다. 세금계산서 발행 등 정산에 필요할 때
                입력하세요. 다른 법인이 사용 중인 번호는 등록할 수 없습니다.
              </p>
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
                <SaveMsg msg={msg} section="addr" />
              </div>
            </div>
          </section>

          {/* 컬처핏 & 정성 평가 설정 — 대시보드 첫 실행 가이드 1단계가 #culture-fit 으로 진입 */}
          <section
            id="culture-fit"
            className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm scroll-mt-6"
          >
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
              컬처핏 &amp; 정성 평가 설정
            </h2>
            <p className="text-[11px] text-slate-500 mb-4 leading-relaxed">
              AI 이력서 평가와 면접 질문 생성에 자동 반영됩니다. 직무 공고(JD)와는
              별개로, 법인 전반의 인재 선호 기준을 지정합니다. 기본값이 채워져
              있으니 내용을 확인하고 저장하세요. 언제든지 수정할 수 있습니다.
            </p>

            {/* 선호 인재상 */}
            <div className="space-y-1.5 mb-5">
              <label className="text-sm font-medium text-slate-700">
                선호 인재상
              </label>
              <textarea
                value={cfProfile.idealTalent}
                onChange={(e) =>
                  setCfProfile((p) => ({ ...p, idealTalent: e.target.value }))
                }
                disabled={!canEdit}
                rows={3}
                placeholder="예: 자기주도적으로 문제를 정의하고 실행까지 책임지는 인재"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none disabled:bg-slate-50 disabled:text-slate-400"
              />
            </div>

            {/* 정성 평가 항목 6종 */}
            <div className="space-y-1 mb-5">
              <p className="text-sm font-medium text-slate-700 mb-2">
                중점 정성 평가 항목
              </p>
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                {QUAL_KEYS.map((key) => {
                  const item = cfProfile.qualitativeItems[key];
                  return (
                    <div key={key} className="p-3 bg-white">
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          id={`qual-${key}`}
                          checked={item.enabled}
                          disabled={!canEdit}
                          onChange={(e) =>
                            updateQualItem(key, { enabled: e.target.checked })
                          }
                          className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                        />
                        <label
                          htmlFor={`qual-${key}`}
                          className="text-sm font-medium text-slate-700 select-none cursor-pointer"
                        >
                          {QUAL_LABELS[key]}
                        </label>
                      </div>

                      {item.enabled && (
                        <div className="mt-2.5 ml-7 space-y-2">
                          {/* 비중 선택 */}
                          <div className="flex items-center gap-3">
                            <span className="text-[11px] text-slate-500 w-8 shrink-0">
                              비중
                            </span>
                            <div className="flex gap-2">
                              {(
                                [
                                  ["low", "낮음"],
                                  ["medium", "보통"],
                                  ["high", "높음"],
                                ] as const
                              ).map(([val, label]) => (
                                <label
                                  key={val}
                                  className="flex items-center gap-1 cursor-pointer"
                                >
                                  <input
                                    type="radio"
                                    name={`weight-${key}`}
                                    value={val}
                                    checked={item.weight === val}
                                    disabled={!canEdit}
                                    onChange={() =>
                                      updateQualItem(key, { weight: val })
                                    }
                                    className="h-3.5 w-3.5 text-primary focus:ring-primary"
                                  />
                                  <span className="text-xs text-slate-600">
                                    {label}
                                  </span>
                                </label>
                              ))}
                            </div>
                          </div>

                          {/* 평가 가이드 */}
                          <div className="flex items-start gap-3">
                            <span className="text-[11px] text-slate-500 w-8 shrink-0 mt-1.5">
                              가이드
                            </span>
                            <input
                              type="text"
                              value={item.guide}
                              disabled={!canEdit}
                              onChange={(e) =>
                                updateQualItem(key, { guide: e.target.value })
                              }
                              placeholder="AI 에게 줄 평가 힌트 (선택)"
                              className="flex-1 border border-slate-300 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-slate-50 disabled:text-slate-400"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 인성검사 선호 특성은 공고 단위로 이동 (직무마다 검증 특성이 다름) — 안내만 */}
            <p className="text-[11px] text-slate-500 mb-5 leading-relaxed">
              💡 AI 면접 인성검사의 <strong>선호 특성</strong>은 직무마다 달라
              각 <strong>공고의 등록/수정 화면</strong>에서 설정합니다. 이
              컬처핏 설정이 저장되어 있어야 인성검사가 출제됩니다.
            </p>

            {canEdit && (
              <>
                <button
                  onClick={saveCultureFit}
                  disabled={cfBusy}
                  className="px-4 py-2 rounded-md bg-primary hover:bg-primary-deep text-white text-sm font-medium disabled:opacity-50"
                >
                  {cfBusy ? "저장 중..." : "컬처핏 설정 저장"}
                </button>
                <SaveMsg msg={msg} section="cf" />
              </>
            )}
          </section>

          {/* 외부 연동 — 메일 서버 / 화상 면접 */}
          <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
              외부 연동
            </h2>
            <p className="text-[11px] text-slate-500 mb-3">
              필요할 때만 설정하세요. 미설정 시 Intervia 기본값으로 동작합니다.
            </p>
            <div className="divide-y divide-slate-100">
              <Link
                href="/org/smtp"
                className="flex items-center justify-between gap-3 py-3 group"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800">
                    메일 서버 (SMTP)
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    자사 도메인으로 면접 안내·합불 통보 메일을 발송합니다.
                  </p>
                </div>
                <span className="shrink-0 text-slate-400 group-hover:text-primary transition-colors">
                  →
                </span>
              </Link>
              <Link
                href="/org/zoom"
                className="flex items-center justify-between gap-3 py-3 group"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800">
                    화상 면접 (Zoom)
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    1차 면접 일정이 확정되면 Zoom 회의를 자동으로 생성합니다.
                  </p>
                </div>
                <span className="shrink-0 text-slate-400 group-hover:text-primary transition-colors">
                  →
                </span>
              </Link>
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
            <SaveMsg msg={msg} section="ocr" />
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mt-3 leading-relaxed">
              ⚠️ 켜면 스캔 이력서의 <b>마스킹 전 원본</b>이 AI 처리 수탁자(Vertex
              AI 서울 리전)로 전송됩니다. 일반 이력서의 "로컬 마스킹 후 전송"
              원칙과 달라지므로, <b>개인정보 처리방침·후보자 동의 범위를 먼저
              정비</b>한 뒤 켜세요. 데이터는 국내(서울 리전)에 머물러 국외이전은
              발생하지 않으며, 모든 OCR 전송은 감사 로그에 기록됩니다. 꺼두면
              스캔 이력서는 평가되지 않고 재업로드 안내만 표시됩니다.
            </p>
          </section>
        </div>
      )}
    </main>
  );
}

function SaveMsg({ msg, section }: { msg: SaveMsgState; section: SaveSection }) {
  if (!msg || msg.section !== section) return null;
  return (
    <div
      className={`text-xs rounded-lg px-3 py-2 mt-2 ${
        msg.type === "error"
          ? "text-danger bg-danger-soft border border-danger/30"
          : "text-primary-deep bg-primary-soft border border-primary/30"
      }`}
    >
      {msg.text}
    </div>
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
