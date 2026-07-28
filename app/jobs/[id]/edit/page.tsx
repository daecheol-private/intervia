"use client";

import { useRouter, useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, Link2, Loader2, ExternalLink } from "lucide-react";
import { DesktopOnlyNotice } from "@/app/components/DesktopOnlyNotice";
import { PasswordInput } from "@/app/components/PasswordInput";
import { TraitProfileSelector } from "@/app/components/TraitProfileSelector";
import {
  DEFAULT_TRAIT_PROFILE,
  parseTraitProfile,
  traitProfileFromKeys,
  type TraitProfile,
} from "@/lib/personality";
import { getEmailDomain, isValidEmail } from "@/lib/email-domain";
import { sourceUrlLabel } from "@/lib/job-source";
import { formatKstDateTime } from "@/lib/utils";
import {
  careerInputsFrom,
  careerInputsToText,
  type CareerInputs,
} from "@/lib/career-level";
import { CareerRangeInput } from "@/app/components/CareerRangeInput";

type Form = {
  title: string;
  position: string;
  employmentType: string;
  responsibilities: string;
  requirements: string;
  idealProfile: string;
  evaluationFocus: string;
  tone: "친절한" | "중립적인" | "엄격한";
  interviewDurationMinutes: number;
  hasPassword: boolean;
  password: string; // 변경할 때만 입력 (빈문자열이면 유지/제거 토글)
  clearPassword: boolean;
  recruitingContactEmail: string;
  traitProfile: TraitProfile;
};

