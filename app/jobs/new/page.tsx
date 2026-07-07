"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import Link from "next/link";
import { Sparkles, Link2, Loader2, Info } from "lucide-react";
import { DesktopOnlyNotice } from "@/app/components/DesktopOnlyNotice";
import { PasswordInput } from "@/app/components/PasswordInput";
import { confirmDialog } from "@/app/components/Dialog";
import { TraitProfileSelector } from "@/app/components/TraitProfileSelector";
import {
  DEFAULT_TRAIT_PROFILE,
  traitProfileFromKeys,
  type TraitProfile,
} from "@/lib/personality";
import { getEmailDomain, isValidEmail } from "@/lib/email-domain";

export default function NewJobPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  // "지원링크 생성"은 링크(토큰)만 발급한다 — 공고가 만들어지는 게 아니다.
  // 저장할 때 '공고 생성'(정식)이든 '임시공고'(드래프트)든 이 토큰이 그 공고에 붙는다.
  const [applyToken, setApplyToken] = useState<string | null>(null);
  const [applyUrl, setApplyUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState({
    title: "",
    position: "",
    level: "3~5년차 (중급)",
    employmentType: "정규직",
    responsibilities: "",
    requirements: "",
    idealProfile: "",
    evaluationFocus: "",
    // 면접관 톤 선택 UI는 제거 — 모든 공고를 "친절한" 톤으로 고정 (API 계약 유지용으로 값만 전송)
    tone: "친절한" as "친절한" | "중립적인" | "엄격한",
    interviewDurationMinutes: 10,
    password: "",
    recruitingContactEmail: "",
    traitProfile: { ...DEFAULT_TRAIT_PROFILE } as TraitProfile,
  });

  // 채용 담당자 이메일 기본값 = 로그인 사용자 이메일(공고에 공개될 §37의2 연락처).
  // 같은 회사 도메인으로만 변경 가능 — 도메인은 안내·검증에 사용.
  const [myDomain, setMyDomain] = useState<string | null>(null);
  useEffect(() => {
    void fetch("/api/auth/status")
      .then((r) => r.json())
      .then((d) => {
        const email = d?.user?.email as string | undefined;
        if (!email) return;
        setMyDomain(getEmailDomain(email));
        setForm((f) =>
          f.recruitingContactEmail ? f : { ...f, recruitingContactEmail: email }
        );
      })
      .catch(() => {});
  }, []);

  // URL 임포트 상태
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importErr, setImportErr] = useState("");
  const [importInfo, setImportInfo] = useState<string | null>(null);

  const importFromUrl = async () => {
    setImportErr("");
    setImportInfo(null);
    if (!importUrl.trim()) {
      setImportErr("URL을 입력하세요.");
      return;
    }
    setImporting(true);
    const r = await fetch("/api/jobs/import-from-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: importUrl.trim() }),
    });
    setImporting(false);
    if (!r.ok) {
      setImportErr((await r.text()) || "가져오기 실패");
      return;
    }
    const d = (await r.json()) as {
      title: string;
      position: string;
      level: string;
      employmentType: string;
      responsibilities: string;
      requirements: string;
      idealProfile: string;
      preferredTraits: string[];
      confidence: number;
      meta: { usedImageFallback: boolean; imageCount: number; siteHint?: string };
    };
    // 불러오기 할 때마다 추출 필드를 새 값으로 전체 교체.
    // 추출 안 된 필드는 빈 값/기본값으로 초기화 (이전 공고 내용 잔류 방지).
    const LEVELS = [
      "신입 (0년)",
      "1~2년차 (주니어)",
      "3~5년차 (중급)",
      "6~9년차 (시니어)",
      "10년 이상 (리드)",
    ];
    const EMPLOYMENT = ["정규직", "계약직", "인턴", "프리랜서"];
    setForm((f) => ({
      ...f,
      title: d.title,
      position: d.position,
      // 자유 텍스트로 추출되면 select 옵션에 없어 드롭다운이 깨지므로 기본값 유지
      level: LEVELS.includes(d.level) ? d.level : "3~5년차 (중급)",
      employmentType: EMPLOYMENT.includes(d.employmentType)
        ? d.employmentType
        : "정규직",
      responsibilities: d.responsibilities,
      requirements: d.requirements,
      idealProfile: d.idealProfile,
      // 직무 분석으로 추천된 선호 특성을 미리 선택 (없으면 전 특성 medium 으로 초기화)
      traitProfile: traitProfileFromKeys(d.preferredTraits ?? []),
    }));
    const bits = [
      `${d.meta.siteHint ?? "외부 사이트"}에서 추출`,
      `신뢰도 ${(d.confidence * 100).toFixed(0)}%`,
    ];
    if (d.meta.usedImageFallback) bits.push(`이미지 ${d.meta.imageCount}장 분석`);
    if ((d.preferredTraits?.length ?? 0) > 0)
      bits.push(`선호 특성 ${d.preferredTraits.length}개 자동 선택`);
    setImportInfo(`✓ 자동 채움 완료 — ${bits.join(" · ")}. 내용 확인 후 수정/저장하세요.`);
  };

  // 추측 불가능한 지원 토큰을 클라이언트에서 발급 (서버 apply_token unique 가 최종 보증).
  const genApplyToken = () => {
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    const b64 = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return "ap_" + b64;
  };

  // "지원링크 생성" — 링크(토큰)만 발급해 보여준다. 공고가 만들어지는 게 아니다.
  // 저장 시('공고 생성' 또는 '임시공고') 이 토큰이 그 공고에 붙어 링크가 동작한다.
  const generateApplyLink = async () => {
    if (applyToken) return; // 이미 발급됨
    const ok = await confirmDialog(
      "지원 링크를 생성합니다.\n\n" +
        "이 링크를 사람인 등 채용사이트의 ‘홈페이지 지원’에 붙여넣으면 지원자가 직접 이력서를 올립니다.\n\n" +
        "채용사이트에 아직 공고를 올리지 않았다면, 지금은 ‘임시공고’로 저장해 두고 나중에 내용을 채우거나 채용사이트 URL로 불러와 수정·정식 등록할 수 있습니다.\n\n" +
        "공고 내용으로 AI 평가 지표가 만들어지므로, 상세히 적을수록 평가 품질이 올라갑니다.",
      { title: "지원링크 생성", confirmText: "지원링크 생성", tone: "info" }
    );
    if (!ok) return;
    const token = genApplyToken();
    setApplyToken(token);
    setApplyUrl(`${window.location.origin}/apply/${token}`);
  };

  const copyLink = async () => {
    if (!applyUrl) return;
    try {
      await navigator.clipboard.writeText(applyUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      alert("복사 실패 — 링크를 직접 선택해 복사해 주세요.");
    }
  };

  // "공고 생성" — 정식 공고로 등록(과금·평가). 발급한 지원 링크가 있으면 이 공고에 함께 붙는다.
  const submit = async () => {
    if (!form.title || !form.position || !form.responsibilities || !form.requirements) {
      alert("필수 항목을 입력하세요.");
      return;
    }
    const contactEmail = form.recruitingContactEmail.trim();
    if (!contactEmail) {
      alert("채용 담당자 이메일을 입력하세요.");
      return;
    }
    if (!isValidEmail(contactEmail)) {
      alert("채용 담당자 이메일 형식이 올바르지 않습니다.");
      return;
    }
    if (myDomain && getEmailDomain(contactEmail) !== myDomain) {
      alert(`채용 담당자 이메일은 회사 도메인(@${myDomain})만 사용할 수 있습니다.`);
      return;
    }
    if (form.password && !/^\d{4}$/.test(form.password)) {
      alert("비밀번호는 4자리 숫자여야 합니다.");
      return;
    }
    setSaving(true);
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, applyToken }),
    });
    if (!res.ok) {
      const text = await res.text();
      let msg = text;
      try {
        msg = JSON.parse(text).message || text;
      } catch {}
      alert("저장 실패: " + msg);
      setSaving(false);
      return;
    }
    const job = await res.json();
    router.push(`/jobs/${job.id}`);
  };

  // "임시공고" — 드래프트로 저장(미과금). 페르소나가 없어 들어온 이력서는 보관만 하고 평가하지 않는다.
  // 발급한 지원 링크가 있으면 이 공고에 함께 붙는다. 나중에 수정 화면에서 정식 등록 가능.
  const saveDraft = async () => {
    setSaving(true);
    const res = await fetch("/api/jobs/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, applyToken }),
    });
    if (!res.ok) {
      alert("임시저장 실패: " + (await res.text()));
      setSaving(false);
      return;
    }
    const { id } = await res.json();
    router.push(`/jobs/${id}`);
  };

  return (
    <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      <Link
        href="/"
        className="text-sm text-ink-muted hover:text-ink transition-colors"
      >
        ← 대시보드
      </Link>

      {/* 모바일: 공고 등록은 데스크톱 전용 — 안내만 노출 */}
      <div className="sm:hidden mt-4">
        <DesktopOnlyNotice
          title="공고 등록은 PC에서"
          description="공고 등록은 입력 항목이 많아 PC(데스크톱)에서 진행해 주세요. 모바일에서는 등록된 공고의 현황 확인과 후보자 단계·합불 변경을 할 수 있습니다."
        />
      </div>

      {/* 데스크톱: 공고 등록 폼 (모바일 숨김) */}
      <div className="hidden sm:block">
      <h1 className="text-2xl font-bold mt-3 mb-1">새 공고 등록</h1>
      <p className="text-sm text-ink-muted mb-6">
        등록된 정보는 면접관 페르소나 생성에 사용됩니다.
      </p>

      <div data-tour="apply-link-new">
      {applyUrl ? (
        <div className="bg-warning-soft border border-warning/40 rounded-2xl p-4 mb-5">
          <p className="text-sm font-semibold text-warning">
            🔗 지원 링크가 발급되었습니다
          </p>
          <p className="mt-1 text-xs text-warning leading-relaxed">
            이 링크를 사람인·잡코리아 등 공고의 “홈페이지 지원”에 붙여넣으세요. 아직 저장 전이라
            <b> 저장해야 링크가 동작</b>합니다 — 내용을 채워 <b>“공고 생성”</b>(정식)하거나, 채용사이트에
            아직 공고가 없으면 <b>“임시공고”</b>로 저장해 두고 나중에 수정·정식 등록하면 됩니다. (어느
            쪽으로 저장하든 이 링크가 그 공고에 연결됩니다.)
          </p>
          <div className="mt-2 flex items-center gap-2">
            <input
              readOnly
              value={applyUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded-lg border border-warning/40 bg-card px-3 py-1.5 text-xs text-ink-soft"
            />
            <button
              type="button"
              onClick={copyLink}
              className="shrink-0 rounded-lg bg-warning px-3 py-1.5 text-xs font-semibold text-white hover:bg-warning"
            >
              {copied ? "복사됨 ✓" : "복사"}
            </button>
          </div>
        </div>
      ) : (
        <div className="mb-3">
          <button
            type="button"
            onClick={generateApplyLink}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-strong bg-card px-3 py-2 text-sm font-medium text-ink-soft hover:bg-surface-alt disabled:opacity-50"
          >
            <Link2 className="w-4 h-4" /> 지원링크 생성
          </button>
          <p className="mt-1 text-[11px] text-ink-muted">
            채용사이트에 붙여넣을 지원 링크가 필요할 때. 링크만 먼저 발급되고, 저장 시 그 공고에 연결됩니다.
          </p>
        </div>
      )}
      </div>

      <div
        data-tour="job-import-url"
        className="bg-primary-soft/40 border border-primary/20 rounded-2xl p-4 mb-5"
      >
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-primary-deep">
            기존 공고 URL로 자동 채우기
          </h2>
        </div>
        <p className="text-xs text-ink-soft mb-3">
          사람인·잡코리아·원티드 등 채용 사이트 URL을 붙여넣으면 본문(이미지 포함)을 분석해 아래 필드를 채워줍니다.
        </p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
            <input
              className="w-full border border-border-strong rounded-lg pl-9 pr-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              placeholder="https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=..."
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !importing && importFromUrl()}
              disabled={importing}
            />
          </div>
          <button
            type="button"
            onClick={importFromUrl}
            disabled={importing || !importUrl.trim()}
            className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep disabled:opacity-50 text-surface text-sm font-medium whitespace-nowrap inline-flex items-center gap-1.5"
          >
            {importing && <Loader2 className="w-4 h-4 animate-spin" />}
            {importing ? "분석 중..." : "가져오기"}
          </button>
        </div>
        {importErr && (
          <div className="mt-2 text-xs text-danger bg-danger-soft border border-danger/40 rounded-lg px-3 py-2">
            {importErr}
          </div>
        )}
        {importInfo && (
          <div className="mt-2 text-xs text-primary-deep bg-primary-soft border border-primary/30 rounded-lg px-3 py-2">
            {importInfo}
          </div>
        )}
      </div>

      <div className="flex gap-3 bg-surface-alt border border-border-default rounded-2xl p-4 mb-5">
        <Info className="w-4 h-4 text-ink-muted shrink-0 mt-0.5" />
        <div className="text-xs text-ink-soft leading-relaxed">
          <p className="font-semibold text-ink">
            여러 직군을 함께 뽑는다면 공고를 직군별로 따로 등록하세요.
          </p>
          <p className="mt-1">
            예를 들어 <b>연구·영업·보안</b>을 한 번에 채용하더라도, 직군마다 공고를
            나눠 만드는 것을 권장합니다. 공고 하나당 그 직군에 맞는{" "}
            <b>AI 면접관 페르소나(캐릭터)</b>가 생성되고 <b>평가 기준</b>도 그 직군에
            맞춰지기 때문입니다. 한 공고에 여러 직군을 섞으면 면접 질문과 합·불 평가가
            어느 직군에도 정확하지 않게 됩니다.
          </p>
        </div>
      </div>

      <div className="bg-card border border-border-default rounded-2xl p-6 space-y-5 shadow-sm">
        <Field label="공고 제목" required>
          <Input
            placeholder="예: 백엔드 개발자 채용"
            value={form.title}
            onChange={(v) => setForm({ ...form, title: v })}
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="직무" required>
            <Input
              placeholder="백엔드 개발자"
              value={form.position}
              onChange={(v) => setForm({ ...form, position: v })}
            />
          </Field>
          <Field label="직급/연차">
            <Select
              value={form.level}
              onChange={(v) => setForm({ ...form, level: v })}
              options={[
                "신입 (0년)",
                "1~2년차 (주니어)",
                "3~5년차 (중급)",
                "6~9년차 (시니어)",
                "10년 이상 (리드)",
              ]}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="근무형태">
            <Select
              value={form.employmentType}
              onChange={(v) => setForm({ ...form, employmentType: v })}
              options={["정규직", "계약직", "인턴", "프리랜서"]}
            />
          </Field>
          <Field label="예상 면접 시간">
            <Select
              value={String(form.interviewDurationMinutes)}
              onChange={(v) =>
                setForm({ ...form, interviewDurationMinutes: Number(v) })
              }
              options={[
                { value: "10", label: "10분 · 3~5개 질문" },
                { value: "20", label: "20분 · 6~8개 질문" },
                { value: "30", label: "30분 · 9~12개 질문" },
              ]}
            />
          </Field>
        </div>

        <Field
          label="담당 업무"
          required
          hint="구체적으로 적을수록 AI 면접관의 질문 품질이 올라갑니다. 10자 이상 권장."
        >
          <Textarea
            placeholder={`예) - 신규 보안 솔루션의 백엔드 API 설계·개발\n      - 이기종 보안 시스템(SOAR, VPN, NFVO) 연동 모듈 구현\n      - 운영 자동화 스크립트 작성 (Python)`}
            value={form.responsibilities}
            onChange={(v) => setForm({ ...form, responsibilities: v })}
          />
          <LengthHint value={form.responsibilities} min={10} />
        </Field>

        <Field
          label="자격 요건 / 세부 내용"
          required
          hint="필수 기술·경험·학력을 명확하게. 너무 짧으면 AI가 적합도 평가에 어려움을 겪습니다."
        >
          <Textarea
            placeholder={`예) - Python 백엔드 개발 경력 3년 이상\n      - REST API 설계 및 운영 경험\n      - Docker / Linux 환경 익숙`}
            value={form.requirements}
            onChange={(v) => setForm({ ...form, requirements: v })}
          />
          <LengthHint value={form.requirements} min={10} />
        </Field>

        <Field label="우대사항">
          <Textarea
            placeholder="예: 자율적으로 문제를 정의하고 풀어가는 사람, 팀과 적극적으로 소통하는 사람, 새 기술 학습에 열린 태도 등"
            value={form.idealProfile}
            onChange={(v) => setForm({ ...form, idealProfile: v })}
          />
          <p className="text-xs text-ink-muted mt-1">
            AI 서류 평가 및 면접 평가 시 함께 반영됩니다. 차별 금지 항목(성별·나이·출신지·종교 등)은 적지 마세요.
          </p>
        </Field>

        <Field
          dataTour="eval-focus"
          label="🤖 AI 평가 중점 사항 (HR 전용)"
          hint="후보자에게는 공개되지 않습니다. AI 서류·면접 평가에서 가중치를 두고 싶은 포인트를 자유롭게 작성하세요. 예: 보안 솔루션 연동 경력 최우선, Python 미사용 후보 감점, SOAR 경험자 가산점."
        >
          <Textarea
            placeholder={`예) 보안 도메인(SOAR/SIEM) 실무 경험을 다른 어떤 기술보다 우선적으로 평가해 주세요.\n     - Python 백엔드 경험 부족하면 감점\n     - 이기종 보안 시스템 연동 경험은 강력 가산`}
            value={form.evaluationFocus}
            onChange={(v) => setForm({ ...form, evaluationFocus: v })}
          />
          <p className="text-[11px] text-warning mt-1">
            ⚠️ 차별 금지 항목(성별·나이·출신지·학교·종교·결혼 여부 등)은
            기재해도 AI 가 무시하며, 분쟁 발생 시 입력자가 책임을 집니다.
          </p>
        </Field>

        <Field
          label="AI 면접 인성검사 — 선호 특성"
          hint="합불 점수에 반영되지 않는 참고용입니다 — 후보자가 면접 시작 전 응답하는 강제선택형 사전 문항이며, 결과는 면접 꼬리질문 설계에만 쓰입니다. 여기서 고른 특성(최대 3개)은 점수 가중치가 아니라 검증 우선순위로, 심화 문항이 추가되고 면접에서 행동 사례로 확인됩니다."
        >
          <TraitProfileSelector
            value={form.traitProfile}
            onChange={(traitProfile) => setForm({ ...form, traitProfile })}
          />
        </Field>

        <Field
          label="채용 담당자 이메일"
          required
          hint="지원자가 AI 평가 거부·이의제기 시 연락할 곳입니다. 공고 안내문에 표시되어 지원자에게 공개됩니다. 회사 이메일 도메인만 사용할 수 있어요."
        >
          <Input
            placeholder="예: recruiting@회사도메인.com"
            value={form.recruitingContactEmail}
            onChange={(v) => setForm({ ...form, recruitingContactEmail: v })}
          />
          {myDomain && (
            <p className="text-[11px] text-ink-muted mt-1">
              회사 도메인 <span className="font-mono">@{myDomain}</span> · 기본값은
              본인 이메일이며 같은 도메인으로 변경할 수 있습니다.
            </p>
          )}
        </Field>

        <Field dataTour="job-password" label="공고 비밀번호 (선택)">
          <PasswordInput
            className="w-full border border-border-strong rounded-lg px-3 py-2 text-sm font-mono tracking-widest placeholder:font-sans placeholder:tracking-normal focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            placeholder="4자리 숫자 (예: 1234)"
            autoComplete="new-password"
            inputMode="numeric"
            maxLength={4}
            value={form.password}
            onChange={(v) =>
              setForm({
                ...form,
                password: v.replace(/\D/g, "").slice(0, 4),
              })
            }
          />
          <p className="text-xs text-ink-muted mt-1">
            설정하면 상세 페이지 진입 시 비밀번호를 입력해야 합니다.
          </p>
        </Field>
      </div>

      <div className="flex gap-2 mt-6 justify-end">
        <button
          onClick={() => router.back()}
          className="px-4 py-2 rounded-lg border border-border-strong hover:bg-surface-alt text-sm"
        >
          취소
        </button>
        <button
          onClick={saveDraft}
          disabled={saving}
          title="평가지표(페르소나) 없이 임시로 저장 — 들어온 이력서는 보관만 하고 평가하지 않습니다. 나중에 정식 등록할 수 있습니다."
          className="px-4 py-2 rounded-lg border border-border-strong bg-card hover:bg-surface-alt text-ink-soft text-sm font-medium disabled:opacity-50"
        >
          {saving ? "저장 중..." : "임시공고"}
        </button>
        <button
          onClick={submit}
          disabled={saving}
          className="px-5 py-2 rounded-lg bg-primary hover:bg-primary-deep text-surface text-sm font-medium disabled:opacity-50 shadow-sm"
        >
          {saving ? "저장 중..." : "공고 생성"}
        </button>
      </div>
      </div>
    </main>
  );
}

