"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import {
  APPLICANT_CATEGORIES,
  CATEGORY_LABEL,
  MESSAGE_MAX,
  MESSAGE_MIN,
  PHONE_MAX,
} from "@/lib/inquiry";
import { PoweredByIntervia } from "@/app/components/Logo";

// 지원 링크 페이지에서 이력서 업로드·제출 중 막힌 지원자가 쓰는 상시 신고 채널.
// AI 면접의 /interview/[token]/inquiry 와 동일한 흐름 — 회신용 이메일(필수) + 전화번호(선택).
export default function ApplyInquiryPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [category, setCategory] = useState<string>(APPLICANT_CATEGORIES[0]);
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
    const res = await fetch(`/api/apply/${token}/inquiry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, phone, category, message }),
    });
    setBusy(false);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    setDone(true);
  };

  return (
    <div className="min-h-screen bg-surface-alt flex flex-col items-center justify-start px-4 py-6">
      <div className="w-full max-w-xl">
        {done ? (
          <div className="bg-card border border-border-default rounded-2xl p-10 text-center shadow-sm">
            <div className="text-4xl mb-3">🛟</div>
            <h1 className="text-xl font-bold text-ink">접수 완료</h1>
            <p className="text-sm text-ink-soft mt-3 leading-relaxed">
              불편사항이 접수되었습니다. 확인 후 입력하신 연락처로 회신드립니다.
              급한 경우 지원 안내를 받은 메일에 회신해 주셔도 됩니다.
            </p>
            <Link
              href={`/apply/${token}`}
              className="inline-block mt-6 px-4 py-2.5 rounded-lg border border-border-strong text-ink-soft hover:bg-surface-alt text-sm"
            >
              지원서 작성으로 돌아가기
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-ink">문제 신고 / 문의</h1>
            <p className="text-sm text-ink-soft mt-2 leading-relaxed">
              지원서 접수 중 겪으신 오류나 불편사항을 알려 주세요. 이력서 업로드가
              안 되거나, 화면이 멈추거나, 제출이 실패하는 등 어떤 문제든
              접수됩니다. 회신을 위해 본인 이메일을 함께 입력해 주세요.
            </p>

            <div className="mt-6 bg-card border border-border-default rounded-2xl p-6 shadow-sm space-y-4">
              <div>
                <label className="block text-xs font-medium text-ink-soft mb-1">
                  본인 이메일 (회신 받으실 주소)
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full border border-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="you@example.com"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-soft mb-1">
                  연락 전화번호 (선택)
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  maxLength={PHONE_MAX}
                  className="w-full border border-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="010-0000-0000"
                />
                <div className="text-[11px] text-ink-muted mt-1">
                  전화 회신이 필요하면 남겨 주세요. 입력하지 않아도 됩니다.
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-soft mb-1">
                  분류
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full border border-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-card"
                >
                  {APPLICANT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-soft mb-1">
                  내용 ({MESSAGE_MIN}~{MESSAGE_MAX}자)
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={7}
                  maxLength={MESSAGE_MAX}
                  className="w-full border border-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary leading-relaxed"
                  placeholder="어떤 문제가 발생했는지, 어느 단계에서 막혔는지 구체적으로 작성해 주시면 빠르게 도와드릴 수 있습니다."
                />
                <div className="text-[11px] text-ink-muted mt-1">
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
                  className="px-5 py-2.5 rounded-lg bg-primary hover:bg-primary-deep text-surface text-sm font-medium disabled:opacity-50"
                >
                  {busy ? "접수 중..." : "신고 접수"}
                </button>
                <Link
                  href={`/apply/${token}`}
                  className="px-4 py-2.5 rounded-lg border border-border-strong text-ink-soft hover:bg-surface-alt text-sm"
                >
                  지원서 작성으로 돌아가기
                </Link>
              </div>
            </div>
          </>
        )}
        <PoweredByIntervia className="max-w-xl mt-4 mb-2" />
      </div>
    </div>
  );
}
