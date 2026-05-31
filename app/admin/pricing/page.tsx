"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Pricing = { job_post: number; resume_upload: number; interview: number };

const LABELS: { key: keyof Pricing; label: string; desc: string }[] = [
  { key: "job_post", label: "공고 등록", desc: "공고 1건 생성 시 차감" },
  { key: "resume_upload", label: "이력서 업로드", desc: "이력서 1건 업로드 시 차감" },
  { key: "interview", label: "면접 1건", desc: "지원자가 동의 후 면접 시작 시 차감" },
];

export default function PricingPage() {
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [draft, setDraft] = useState<Pricing | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState("");

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/admin/pricing");
      if (!res.ok) {
        setErr(await res.text());
        return;
      }
      const data = (await res.json()) as Pricing;
      setPricing(data);
      setDraft(data);
    })();
  }, []);

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setErr("");
    setInfo("");
    const res = await fetch("/api/admin/pricing", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    setBusy(false);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    const data = (await res.json()) as Pricing;
    setPricing(data);
    setDraft(data);
    setInfo("저장되었습니다. 새 단가는 이 시점 이후 사용분부터 적용됩니다.");
  };

  if (!pricing || !draft)
    return (
      <main className="max-w-3xl mx-auto px-6 py-8 text-slate-400 text-sm">
        불러오는 중...
      </main>
    );

  const dirty =
    draft.job_post !== pricing.job_post ||
    draft.resume_upload !== pricing.resume_upload ||
    draft.interview !== pricing.interview;

  return (
    <main className="max-w-3xl mx-auto w-full px-6 py-8">
      <div className="mb-6">
        <Link href="/" className="text-xs text-slate-500 hover:underline">
          ← 대시보드
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-2">기능별 단가</h1>
        <p className="text-sm text-slate-500 mt-1">
          시스템 관리자만 변경 가능. 단가는 변경 시점 이후 사용분부터 적용됩니다 (소급 X).
        </p>
        <p className="text-xs text-slate-500 mt-2 bg-slate-50 border border-slate-200 rounded px-3 py-2">
          기준: <strong>100원 = 1 토큰</strong>. 충전 보너스: 10만원+ 5% · 30만원+ 10% · 50만원+ 15% · 100만원+ 20%. 신규 가입 시 무료 체험 100 토큰 자동 지급.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
        {LABELS.map(({ key, label, desc }) => (
          <div key={key} className="flex items-center justify-between gap-4">
            <div>
              <div className="font-medium text-slate-900">{label}</div>
              <div className="text-xs text-slate-500">{desc}</div>
            </div>
            <input
              type="number"
              min={0}
              className="w-32 border border-slate-300 rounded-lg px-3 py-2 text-sm text-right font-mono"
              value={draft[key]}
              onChange={(e) =>
                setDraft({ ...draft, [key]: Number(e.target.value) || 0 })
              }
            />
          </div>
        ))}

        {err && (
          <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2">
            {err}
          </div>
        )}
        {info && (
          <div className="text-xs text-primary-deep bg-primary-soft border border-primary/30 rounded-lg px-3 py-2">
            {info}
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <button
            onClick={save}
            disabled={busy || !dirty}
            className="flex-1 bg-primary hover:bg-primary-deep disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg shadow-sm"
          >
            {busy ? "저장 중..." : "저장"}
          </button>
          <button
            onClick={() => setDraft(pricing)}
            disabled={!dirty}
            className="px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium py-2.5 rounded-lg border border-slate-300 disabled:opacity-50"
          >
            되돌리기
          </button>
        </div>
      </div>
    </main>
  );
}
