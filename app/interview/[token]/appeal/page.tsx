"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import Link from "next/link";

export default function AppealPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  const submit = async () => {
    setErr("");
    if (!email || !reason) {
      setErr("이메일과 사유를 모두 입력해 주세요.");
      return;
    }
    if (reason.length < 10) {
      setErr("사유는 최소 10자 이상 작성해 주세요.");
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/interview/${token}/appeal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, reason }),
    });
    setBusy(false);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    setDone(true);
  };

  if (done) {
    return (
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center max-w-md shadow-sm">
          <div className="text-4xl mb-3">📮</div>
          <h1 className="text-xl font-bold text-slate-900">접수 완료</h1>
          <p className="text-sm text-slate-600 mt-3 leading-relaxed">
            이의제기가 접수되었습니다. 영업일 기준 7일 이내에 입력하신 이메일로
            검토 결과를 회신드립니다.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-2xl mx-auto w-full px-6 py-10">
      <h1 className="text-2xl font-bold text-slate-900">AI 평가 이의제기</h1>
      <p className="text-sm text-slate-600 mt-2 leading-relaxed">
        개인정보 보호법 제37조의2 에 따라 본 채용에서 사용된 AI 자동화
        의사결정 결과에 대해 설명을 요청하거나 이의를 제기할 수 있습니다.
        본인 확인을 위해 면접 안내 메일을 받으신 이메일과 사유를 작성해 주세요.
      </p>
      <p className="text-xs text-slate-500 mt-2">
        법적 근거: PIPA §37의2 (2024.3 시행) · 처리 시한: 영업일 기준 7일 이내
      </p>

      <div className="mt-6 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            본인 이메일 (면접 안내를 받으신 주소)
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="you@example.com"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            이의 사유 (10~5000자)
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={8}
            maxLength={5000}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary leading-relaxed"
            placeholder="평가 결과에 의문이 있는 부분, 추가 설명이 필요한 부분, 또는 결정에 대한 이의 사항을 자유롭게 작성해 주세요."
          />
          <div className="text-[11px] text-slate-400 mt-1">
            {reason.length} / 5000
          </div>
        </div>

        {err && (
          <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2">
            {err}
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <button
            onClick={submit}
            disabled={busy || !email || !reason}
            className="px-5 py-2.5 rounded-lg bg-primary hover:bg-primary-deep text-white text-sm font-medium disabled:opacity-50"
          >
            {busy ? "접수 중..." : "이의제기 접수"}
          </button>
          <Link
            href="/privacy"
            target="_blank"
            className="px-4 py-2.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm"
          >
            개인정보 처리방침
          </Link>
        </div>
      </div>
    </main>
  );
}
