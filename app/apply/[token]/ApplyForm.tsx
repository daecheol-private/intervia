"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { FileText, Paperclip, X } from "lucide-react";
import { upload } from "@vercel/blob/client";
import { isValidBrandColor, textColorOn } from "@/lib/brand-color";

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
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const resumeInputRef = useRef<HTMLInputElement>(null);

  // 법인 브랜딩 — 헤더 밴드 배경 + 제출 버튼. 밴드 위 글자 대비는 자동 보장(textColorOn).
  const color = brandColor && isValidBrandColor(brandColor) ? brandColor : null;
  const bandStyle = color ? { backgroundColor: color } : undefined;
  const onBand = color ? textColorOn(color) : null;
  const logoImg = (centered: boolean) =>
    logoUrl && (
      <img
        src={logoUrl}
        alt={`${companyName} 로고`}
        className={`${centered ? "mx-auto " : ""}mb-3 max-h-12 max-w-[200px] object-contain`}
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
    // 이력서+첨부 합산 총량 — 서버(413)와 동일 기준으로 미리 안내.
    const totalBytes = file.size + attachments.reduce((s, f) => s + f.size, 0);
    if (totalBytes > MAX_FILE_MB * 1024 * 1024) {
      setError(
        `이력서와 첨부를 합쳐 최대 ${MAX_FILE_MB}MB 까지 업로드할 수 있습니다.`
      );
      return;
    }
    setSubmitting(true);
    setProgress(null);
    try {
      // 사전 중복체크 — 파일 업로드 전에 email·연락처로 기존 지원 여부 확인(Blob 낭비·고아 방지).
      // 실패(네트워크 등)는 무시하고 진행 — 최종 제출(/api/apply/[token])이 다시 검증한다.
      try {
        const pre = await fetch(`/api/apply/${token}/precheck`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), phone: phone.trim() }),
        });
        if (pre.ok) {
          const pj = (await pre.json()) as { duplicate?: boolean; message?: string };
          if (pj?.duplicate) {
            setError(pj.message || "이미 지원하신 내역이 있습니다.");
            setSubmitting(false);
            return;
          }
        }
      } catch {
        /* 사전 체크 실패는 무시 — 최종 제출에서 다시 검증 */
      }

      // Vercel 서버 함수 본문 한도(4.5MB) 회피 — 브라우저에서 Vercel Blob 으로 직접 업로드 후
      // 서버에는 manifest(JSON)만 전송. 최대 10MB 까지 (4.5~10MB PDF 가 413 으로 잘리던 문제 해결).
      // dev/blob 미설정 환경에서는 NEXT_PUBLIC_BLOB_CLIENT_UPLOAD!=1 → 기존 FormData 경로.
      const useBlobUpload = process.env.NEXT_PUBLIC_BLOB_CLIENT_UPLOAD === "1";
      let res: Response;
      if (useBlobUpload) {
        // 전체 바이트 대비 진행률 — 파일별 onUploadProgress 를 누적해 표시.
        const uploadTotal =
          file.size + attachments.reduce((s, a) => s + a.size, 0) || 1;
        let uploadedBytes = 0;
        setProgress(0);
        const showProgress = (loaded: number) =>
          setProgress(
            Math.min(99, Math.round(((uploadedBytes + loaded) / uploadTotal) * 100))
          );
        const resumeBlob = await upload(file.name, file, {
          access: "private",
          handleUploadUrl: `/api/apply/${token}/blob-upload`,
          clientPayload: JSON.stringify({ kind: "resume" }),
          multipart: file.size > 8 * 1024 * 1024,
          onUploadProgress: (p) => showProgress(p.loaded),
        });
        uploadedBytes += file.size;
        const attBlobs: { url: string; name: string; size: number }[] = [];
        for (const a of attachments) {
          const r = await upload(a.name, a, {
            access: "private",
            handleUploadUrl: `/api/apply/${token}/blob-upload`,
            clientPayload: JSON.stringify({ kind: "attachment" }),
            multipart: a.size > 8 * 1024 * 1024,
            onUploadProgress: (p) => showProgress(p.loaded),
          });
          uploadedBytes += a.size;
          attBlobs.push({ url: r.url, name: a.name, size: a.size });
        }
        setProgress(100);
        res = await fetch(`/api/apply/${token}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            email: email.trim(),
            phone: phone.trim(),
            consent_collection_use: agreeCollection,
            consent_ai_decision: agreeAi,
            // 유입 출처(어느 채용사이트에서 왔는지) — 서버가 호스트만 추려 저장.
            referrer: document.referrer || undefined,
            resume: { url: resumeBlob.url, name: file.name, size: file.size },
            attachments: attBlobs,
          }),
        });
      } else {
        const fd = new FormData();
        fd.append("name", name.trim());
        fd.append("email", email.trim());
        fd.append("phone", phone.trim());
        fd.append("file", file);
        for (const a of attachments) fd.append("attachment", a);
        fd.append("consent_collection_use", agreeCollection ? "true" : "false");
        fd.append("consent_ai_decision", agreeAi ? "true" : "false");
        if (document.referrer) fd.append("referrer", document.referrer);
        res = await fetch(`/api/apply/${token}`, {
          method: "POST",
          body: fd,
        });
      }
      if (!res.ok) {
        let msg = "지원서 제출에 실패했습니다. 잠시 후 다시 시도해 주세요.";
        try {
          const j = await res.json();
          if (j?.message) msg = j.message;
        } catch {
          /* non-json */
        }
        setProgress(null);
        setError(msg);
        setSubmitting(false);
        return;
      }
      setDone(true);
    } catch (err) {
      // upload() 실패(형식·크기·네트워크)는 서버 토큰 라우트가 던진 한국어 메시지를 그대로 노출.
      setProgress(null);
      setError(
        err instanceof Error && err.message
          ? err.message
          : "네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."
      );
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl bg-card shadow-sm border border-border-default overflow-hidden text-center">
        {(logoUrl || color) && (
          <div className="px-8 pt-6 pb-5" style={bandStyle}>
            {logoImg(true)}
            <p
              className="text-xs font-medium text-primary"
              style={onBand ? { color: onBand, opacity: 0.85 } : undefined}
            >
              {companyName}
            </p>
          </div>
        )}
        <div className="p-8">
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
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl bg-card shadow-sm border border-border-default overflow-hidden"
    >
      {/* 헤더 밴드 — 브랜드 컬러 설정 시 영역 전체를 채운다 */}
      <div className="px-5 pt-5 pb-4 sm:px-6 sm:pt-6" style={bandStyle}>
        {/* 로고 + 상시 문의 링크 — AI 면접 화면처럼 헤더 영역 오른쪽에 배치.
            밴드 배경(브랜드 컬러) 위에서는 대비색(onBand)으로, 흰 헤더에서는 회색으로. */}
        <div className="flex items-start gap-3">
          {logoImg(false)}
          <Link
            href={`/apply/${token}/inquiry`}
            className={`ml-auto shrink-0 text-[11px] underline whitespace-nowrap ${
              onBand ? "hover:opacity-80" : "text-ink-muted hover:text-ink-soft"
            }`}
            style={onBand ? { color: onBand, opacity: 0.75 } : undefined}
          >
            문제가 있나요? 신고 / 문의
          </Link>
        </div>
        <p
          className="text-xs font-medium text-primary"
          style={onBand ? { color: onBand, opacity: 0.85 } : undefined}
        >
          {companyName}
        </p>
        <h1
          className="mt-1 text-lg font-semibold text-ink"
          style={onBand ? { color: onBand } : undefined}
        >
          {jobTitle}
        </h1>
        <p
          className="mt-1 text-sm text-ink-muted"
          style={onBand ? { color: onBand, opacity: 0.75 } : undefined}
        >
          아래 정보를 입력하고 이력서를 첨부해 지원해 주세요.
        </p>
      </div>

      <div className="px-5 pb-5 sm:px-6 sm:pb-6 pt-4 space-y-4">
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
            경력기술서·포트폴리오·자기소개서 등. 여러 개 추가 가능 · 이력서 포함 전체 합쳐 최대 {MAX_FILE_MB}MB
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

      {submitting && progress !== null && (
        <div className="space-y-1.5">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-alt">
            <div
              className="h-full rounded-full bg-primary transition-all duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-center text-xs text-ink-muted">
            {progress < 100 ? `업로드 중… ${progress}%` : "지원서 등록 중…"}
          </p>
        </div>
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
      </div>
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
