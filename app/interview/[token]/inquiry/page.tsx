"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import {
  CANDIDATE_CATEGORIES,
  CATEGORY_LABEL,
  MESSAGE_MAX,
  MESSAGE_MIN,
} from "@/lib/inquiry";

export default function InterviewInquiryPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [email, setEmail] = useState("");
  const [category, setCategory] = useState<string>(CANDIDATE_CATEGORIES[0]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  const submit = async () => {
    setErr("");
    if (!email || !message) {
      setErr("이메일과 내용을 모두 입력해 주세요.");
      return;
    }
    if (message.length < MESSAGE_MIN) {
      setErr(`내용은 최소 ${MESSAGE_MIN}자 이상 작성해 주세요.`);
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/interview/${token}/inquiry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, category, message }),
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
          <div className="text-4xl mb-3">🛟</div>
          <h1 className="text-xl font-bold text-slate-900">접수 완료</h1>
          <p className="text-sm text-slate-600 mt-3 leading-relaxed">
            불편사항이 접수되었습니다. 확인 후 입력하신 이메일로 회신드립니다.
            급한 경우 면접 안내 메일에 회신해 주셔도 됩니다.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-2xl mx-auto w-full px-6 py-10">
      <h1 className="text-2xl font-bold text-slate-900">문제 신고 / 문의</h1>
      <p className="text-sm text-slate-600 mt-2 leading-relaxed">
        면접 진행 중 겪으신 오류나 불편사항을 알려 주세요. 화면이 멈추거나,
        메시지가 전송되지 않거나, 접속이 안 되는 등 어떤 문제든 접수됩니다.
        회신을 위해 본인 이메일을 함께 입력해 주세요.
      </p>

      <div className="mt-6 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            본인 이메일 (회신 받으실 주소)
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
            분류
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-white"
          >
            {CANDIDATE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            내용 ({MESSAGE_MIN}~{MESSAGE_MAX}자)
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={7}
            maxLength={MESSAGE_MAX}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary leading-relaxed"
            placeholder="어떤 문제가 발생했는지, 어느 단계에서 막혔는지 구체적으로 작성해 주시면 빠르게 도와드릴 수 있습니다."
          />
          <div className="text-[11px] text-slate-400 mt-1">
            {message.length} / {MESSAGE_MAX}
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
            disabled={busy || !email || !message}
            className="px-5 py-2.5 rounded-lg bg-primary hover:bg-primary-deep text-white text-sm font-medium disabled:opacity-50"
          >
            {busy ? "접수 중..." : "신고 접수"}
          </button>
          <Link
            href={`/interview/${token}`}
            className="px-4 py-2.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm"
          >
            면접으로 돌아가기
          </Link>
        </div>
      </div>
    </main>
  );
}
