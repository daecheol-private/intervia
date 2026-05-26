"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { Sparkles, Link2 } from "lucide-react";

export default function NewJobPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: "",
    position: "",
    level: "3~5년차 (중급)",
    employmentType: "정규직",
    responsibilities: "",
    requirements: "",
    idealProfile: "",
    tone: "중립적인" as "친절한" | "중립적인" | "엄격한",
    interviewDurationMinutes: 20,
    password: "",
  });

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
      confidence: number;
      meta: { usedImageFallback: boolean; imageCount: number; siteHint?: string };
    };
    setForm((f) => ({
      ...f,
      // 빈 필드만 채움 — 사용자가 이미 입력한 내용은 보존
      title: f.title || d.title,
      position: f.position || d.position,
      level: f.level || d.level || f.level,
      employmentType: f.employmentType || d.employmentType || f.employmentType,
      responsibilities: f.responsibilities || d.responsibilities,
      requirements: f.requirements || d.requirements,
      idealProfile: f.idealProfile || d.idealProfile,
    }));
    const bits = [
      `${d.meta.siteHint ?? "외부 사이트"}에서 추출`,
      `신뢰도 ${(d.confidence * 100).toFixed(0)}%`,
    ];
    if (d.meta.usedImageFallback) bits.push(`이미지 ${d.meta.imageCount}장 분석`);
    setImportInfo(`✓ 자동 채움 완료 — ${bits.join(" · ")}. 내용 확인 후 수정/저장하세요.`);
  };

  const submit = async () => {
    if (!form.title || !form.position || !form.responsibilities || !form.requirements) {
      alert("필수 항목을 입력하세요.");
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
      body: JSON.stringify(form),
    });
    if (!res.ok) {
      alert("저장 실패: " + (await res.text()));
      setSaving(false);
      return;
    }
    const job = await res.json();
    router.push(`/jobs/${job.id}`);
  };

  return (
    <main className="max-w-3xl mx-auto w-full px-6 py-8">
      <Link
        href="/"
        className="text-sm text-slate-500 hover:text-slate-900 transition-colors"
      >
        ← 대시보드
      </Link>
      <h1 className="text-2xl font-bold mt-3 mb-1">새 공고 등록</h1>
      <p className="text-sm text-slate-500 mb-6">
        등록된 정보는 면접관 페르소나 생성에 사용됩니다.
      </p>

      <div className="bg-primary-soft/40 border border-primary/20 rounded-2xl p-4 mb-5">
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
              className="w-full border border-slate-300 rounded-lg pl-9 pr-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
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
            className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep disabled:opacity-50 text-white text-sm font-medium whitespace-nowrap"
          >
            {importing ? "분석 중..." : "가져오기"}
          </button>
        </div>
        {importErr && (
          <div className="mt-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
            {importErr}
          </div>
        )}
        {importInfo && (
          <div className="mt-2 text-xs text-primary-deep bg-primary-soft border border-primary/30 rounded-lg px-3 py-2">
            {importInfo}
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5 shadow-sm">
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

        <Field label="담당 업무" required>
          <Textarea
            placeholder="이 직무가 수행할 업무를 구체적으로 작성하세요."
            value={form.responsibilities}
            onChange={(v) => setForm({ ...form, responsibilities: v })}
          />
        </Field>

        <Field label="자격 요건 / 세부 내용" required>
          <Textarea
            placeholder="필요한 기술, 경험, 학력 등"
            value={form.requirements}
            onChange={(v) => setForm({ ...form, requirements: v })}
          />
        </Field>

        <Field label="우대사항">
          <Textarea
            placeholder="예: 자율적으로 문제를 정의하고 풀어가는 사람, 팀과 적극적으로 소통하는 사람, 새 기술 학습에 열린 태도 등"
            value={form.idealProfile}
            onChange={(v) => setForm({ ...form, idealProfile: v })}
          />
          <p className="text-xs text-slate-500 mt-1">
            AI 서류 평가 및 면접 평가 시 함께 반영됩니다. 차별 금지 항목(성별·나이·출신지·종교 등)은 적지 마세요.
          </p>
        </Field>

        <Field label="공고 비밀번호 (선택)">
          <input
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            placeholder="4자리 숫자 (예: 1234)"
            type="password"
            autoComplete="new-password"
            inputMode="numeric"
            maxLength={4}
            value={form.password}
            onChange={(e) =>
              setForm({
                ...form,
                password: e.target.value.replace(/\D/g, "").slice(0, 4),
              })
            }
          />
          <p className="text-xs text-slate-500 mt-1">
            설정하면 상세 페이지 진입 시 비밀번호를 입력해야 합니다.
          </p>
        </Field>

        <Field label="면접관 톤">
          <div className="grid grid-cols-3 gap-2">
            {(["친절한", "중립적인", "엄격한"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setForm({ ...form, tone: t })}
                className={`px-3 py-2 rounded-lg border text-sm transition-colors ${
                  form.tone === t
                    ? "border-primary bg-primary-soft text-primary-deep font-medium"
                    : "border-slate-200 hover:border-slate-300 text-slate-600"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </Field>
      </div>

      <div className="flex gap-2 mt-6 justify-end">
        <button
          onClick={() => router.back()}
          className="px-4 py-2 rounded-lg border border-slate-300 hover:bg-slate-100 text-sm"
        >
          취소
        </button>
        <button
          onClick={submit}
          disabled={saving}
          className="px-5 py-2 rounded-lg bg-primary hover:bg-primary-deep text-white text-sm font-medium disabled:opacity-50 shadow-sm"
        >
          {saving ? "저장 중..." : "공고 등록"}
        </button>
      </div>
    </main>
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
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">
        {label}
        {required && <span className="text-danger ml-1">*</span>}
      </label>
      {children}
    </div>
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
      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
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
      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm h-24 resize-y focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
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
      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
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
