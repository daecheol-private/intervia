"use client";

import { useRouter, useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";

type Form = {
  title: string;
  position: string;
  level: string;
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
};

export default function EditJobPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetch(`/api/jobs/${id}`)
      .then((r) => r.json())
      .then((j) =>
        setForm({
          title: j.title,
          position: j.position,
          level: j.level,
          employmentType: j.employmentType,
          responsibilities: j.responsibilities,
          requirements: j.requirements,
          idealProfile: j.idealProfile ?? "",
          evaluationFocus: j.evaluationFocus ?? "",
          tone: j.tone,
          interviewDurationMinutes: j.interviewDurationMinutes ?? 20,
          hasPassword: !!j.hasPassword,
          password: "",
          clearPassword: false,
        })
      );
  }, [id]);

  const submit = async () => {
    if (!form) return;
    if (form.password && !/^\d{4}$/.test(form.password)) {
      alert("비밀번호는 4자리 숫자여야 합니다.");
      return;
    }
    setSaving(true);
    // password: 빈 문자열 + clearPassword=true → 잠금 해제, 4자리 → 변경, 그 외 → 유지
    const payload: Record<string, unknown> = { ...form };
    if (form.clearPassword) payload.password = "";
    else if (!form.password) delete payload.password;
    delete payload.hasPassword;
    delete payload.clearPassword;

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
      <main className="max-w-3xl mx-auto w-full px-6 py-8 text-slate-500">
        불러오는 중...
      </main>
    );

  return (
    <main className="max-w-3xl mx-auto w-full px-6 py-8">
      <Link
        href={`/jobs/${id}`}
        className="text-sm text-slate-500 hover:text-slate-900"
      >
        ← 공고 상세
      </Link>
      <h1 className="text-2xl font-bold mt-3 mb-6">공고 수정</h1>

      <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5 shadow-sm">
        <Field label="공고 제목">
          <input
            className={inputCls}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="직무">
            <input
              className={inputCls}
              value={form.position}
              onChange={(e) => setForm({ ...form, position: e.target.value })}
            />
          </Field>
          <Field label="직급/연차">
            <select
              className={inputCls}
              value={form.level}
              onChange={(e) => setForm({ ...form, level: e.target.value })}
            >
              <option>신입 (0년)</option>
              <option>1~2년차 (주니어)</option>
              <option>3~5년차 (중급)</option>
              <option>6~9년차 (시니어)</option>
              <option>10년 이상 (리드)</option>
            </select>
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
        <Field label="담당 업무">
          <textarea
            className={inputCls + " h-24 resize-y"}
            value={form.responsibilities}
            onChange={(e) =>
              setForm({ ...form, responsibilities: e.target.value })
            }
          />
        </Field>
        <Field label="자격 요건">
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
        <Field label="공고 비밀번호">
          <div className="space-y-2">
            <div className="text-xs text-slate-500">
              현재 상태:{" "}
              {form.hasPassword ? (
                <span className="text-primary-deep font-medium">🔒 잠겨 있음</span>
              ) : (
                <span className="text-slate-500">잠금 없음</span>
              )}
            </div>
            <input
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono tracking-widest disabled:bg-slate-100 disabled:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              placeholder={
                form.hasPassword
                  ? "새 비밀번호 (변경 시에만 입력)"
                  : "4자리 숫자"
              }
              type="password"
              autoComplete="new-password"
              inputMode="numeric"
              maxLength={4}
              disabled={form.clearPassword}
              value={form.password}
              onChange={(e) =>
                setForm({
                  ...form,
                  password: e.target.value.replace(/\D/g, "").slice(0, 4),
                })
              }
            />
            {form.hasPassword && (
              <label className="flex items-center gap-2 text-xs text-slate-600">
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
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>
    </main>
  );
}

const inputCls =
  "w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}
