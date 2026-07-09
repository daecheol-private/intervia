"use client";

import { useRef, useState } from "react";
import { FileText, Paperclip, X } from "lucide-react";
import { isValidBrandColor, isLightColor, textColorOn } from "@/lib/brand-color";

const MAX_FILE_MB = 10;
const ACCEPT = ".pdf,.docx,.hwpx";
const ATTACH_ACCEPT =
  ".pdf,.docx,.doc,.hwp,.hwpx,.png,.jpg,.jpeg,.pptx,.xlsx,.txt,.md";

export default function ApplyForm({
  token,
  companyName,
  jobTitle,
  logoUrl,
  brandColor,
}: {
  token: string;
  companyName: string;
  jobTitle: string;
  logoUrl?: string | null;
  brandColor?: string | null;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [agreeCollection, setAgreeCollection] = useState(false);
  const [agreeAi, setAgreeAi] = useState(false);
  const [agreeFinal, setAgreeFinal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const resumeInputRef = useRef<HTMLInputElement>(null);

  // 법인 브랜딩 — 컬러는 상단 라인·제출 버튼에만, 글자 대비는 자동 보장.
  const color = brandColor && isValidBrandColor(brandColor) ? brandColor : null;
  const accentStyle = color ? { borderTop: `3px solid ${color}` } : undefined;
  // 밝은 색은 흰 카드 위 글자로 못 쓰므로 회사명은 어두운 색일 때만 브랜드 컬러
  const companyNameStyle =
    color && !isLightColor(color) ? { color } : undefined;
  const logoImg = logoUrl && (
    <img
      src={logoUrl}
      alt={`${companyName} 로고`}
      className="mb-3 max-h-12 max-w-[200px] object-contain"
      onError={(e) => {
        e.currentTarget.style.display = "none";
      }}
    />
  );

  function removeResume() {
    setFile(null);
    if (resumeInputRef.current) resumeInputRef.current.value = "";
  }
  function removeAttachment(idx: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  }

  const canSubmit =
    !!email.trim() &&
    !!file &&
    agreeCollection &&
    agreeAi &&
    agreeFinal &&
    !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file) {
      setError("이력서 파일을 첨부해 주세요.");
      return;
    }
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      setError(`이력서 파일은 최대 ${MAX_FILE_MB}MB 까지 업로드할 수 있습니다.`);
      return;
    }
    const tooBig = attachments.find((f) => f.size > MAX_FILE_MB * 1024 * 1024);
    if (tooBig) {
      setError(`첨부파일은 1개당 최대 ${MAX_FILE_MB}MB 까지 가능합니다: ${tooBig.name}`);
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("name", name.trim());
      fd.append("email", email.trim());
      fd.append("phone", phone.trim());
      fd.append("file", file);
      for (const a of attachments) fd.append("attachment", a);
      fd.append("consent_collection_use", agreeCollection ? "true" : "false");
      fd.append("consent_ai_decision", agreeAi ? "true" : "false");

      const res = await fetch(`/api/apply/${token}`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        let msg = "지원서 제출에 실패했습니다. 잠시 후 다시 시도해 주세요.";
        try {
          const j = await res.json();
          if (j?.message) msg = j.message;
        } catch {
          /* non-json */
        }
        setError(msg);
        setSubmitting(false);
        return;
      }
      setDone(true);
    } catch {
      setError("네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div
        className="rounded-2xl bg-card shadow-sm border border-border-default p-8 text-center"
        style={accentStyle}
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft text-primary text-2xl">
          ✓
        </div>
        <h1 className="mt-4 text-lg font-semibold text-ink">
          지원이 완료되었습니다
        </h1>
        <p className="mt-2 text-sm text-ink-soft leading-relaxed">
          {companyName} · {jobTitle} 에 지원해 주셔서 감사합니다.
          <br />
          제출하신 이력서는 채용 절차에 따라 검토됩니다.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl bg-card shadow-sm border border-border-default p-5 sm:p-6 space-y-4"
      style={accentStyle}
    >
      <div>
        {logoImg}
        <p className="text-xs font-medium text-primary" style={companyNameStyle}>
          {companyName}
        </p>
        <h1 className="mt-1 text-lg font-semibold text-ink">{jobTitle}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          아래 정보를 입력하고 이력서를 첨부해 지원해 주세요.
        </p>
      </div>

      <div className="space-y-3">
        <Field label="이메일" required>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="example@email.com"
            className="w-full rounded-lg border border-border-strong px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </Field>
        <Field label="이름">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="홍길동"
            className="w-full rounded-lg border border-border-strong px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </Field>
        <Field label="연락처">
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="010-0000-0000"
            className="w-full rounded-lg border border-border-strong px-3 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </Field>
        <Field label="이력서 파일" required>
          <input
            ref={resumeInputRef}
            type="file"
            accept={ACCEPT}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-primary-soft file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary hover:file:bg-primary-soft"
          />
          {file && (
            <div className="mt-1.5 flex items-center justify-between rounded-lg bg-surface-alt px-3 py-1.5 text-xs text-ink-soft">
              <span className="inline-flex items-center gap-1 truncate">
                <FileText className="w-3.5 h-3.5 shrink-0" strokeWidth={2.25} />
                <span className="truncate">{file.name}</span>
              </span>
              <button
                type="button"
                onClick={removeResume}
                className="ml-2 shrink-0 inline-flex items-center gap-1 text-ink-muted hover:text-danger"
              >
                <X className="w-3.5 h-3.5" strokeWidth={2.25} />
                제거
              </button>
            </div>
          )}
          <p className="mt-1 text-xs text-ink-muted">
            PDF · DOCX · HWPX, 최대 {MAX_FILE_MB}MB
          </p>
        </Field>
        <Field label="첨부파일 (선택)">
          <input
            type="file"
            accept={ATTACH_ACCEPT}
            multiple
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              setAttachments((prev) => {
                const merged = [...prev];
                for (const f of picked) {
                  if (!merged.some((m) => m.name === f.name && m.size === f.size))
                    merged.push(f);
                }
                return merged;
              });
              e.target.value = ""; // 같은 파일 재선택 허용 + 다음 선택은 누적
            }}
            className="block w-full text-sm text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-surface-alt file:px-4 file:py-2 file:text-sm file:font-medium file:text-ink-soft hover:file:bg-surface-alt"
          />
          <p className="mt-1 text-xs text-ink-muted">
            경력기술서·포트폴리오·자기소개서 등. 여러 개 추가 가능 · 1개당 최대 {MAX_FILE_MB}MB
          </p>
          {attachments.length > 0 && (
            <ul className="mt-1.5 space-y-1 text-xs text-ink-soft">
              {attachments.map((a, i) => (
                <li
                  key={`${a.name}-${a.size}-${i}`}
                  className="flex items-center justify-between rounded-lg bg-surface-alt px-3 py-1.5"
                >
                  <span className="inline-flex items-center gap-1 truncate">
                    <Paperclip className="w-3.5 h-3.5 shrink-0" strokeWidth={2.25} />
                    <span className="truncate">{a.name}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(i)}
                    className="ml-2 shrink-0 inline-flex items-center justify-center text-ink-muted hover:text-danger"
                    aria-label="첨부 제거"
                  >
                    <X className="w-3.5 h-3.5" strokeWidth={2.25} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Field>
      </div>

      <div className="space-y-2 rounded-xl bg-surface-alt p-3.5">
        <Check
          checked={agreeCollection}
          onChange={setAgreeCollection}
          label="(필수) 개인정보 수집·이용 동의"
          desc="이름·이메일·연락처·이력서 본문을 채용 절차(서류 평가·면접 진행·합·불 결정)에 이용하며, 서비스 운영을 위해 국외(미국·일본)의 호스팅·DB에 저장될 수 있습니다."
        />
        <Check
          checked={agreeAi}
          onChange={setAgreeAi}
          label="(필수) AI 자동 평가 적용 및 거부권 안내 확인"
          desc="제출하신 이력서에 AI(서울 리전)가 점수·추천을 산출하나 최종 합·불은 채용 담당자가 결정합니다. AI 평가를 원치 않으면 채용 기업의 일반 절차를 요청할 수 있습니다."
        />
        <Check
          checked={agreeFinal}
          onChange={setAgreeFinal}
          label="제출 후 수정·취소가 불가함을 확인했습니다."
        />
      </div>

      {error && (
        <p className="text-sm text-danger bg-danger-soft rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        // 활성 상태에서만 브랜드 컬러 — 비활성은 기존 disabled 클래스가 그대로 적용
        style={
          color && canSubmit
            ? { backgroundColor: color, color: textColorOn(color) }
            : undefined
        }
        className={`w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-surface disabled:cursor-not-allowed disabled:bg-border-strong ${
          color ? "hover:brightness-95" : "bg-primary hover:bg-primary-deep"
        }`}
      >
        {submitting ? "제출 중…" : "지원서 제출"}
      </button>
    </form>
  );
}

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
    <label className="block">
      <span className="mb-0.5 block text-sm font-medium text-ink-soft">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </span>
      {children}
    </label>
  );
}

function Check({
  checked,
  onChange,
  label,
  desc,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  desc?: string;
}) {
  return (
    <label className="flex gap-2.5 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-border-strong accent-primary focus:ring-primary"
      />
      <span className="text-sm text-ink-soft">
        <span className="font-medium">{label}</span>
        {desc && <span className="mt-0.5 block text-xs text-ink-muted leading-relaxed">{desc}</span>}
      </span>
    </label>
  );
}