function Field({
  label,
  required,
  hint,
  children,
  dataTour,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
  /** 가이드(투어) 스포트라이트 앵커. 없으면 속성 자체가 렌더되지 않음. */
  dataTour?: string;
}) {
  return (
    <div data-tour={dataTour}>
      <label className="block text-sm font-medium text-ink-soft mb-1.5">
        {label}
        {required && <span className="text-danger ml-1">*</span>}
      </label>
      {hint && (
        <p className="text-[11px] text-ink-muted mb-1.5 leading-relaxed">
          {hint}
        </p>
      )}
      {children}
    </div>
  );
}

function LengthHint({ value, min }: { value: string; min: number }) {
  const len = value.trim().length;
  if (len === 0) {
    return (
      <p className="text-[11px] text-ink-muted mt-1 tabular-nums">
        0 / {min}자 권장
      </p>
    );
  }
  const ok = len >= min;
  return (
    <p
      className={`text-[11px] mt-1 tabular-nums ${
        ok ? "text-primary" : "text-warning"
      }`}
    >
      {ok ? "👍 충분합니다" : "⚠️ 더 구체적으로 작성해 주세요"} ·{" "}
      <span className="font-mono">
        {len} / {min}자
      </span>
    </p>
  );
}

function Input({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      className="w-full border border-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function Textarea({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <textarea
      className="w-full border border-border-strong rounded-lg px-3 py-2 text-sm h-24 resize-y focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

type Option = string | { value: string; label: string };

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Option[];
}) {
  return (
    <select
      className="w-full border border-border-strong rounded-lg px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => {
        const v = typeof o === "string" ? o : o.value;
        const l = typeof o === "string" ? o : o.label;
        return (
          <option key={v} value={v}>
            {l}
          </option>
        );
      })}
    </select>
  );
}