export default function EditJobPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [form, setForm] = useState<Form | null>(null);
  // 직급/연차 — 최소/최대 range 입력. 저장 시 careerInputsToText 로 직렬화해 level 로 전송.
  // 기존 공고의 구 버킷 라벨("3~5년차 (중급)")도 careerInputsFrom 이 range 로 해석한다.
  const [career, setCareer] = useState<CareerInputs>({
    any: true,
    min: "",
    max: "",
  });
  const [isDraft, setIsDraft] = useState(false);
  const [saving, setSaving] = useState(false);
  // 기존 공고 URL 자동 채우기 — 새 공고 등록과 동일 (임시공고 정식 전환 시 사람인 URL 로 내용 채우기 등).
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importErr, setImportErr] = useState("");
  const [importInfo, setImportInfo] = useState<string | null>(null);
  // 공고에 기록된 자동 채우기 출처 — 어디서 가져온 공고인지 확인 + "다시 불러오기" 용도.
  const [source, setSource] = useState<{ url: string; importedAt: string | null } | null>(null);
  // 이번 편집에서 임포트를 새로 했을 때만 저장 시 전송(출처·시각 갱신). null 이면 기존 값 유지.
  const [reimportedUrl, setReimportedUrl] = useState<string | null>(null);
  // 채용 담당자 이메일 기본값/도메인 검증용 — 로그인 사용자 이메일.
  const [myEmail, setMyEmail] = useState<string | null>(null);
  const myDomain = myEmail ? getEmailDomain(myEmail) : null;

  useEffect(() => {
    void (async () => {
      // 먼저 로그인 이메일을 받아 구버전(연락처 null) 공고의 기본값으로 쓴다.
      let me: string | null = null;
      try {
        const s = await fetch("/api/auth/status").then((r) => r.json());
        me = (s?.user?.email as string | undefined) ?? null;
        if (me) setMyEmail(me);
      } catch {
        /* 비치명적 */
      }
      const j = await fetch(`/api/jobs/${id}`).then((r) => r.json());
      setIsDraft(!!j.isDraft);
      setCareer(careerInputsFrom(j.level));
      if (j.sourceUrl) {
        setSource({ url: j.sourceUrl, importedAt: j.sourceImportedAt ?? null });
        // 입력칸에 미리 채워 둔다 — 원본이 바뀌었으면 그대로 "가져오기"만 누르면 된다.
        setImportUrl(j.sourceUrl);
      }
      setForm({
        title: j.title === "(작성 중인 임시 공고)" ? "" : j.title,
        position: j.position,
        // 임시공고는 빈 값일 수 있음 → 유효한 기본값으로 보정(빈 select 면 정식 전환이 막힘).
        employmentType: j.employmentType || "정규직",
        responsibilities: j.responsibilities,
        requirements: j.requirements,
        idealProfile: j.idealProfile ?? "",
        evaluationFocus: j.evaluationFocus ?? "",
        // 면접관 톤 선택 UI 제거 — 저장 시 "친절한"으로 통일 (API 계약 유지용으로 값만 전송)
        tone: "친절한",
        interviewDurationMinutes: j.interviewDurationMinutes ?? 20,
        hasPassword: !!j.hasPassword,
        password: "",
        clearPassword: false,
        recruitingContactEmail: j.recruitingContactEmail || me || "",
        // GET 응답은 DB 원본 JSON 문자열 — 파싱 실패·미설정은 전 특성 medium
        traitProfile:
          parseTraitProfile(j.traitProfile) ?? { ...DEFAULT_TRAIT_PROFILE },
      });
    })();
  }, [id]);

  // url 인자는 "다시 불러오기"용 — setImportUrl 반영을 기다리지 않고 바로 그 주소로 가져온다.
  const importFromUrl = async (url?: string) => {
    setImportErr("");
    setImportInfo(null);
    const target = (url ?? importUrl).trim();
    if (!target) {
      setImportErr("URL을 입력하세요.");
      return;
    }
    setImporting(true);
    const r = await fetch("/api/jobs/import-from-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: target }),
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
      meta: {
        usedImageFallback: boolean;
        imageCount: number;
        siteHint?: string;
        normalizedUrl?: string;
      };
    };
    // 서버가 정규화한 URL 을 출처로 기록(사람인 relay/view → view 등). 저장해야 반영된다.
    const src = d.meta.normalizedUrl || target;
    setReimportedUrl(src);
    setSource({ url: src, importedAt: null });
    const EMPLOYMENT = ["정규직", "계약직", "인턴", "프리랜서"];
    // 서버가 준 캐노니컬 텍스트("신입~10년" 등)를 range 입력값으로 역변환
    setCareer(careerInputsFrom(d.level));
    setForm((f) =>
      f
        ? {
            ...f,
            title: d.title,
            position: d.position,
            employmentType: EMPLOYMENT.includes(d.employmentType)
              ? d.employmentType
              : f.employmentType,
            responsibilities: d.responsibilities,
            requirements: d.requirements,
            idealProfile: d.idealProfile,
            traitProfile: traitProfileFromKeys(d.preferredTraits ?? []),
          }
        : f
    );
    const bits = [
      `${d.meta.siteHint ?? "외부 사이트"}에서 추출`,
      `신뢰도 ${(d.confidence * 100).toFixed(0)}%`,
    ];
    if (d.meta.usedImageFallback) bits.push(`이미지 ${d.meta.imageCount}장 분석`);
    setImportInfo(`✓ 자동 채움 완료 — ${bits.join(" · ")}. 내용 확인 후 저장하세요.`);
  };

  // asDraft=true → 임시공고로 저장(드래프트 유지). false → 정식 공고로 저장/등록.
  // 임시공고를 정식 등록하려면 필수 항목이 모두 채워져야 한다(없으면 계속 임시 상태로 남던 문제 방지).
  const save = async (asDraft: boolean) => {
    if (!form) return;
    if (!asDraft) {
      const missing =
        !form.title.trim() ||
        !form.position.trim() ||
        !form.responsibilities.trim() ||
        !form.requirements.trim();
      if (missing) {
        alert(
          "정식 공고로 등록하려면 제목·직무·담당 업무·자격 요건을 모두 입력해야 합니다.\n(아직 작성 중이면 ‘임시공고로 저장’을 눌러주세요.)"
        );
        return;
      }
    }
    if (form.password && !/^\d{4}$/.test(form.password)) {
      alert("비밀번호는 4자리 숫자여야 합니다.");
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
    setSaving(true);
    // password: 빈 문자열 + clearPassword=true → 잠금 해제, 4자리 → 변경, 그 외 → 유지
    const payload: Record<string, unknown> = {
      ...form,
      level: careerInputsToText(career),
    };
    // 이번 편집에서 URL 자동 채우기를 했을 때만 출처를 갱신(키가 없으면 서버가 기존 값 유지).
    if (reimportedUrl) payload.sourceUrl = reimportedUrl;
    if (form.clearPassword) payload.password = "";
    else if (!form.password) delete payload.password;
    delete payload.hasPassword;
    delete payload.clearPassword;
    // keepDraft=true 면 필수항목이 다 차도 정식 전환하지 않고 임시 유지(미과금).
    if (asDraft) payload.keepDraft = true;

    const res = await fetch(`/api/jobs/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (!res.ok) {
      alert("저장 실패: " + (await res.text()));
      return;
    }
    router.push(`/jobs/${id}`);
  };

  if (!form)
    return (
      <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8 text-ink-muted">
        불러오는 중...
      </main>
    );

  return (
    <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      <Link
        href={`/jobs/${id}`}
        className="text-sm text-ink-muted hover:text-ink"
      >
        ← 공고 상세
      </Link>

      {/* 모바일: 공고 수정은 데스크톱 전용 — 안내만 노출 */}
      <div className="sm:hidden mt-4">
        <DesktopOnlyNotice
          title="공고 수정은 PC에서"
          description="공고 수정은 PC(데스크톱)에서 진행해 주세요. 모바일에서는 공고 현황 확인과 후보자 단계·합불 변경을 할 수 있습니다."
        />
      </div>

      {/* 데스크톱: 공고 수정 폼 (모바일 숨김) */}
      <div className="hidden sm:block">
      <h1 className="text-2xl font-bold mt-3 mb-4">공고 수정</h1>

      <div className="bg-primary-soft/40 border border-primary/20 rounded-2xl p-4 mb-5">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-primary-deep">
            기존 공고 URL로 자동 채우기
          </h2>
        </div>
        <p className="text-xs text-ink-soft mb-3">
          사람인·잡코리아·원티드 등 채용 사이트 URL을 붙여넣으면 본문(이미지 포함)을 분석해 아래 필드를 채워줍니다. (기존 내용은 덮어쓰여요.)
        </p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
            <input
              className="w-full border border-border-strong rounded-lg pl-9 pr-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              placeholder="https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=..."
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !importing) void importFromUrl();
              }}
              disabled={importing}
            />
          </div>
          <button
            type="button"
            onClick={() => void importFromUrl()}
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
        {source && (
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-muted">
            <span className="font-medium text-ink-soft">이 공고의 원본</span>
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary-deep hover:underline break-all"
            >
              <ExternalLink className="w-3 h-3 shrink-0" />
              {sourceUrlLabel(source.url)}
            </a>
            <span>
              ·{" "}
              {reimportedUrl
                ? "방금 불러옴 (저장해야 기록됩니다)"
                : source.importedAt
                  ? `${formatKstDateTime(source.importedAt)} 불러옴`
                  : "불러온 시각 미기록"}
            </span>
            {!reimportedUrl && (
              <button
                type="button"
                onClick={() => {
                  setImportUrl(source.url);
                  void importFromUrl(source.url);
                }}
                disabled={importing}
                className="text-primary-deep font-medium hover:underline disabled:opacity-50"
              >
                다시 불러오기
              </button>
            )}
          </div>
        )}
      </div>

      <div className="bg-card border border-border-default rounded-2xl p-6 space-y-5 shadow-sm">
        <Field label="공고 제목" required>
          <input
            className={inputCls}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="직무" required>
            <input
              className={inputCls}
              value={form.position}
              onChange={(e) => setForm({ ...form, position: e.target.value })}
            />
          </Field>
          <Field label="직급/연차">
            <CareerRangeInput value={career} onChange={setCareer} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="근무형태">
            <select
              className={inputCls}
              value={form.employmentType}
              onChange={(e) =>
                setForm({ ...form, employmentType: e.target.value })
              }
            >
              <option>정규직</option>
              <option>계약직</option>
              <option>인턴</option>
              <option>프리랜서</option>
            </select>
          </Field>
          <Field label="예상 면접 시간">
            <select
              className={inputCls}
              value={form.interviewDurationMinutes}
              onChange={(e) =>
                setForm({
                  ...form,
                  interviewDurationMinutes: Number(e.target.value),
                })
              }
            >
              <option value={10}>10분 · 3~5개 질문</option>
              <option value={20}>20분 · 6~8개 질문</option>
              <option value={30}>30분 · 9~12개 질문</option>
            </select>
          </Field>
        </div>
        <Field label="담당 업무" required>
          <textarea
            className={inputCls + " h-24 resize-y"}
            value={form.responsibilities}
            onChange={(e) =>
              setForm({ ...form, responsibilities: e.target.value })
            }
          />
        </Field>
        <Field label="자격 요건" required>
          <textarea
            className={inputCls + " h-24 resize-y"}
            value={form.requirements}
            onChange={(e) =>
              setForm({ ...form, requirements: e.target.value })
            }
          />
        </Field>
        <Field label="우대사항">
          <textarea
            className={inputCls + " h-24 resize-y"}
            placeholder="AI 서류 평가 및 면접에 추가 컨텍스트로 반영됩니다. 차별 금지 항목은 적지 마세요."
            value={form.idealProfile}
            onChange={(e) =>
              setForm({ ...form, idealProfile: e.target.value })
            }
          />
        </Field>
        <Field label="🤖 AI 평가 중점 사항 (HR 전용)">
          <textarea
            className={inputCls + " h-28 resize-y"}
            placeholder={`후보자에게는 공개되지 않습니다. AI 평가 가중치를 직접 코멘트하세요.\n예) 보안 도메인 경력 최우선, Python 미사용 후보 감점`}
            value={form.evaluationFocus}
            onChange={(e) =>
              setForm({ ...form, evaluationFocus: e.target.value })
            }
          />
          <p className="text-[11px] text-warning mt-1">
            ⚠️ 차별 금지 항목(성별·나이·출신지·학교·종교·결혼 여부 등)은
            기재해도 AI 가 무시하며, 분쟁 발생 시 입력자가 책임을 집니다.
          </p>
        </Field>
        <Field label="AI 면접 인성검사 — 선호 특성">
          <p className="text-[11px] text-ink-muted mb-1.5 leading-relaxed">
            <strong className="text-ink-soft">
              합불 점수에 반영되지 않는 참고용
            </strong>
            입니다 — 후보자가 면접 시작 전 응답하는 강제선택형 사전 문항이며,
            결과는 면접 꼬리질문 설계에만 쓰입니다. 여기서 고른 특성(최대 3개)은
            점수 가중치가 아니라 검증 우선순위로, 심화 문항이 추가되고 면접에서
            행동 사례로 확인됩니다.
          </p>
          <TraitProfileSelector
            value={form.traitProfile}
            onChange={(traitProfile) => setForm({ ...form, traitProfile })}
          />
        </Field>

        <Field label="채용 담당자 이메일" required>
          <input
            className={inputCls}
            type="email"
            placeholder="예: recruiting@회사도메인.com"
            value={form.recruitingContactEmail}
            onChange={(e) =>
              setForm({ ...form, recruitingContactEmail: e.target.value })
            }
          />
          <p className="text-[11px] text-ink-muted mt-1 leading-relaxed">
            지원자가 AI 평가 거부·이의제기 시 연락할 곳으로, 공고 안내문에
            공개됩니다.
            {myDomain && (
              <>
                {" "}
                회사 도메인 <span className="font-mono">@{myDomain}</span> 만
                사용할 수 있어요.
              </>
            )}
          </p>
        </Field>

        <Field label="공고 비밀번호">
          <div className="space-y-2">
            <div className="text-xs text-ink-muted">
              현재 상태:{" "}
              {form.hasPassword ? (
                <span className="text-primary-deep font-medium">🔒 잠겨 있음</span>
              ) : (
                <span className="text-ink-muted">잠금 없음</span>
              )}
            </div>
            <PasswordInput
              className="w-full border border-border-strong rounded-lg px-3 py-2 text-sm font-mono tracking-widest placeholder:font-sans placeholder:tracking-normal disabled:bg-surface-alt disabled:text-ink-muted focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              placeholder={
                form.hasPassword
                  ? "새 비밀번호 (변경 시에만 입력)"
                  : "4자리 숫자"
              }
              autoComplete="new-password"
              inputMode="numeric"
              maxLength={4}
              disabled={form.clearPassword}
              value={form.password}
              onChange={(v) =>
                setForm({
                  ...form,
                  password: v.replace(/\D/g, "").slice(0, 4),
                })
              }
            />
            {form.hasPassword && (
              <label className="flex items-center gap-2 text-xs text-ink-soft">
                <input
                  type="checkbox"
                  checked={form.clearPassword}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      clearPassword: e.target.checked,
                      password: e.target.checked ? "" : form.password,
                    })
                  }
                />
                비밀번호 잠금 해제 (저장 시 잠금 제거)
              </label>
            )}
          </div>
        </Field>
      </div>

      <div className="flex gap-2 mt-6 justify-end">
        <button
          onClick={() => router.back()}
          className="px-4 py-2 rounded-lg border border-border-strong hover:bg-surface-alt text-sm"
        >
          취소
        </button>
        {isDraft ? (
          <>
            <button
              onClick={() => save(true)}
              disabled={saving}
              title="아직 임시공고로 유지 — 들어온 이력서는 보관만 하고 평가하지 않습니다."
              className="px-4 py-2 rounded-lg border border-border-strong bg-card hover:bg-surface-alt text-ink-soft text-sm font-medium disabled:opacity-50"
            >
              {saving ? "저장 중..." : "임시공고로 저장"}
            </button>
            <button
              onClick={() => save(false)}
              disabled={saving}
              title="정식 공고로 등록 — 평가가 시작되고 과금됩니다."
              className="px-5 py-2 rounded-lg bg-primary hover:bg-primary-deep text-surface text-sm font-medium disabled:opacity-50 shadow-sm"
            >
              {saving ? "저장 중..." : "공고 생성"}
            </button>
          </>
        ) : (
          <button
            onClick={() => save(false)}
            disabled={saving}
            className="px-5 py-2 rounded-lg bg-primary hover:bg-primary-deep text-surface text-sm font-medium disabled:opacity-50 shadow-sm"
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        )}
      </div>
      </div>
    </main>
  );
}

const inputCls =
  "w-full border border-border-strong rounded-lg px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent";

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-ink-soft mb-1.5">
        {label}
        {required && <span className="text-danger ml-1">*</span>}
      </label>
      {children}
    </div>
  );
}
