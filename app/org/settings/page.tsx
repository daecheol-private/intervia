"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { CultureFitProfile, QualItem } from "@/lib/prompts";
import { textColorOn } from "@/lib/brand-color";
import {
  NCS_COMPETENCY_KEYS,
  NCS_COMPETENCY_LABELS,
  type CompetencyKey,
} from "@/lib/competencies";

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
  brandColor?: string | null;
  hasLogo?: boolean;
};

// 지원 페이지 포인트 컬러 프리셋 — 흰 배경 위 버튼으로 무난한 진한 톤만
const BRAND_PRESETS = [
  "#0f4c81",
  "#15803d",
  "#b91c1c",
  "#6d28d9",
  "#d97706",
  "#111827",
];

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
type SaveSection = "biz" | "addr" | "ocr" | "cf" | "brand";
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
    coreCompetencies: ["communication", "problemSolving", "interpersonal"],
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

  // 법인 브랜딩 로컬 상태 (지원 페이지·AI 면접 화면 공통)
  const [brandColor, setBrandColor] = useState("");
  const [hasLogo, setHasLogo] = useState(false);
  const [logoVer, setLogoVer] = useState(0); // 업로드 후 미리보기 캐시 무효화
  const [brandBusy, setBrandBusy] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);

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
      setBrandColor(o.brandColor ?? "");
      setHasLogo(!!o.hasLogo);
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

  const uploadLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ""; // 같은 파일 재선택 허용
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) {
      setMsg({
        section: "brand",
        type: "error",
        text: "로고는 최대 2MB 까지 업로드할 수 있습니다.",
      });
      return;
    }
    setLogoBusy(true);
    setMsg(null);
    const fd = new FormData();
    fd.append("file", f);
    const r = await fetch("/api/orgs/me/branding/logo", {
      method: "POST",
      body: fd,
    });
    setLogoBusy(false);
    if (!r.ok) {
      setMsg({ section: "brand", type: "error", text: await r.text() });
      return;
    }
    setHasLogo(true);
    setLogoVer((v) => v + 1);
    setMsg({ section: "brand", type: "success", text: "로고가 저장되었습니다." });
  };

  const removeLogo = async () => {
    setLogoBusy(true);
    setMsg(null);
    const r = await fetch("/api/orgs/me/branding/logo", { method: "DELETE" });
    setLogoBusy(false);
    if (!r.ok) {
      setMsg({ section: "brand", type: "error", text: await r.text() });
      return;
    }
    setHasLogo(false);
    setMsg({ section: "brand", type: "success", text: "로고를 제거했습니다." });
  };

  const saveBrand = async () => {
    setBrandBusy(true);
    setMsg(null);
    const r = await fetch("/api/orgs/me/branding", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brandColor: brandColor || null }),
    });
    setBrandBusy(false);
    if (!r.ok) {
      setMsg({ section: "brand", type: "error", text: await r.text() });
      return;
    }
    setMsg({
      section: "brand",
      type: "success",
      text: "포인트 컬러가 저장되었습니다.",
    });
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

  const toggleCompetency = (key: CompetencyKey) => {
    setCfProfile((prev) => {
      const current = prev.coreCompetencies ?? [];
      const has = current.includes(key);
      // NCS 표준 순서 유지 — 토글 후에도 일관된 순서로 보이게
      const nextSet = new Set(current);
      if (has) nextSet.delete(key);
      else nextSet.add(key);
      return {
        ...prev,
        coreCompetencies: NCS_COMPETENCY_KEYS.filter((k) => nextSet.has(k)),
      };
    });
  };

  return (
    <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink">법인 설정</h1>
        <p className="text-sm text-ink-soft mt-1">
          법인 전체에 적용되는 정책입니다. 법인 관리자만 변경할 수 있습니다.
        </p>
      </div>

      {!loaded ? (
        <p className="text-sm text-ink-muted">불러오는 중...</p>
      ) : !canEdit ? (
        <div className="bg-card border border-border-default rounded-2xl p-6 shadow-sm">
          <h2 className="text-base font-semibold text-ink">
            법인 관리자만 볼 수 있는 페이지입니다
          </h2>
          <p className="text-sm text-ink-muted mt-1">
            법인 설정 변경 권한이 없습니다. 법인 관리자에게 문의하세요.
          </p>
        </div>
      ) : !org || !org.id ? (
        <div className="bg-card border border-border-default rounded-2xl p-6 shadow-sm">
          <p className="text-sm text-ink-muted">소속된 법인이 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* 법인 정보 + 회사 주소 */}
          <section className="bg-card border border-border-default rounded-2xl p-6 shadow-sm">
            <h2 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-3">
              법인 정보
            </h2>
            <div className="space-y-2 text-sm">
              <Row label="법인명" value={org.name ?? "-"} />
              {org.emailDomain && (
                <Row label="이메일 도메인" value={org.emailDomain} />
              )}
            </div>

            <div className="pt-4 mt-4 border-t border-border-default space-y-2">
              <label className="text-sm font-medium text-ink-soft">
                사업자등록번호
              </label>
              <div className="flex gap-2">
                <input
                  value={bizNo}
                  onChange={(e) => setBizNo(e.target.value)}
                  placeholder="000-00-00000 (선택)"
                  className="flex-1 border border-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <button
                  onClick={saveBizNo}
                  disabled={bizBusy}
                  className="shrink-0 px-3 py-1.5 rounded-md bg-primary hover:bg-primary-deep text-surface text-sm font-medium disabled:opacity-50"
                >
                  {bizBusy ? "저장 중..." : "저장"}
                </button>
              </div>
              <SaveMsg msg={msg} section="biz" />
              <p className="text-[11px] text-ink-muted">
                가입에는 필요하지 않습니다. 세금계산서 발행 등 정산에 필요할 때
                입력하세요. 다른 법인이 사용 중인 번호는 등록할 수 없습니다.
              </p>
            </div>

            <div
              data-tour="cfg-address"
              className="pt-4 mt-4 border-t border-border-default space-y-2"
            >
              <label className="text-sm font-medium text-ink-soft">
                회사 주소
              </label>
              <input
                value={addr}
                onChange={(e) => setAddr(e.target.value)}
                placeholder="예: 서울시 강남구 테헤란로 123"
                className="w-full border border-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <input
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                placeholder="상세 (호수·층 등, 선택)"
                className="w-full border border-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-[11px] text-ink-muted">
                주소는 같은 법인 모든 멤버에게 공유되며, 오프라인 면접 일정
                메일에 자동으로 포함됩니다.
              </p>
              <div className="pt-1">
                <button
                  onClick={saveAddr}
                  disabled={addrBusy}
                  className="px-3 py-1.5 rounded-md bg-primary hover:bg-primary-deep text-surface text-sm font-medium disabled:opacity-50"
                >
                  {addrBusy ? "저장 중..." : "주소 저장"}
                </button>
                <SaveMsg msg={msg} section="addr" />
              </div>
            </div>
          </section>

          {/* 법인 브랜딩 — 지원 페이지·AI 면접으로 유입된 지원자에게 자사 채용임을 보여준다 */}
          <section data-tour="cfg-branding" className="bg-card border border-border-default rounded-2xl p-6 shadow-sm">
            <h2 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-1">
              법인 브랜딩
            </h2>
            <p className="text-[11px] text-ink-muted mb-4 leading-relaxed">
              공개 지원 페이지와 AI 면접 화면에 회사 로고와 포인트 컬러를
              적용합니다. 사람인 등 외부 공고에서 넘어온 지원자가 우리 회사
              채용임을 바로 알아볼 수 있습니다.
            </p>

            {/* 로고 */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-ink-soft">
                회사 로고
              </label>
              {hasLogo && (
                <div className="flex items-center gap-3">
                  <img
                    src={`/api/orgs/me/branding/logo?v=${logoVer}`}
                    alt="회사 로고"
                    className="h-12 max-w-[180px] object-contain rounded-lg border border-border-default bg-surface p-1.5"
                  />
                  <button
                    onClick={removeLogo}
                    disabled={logoBusy}
                    className="text-xs text-ink-muted hover:text-danger disabled:opacity-50"
                  >
                    제거
                  </button>
                </div>
              )}
              <input
                type="file"
                accept=".png,.jpg,.jpeg,.webp"
                onChange={uploadLogo}
                disabled={logoBusy}
                className="block w-full text-sm text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-primary-soft file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary hover:file:bg-primary-soft disabled:opacity-50"
              />
              <p className="text-[11px] text-ink-muted">
                PNG · JPG · WebP, 최대 2MB. 가로형 로고를 권장합니다.
              </p>
            </div>

            {/* 포인트 컬러 */}
            <div className="pt-4 mt-4 border-t border-border-default space-y-2">
              <label className="text-sm font-medium text-ink-soft">
                포인트 컬러
              </label>
              <div className="flex items-center gap-2 flex-wrap">
                {BRAND_PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setBrandColor(c)}
                    aria-label={`포인트 컬러 ${c}`}
                    className={`h-7 w-7 rounded-full border transition-shadow ${
                      brandColor === c
                        ? "ring-2 ring-primary ring-offset-2"
                        : "border-border-default hover:ring-1 hover:ring-border-strong"
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
                <input
                  type="color"
                  value={brandColor || "#1c3478"}
                  onChange={(e) => setBrandColor(e.target.value)}
                  aria-label="직접 선택"
                  className="h-8 w-10 cursor-pointer rounded-lg border border-border-default bg-card p-0.5"
                />
                {brandColor && (
                  <button
                    type="button"
                    onClick={() => setBrandColor("")}
                    className="text-xs text-ink-muted hover:text-danger"
                  >
                    기본색으로
                  </button>
                )}
              </div>
              <p className="text-[11px] text-ink-muted">
                지원 페이지·AI 면접 화면의 헤더와 주요 버튼에 적용됩니다. 글자
                색은 가독성이 보장되도록 자동으로 정해집니다.
              </p>
            </div>

            {/* 미리보기 */}
            <div className="pt-4 mt-4 border-t border-border-default">
              <p className="text-[11px] text-ink-muted mb-2">미리보기 (지원 페이지 예시)</p>
              <div className="rounded-xl bg-surface-alt p-4">
                <div className="mx-auto max-w-xs rounded-xl bg-card border border-border-default shadow-sm overflow-hidden">
                  {/* 헤더 밴드 — 실제 지원 페이지와 동일 구조 */}
                  <div
                    className="p-4"
                    style={
                      brandColor ? { backgroundColor: brandColor } : undefined
                    }
                  >
                    {hasLogo && (
                      <img
                        src={`/api/orgs/me/branding/logo?v=${logoVer}`}
                        alt=""
                        className="mb-2 max-h-8 max-w-[140px] object-contain"
                      />
                    )}
                    <p
                      className="text-xs font-medium text-primary"
                      style={
                        brandColor
                          ? { color: textColorOn(brandColor), opacity: 0.85 }
                          : undefined
                      }
                    >
                      {org.name}
                    </p>
                    <p
                      className="mt-0.5 text-sm font-semibold text-ink"
                      style={
                        brandColor
                          ? { color: textColorOn(brandColor) }
                          : undefined
                      }
                    >
                      채용 공고 제목
                    </p>
                  </div>
                  <div className="p-4 pt-3">
                    <div
                      className={`rounded-lg px-3 py-2 text-center text-xs font-semibold ${
                        brandColor ? "" : "bg-primary text-surface"
                      }`}
                      style={
                        brandColor
                          ? {
                              backgroundColor: brandColor,
                              color: textColorOn(brandColor),
                            }
                          : undefined
                      }
                    >
                      지원서 제출
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-4">
              <button
                onClick={saveBrand}
                disabled={brandBusy}
                className="px-3 py-1.5 rounded-md bg-primary hover:bg-primary-deep text-surface text-sm font-medium disabled:opacity-50"
              >
                {brandBusy ? "저장 중..." : "포인트 컬러 저장"}
              </button>
              <SaveMsg msg={msg} section="brand" />
            </div>
          </section>

          {/* 컬처핏 & 정성 평가 설정 — 대시보드 첫 실행 가이드 1단계가 #culture-fit 으로 진입 */}
          <section
            id="culture-fit"
            className="bg-card border border-border-default rounded-2xl p-6 shadow-sm scroll-mt-6"
          >
            <h2 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-1">
              컬처핏 &amp; 정성 평가 설정
            </h2>
            <p className="text-[11px] text-ink-muted mb-4 leading-relaxed">
              AI 이력서 평가와 면접 질문 생성에 자동 반영됩니다. 직무 공고(JD)와는
              별개로, 법인 전반의 인재 선호 기준을 지정합니다. 기본값이 채워져
              있으니 내용을 확인하고 저장하세요. 언제든지 수정할 수 있습니다.
            </p>

            {/* 선호 인재상 */}
            <div className="space-y-1.5 mb-5">
              <label className="text-sm font-medium text-ink-soft">
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
                className="w-full border border-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none disabled:bg-surface-alt disabled:text-ink-muted"
              />
            </div>

            {/* 정성 평가 항목 6종 */}
            <div className="space-y-1 mb-5">
              <p className="text-sm font-medium text-ink-soft mb-2">
                중점 정성 평가 항목
              </p>
              <div className="divide-y divide-border-default border border-border-default rounded-xl overflow-hidden">
                {QUAL_KEYS.map((key) => {
                  const item = cfProfile.qualitativeItems[key];
                  return (
                    <div key={key} className="p-3 bg-card">
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          id={`qual-${key}`}
                          checked={item.enabled}
                          disabled={!canEdit}
                          onChange={(e) =>
                            updateQualItem(key, { enabled: e.target.checked })
                          }
                          className="h-4 w-4 rounded border-border-strong text-primary focus:ring-primary"
                        />
                        <label
                          htmlFor={`qual-${key}`}
                          className="text-sm font-medium text-ink-soft select-none cursor-pointer"
                        >
                          {QUAL_LABELS[key]}
                        </label>
                      </div>

                      {item.enabled && (
                        <div className="mt-2.5 ml-7 space-y-2">
                          {/* 비중 선택 */}
                          <div className="flex items-center gap-3">
                            <span className="text-[11px] text-ink-muted w-8 shrink-0">
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
                                  <span className="text-xs text-ink-soft">
                                    {label}
                                  </span>
                                </label>
                              ))}
                            </div>
                          </div>

                          {/* 평가 가이드 */}
                          <div className="flex items-start gap-3">
                            <span className="text-[11px] text-ink-muted w-8 shrink-0 mt-1.5">
                              가이드
                            </span>
                            <textarea
                              value={item.guide}
                              disabled={!canEdit}
                              onChange={(e) =>
                                updateQualItem(key, { guide: e.target.value })
                              }
                              placeholder="AI 에게 줄 평가 힌트 (선택)"
                              rows={2}
                              className="flex-1 min-w-0 resize-y border border-border-strong rounded-md px-2.5 py-1.5 text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-surface-alt disabled:text-ink-muted"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 핵심 역량 (NCS 직업기초능력) — 표준 역량 어휘로 평가·리포트에 반영 */}
            <div className="space-y-2 mb-5">
              <p className="text-sm font-semibold text-ink">
                중시하는 핵심 역량{" "}
                <span className="text-xs font-normal text-ink-muted">
                  (NCS 직업기초능력 · 복수 선택)
                </span>
              </p>
              <p className="text-xs text-ink-soft leading-relaxed">
                선택한 역량은 AI 면접 평가에 표준 어휘로 반영되고, 면접 리포트에
                배지로 표시됩니다.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                {NCS_COMPETENCY_KEYS.map((key) => {
                  const meta = NCS_COMPETENCY_LABELS[key];
                  const selected = (cfProfile.coreCompetencies ?? []).includes(
                    key
                  );
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => canEdit && toggleCompetency(key)}
                      disabled={!canEdit}
                      title={meta.short}
                      aria-pressed={selected}
                      className={`px-3.5 py-2 rounded-full text-[13px] font-semibold border transition-colors disabled:cursor-not-allowed ${
                        selected
                          ? "border-primary bg-primary-soft text-primary-deep shadow-sm"
                          : "border-border-strong bg-card text-ink-soft hover:border-primary hover:text-primary-deep"
                      }`}
                    >
                      {selected && <span className="mr-1">✓</span>}
                      {meta.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 성향(Big Five)은 공고 단위 — 역량(NCS, 위)과 다른 축임을 명확히 안내 */}
            <p className="text-xs text-ink-soft mb-5 leading-relaxed">
              💡 위 <strong>역량</strong>(무엇을 잘하나)과 달리, 직무별{" "}
              <strong>성향</strong>(개방성·성실성 등 어떤 기질인가)은 AI 면접
              인성검사로 측정하며 직무마다 달라 각{" "}
              <strong>공고의 등록/수정 화면</strong>에서 설정합니다. 이 컬처핏
              설정이 저장되어 있어야 인성검사가 출제됩니다.
            </p>

            {canEdit && (
              <>
                <button
                  onClick={saveCultureFit}
                  disabled={cfBusy}
                  className="px-4 py-2 rounded-md bg-primary hover:bg-primary-deep text-surface text-sm font-medium disabled:opacity-50"
                >
                  {cfBusy ? "저장 중..." : "컬처핏 설정 저장"}
                </button>
                <SaveMsg msg={msg} section="cf" />
              </>
            )}
          </section>

          {/* 외부 연동 — 메일 서버 / 화상 면접 */}
          <section className="bg-card border border-border-default rounded-2xl p-6 shadow-sm">
            <h2 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-1">
              외부 연동
            </h2>
            <p className="text-[11px] text-ink-muted mb-3">
              필요할 때만 설정하세요. 미설정 시 Intervia 기본값으로 동작합니다.
            </p>
            <div className="divide-y divide-border-default">
              <Link
                href="/org/smtp"
                data-tour="cfg-smtp"
                className="flex items-center justify-between gap-3 py-3 group"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">
                    메일 서버 (SMTP)
                  </p>
                  <p className="text-[11px] text-ink-muted mt-0.5">
                    자사 도메인으로 면접 안내·합불 통보 메일을 발송합니다.
                  </p>
                </div>
                <span className="shrink-0 text-ink-muted group-hover:text-primary transition-colors">
                  →
                </span>
              </Link>
              <Link
                href="/org/zoom"
                data-tour="cfg-zoom"
                className="flex items-center justify-between gap-3 py-3 group"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">
                    화상 면접 (Zoom)
                  </p>
                  <p className="text-[11px] text-ink-muted mt-0.5">
                    1차 면접 일정이 확정되면 Zoom 회의를 자동으로 생성합니다.
                  </p>
                </div>
                <span className="shrink-0 text-ink-muted group-hover:text-primary transition-colors">
                  →
                </span>
              </Link>
            </div>
          </section>

          {/* 스캔 PDF AI OCR */}
          <section className="bg-card border border-border-default rounded-2xl p-6 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-ink-soft">
                  스캔 PDF 이력서 AI OCR
                </p>
                <p className="text-[11px] text-ink-muted mt-0.5">
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
                  org.allowScanOcr ? "bg-primary" : "bg-border-strong"
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-card shadow transition-transform ${
                    org.allowScanOcr ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
            <SaveMsg msg={msg} section="ocr" />
            <p className="text-[11px] text-warning bg-warning-soft border border-warning rounded-md px-3 py-2 mt-3 leading-relaxed">
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
      <span className="text-ink-muted">{label}</span>
      <span className="text-ink text-right">{value}</span>
    </div>
  );
}
