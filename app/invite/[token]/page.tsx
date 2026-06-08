"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { PasswordStrength } from "@/app/password-strength";

type InviteInfo = {
  token: string;
  orgId: number;
  orgName: string;
  emailMasked: string;
  job?: { id: number; title: string; position: string };
  jobDeleted?: boolean;
  expiresAt: string;
};

export default function InvitePage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [err, setErr] = useState<{ code: string; message: string } | null>(
    null
  );
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [mode, setMode] = useState<"prompt" | "signup">("prompt");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void (async () => {
      const [infoRes, meRes] = await Promise.all([
        fetch(`/api/invites/${token}`),
        fetch(`/api/auth/status`).catch(() => null),
      ]);
      if (!infoRes.ok) {
        const e = await infoRes.json().catch(() => null);
        setErr(e ?? { code: "error", message: "초대 정보 조회 실패" });
        return;
      }
      setInfo(await infoRes.json());
      const status = meRes && meRes.ok ? await meRes.json() : null;
      setAuthed(!!status?.user);
    })();
  }, [token]);

  if (err) {
    return (
      <main className="max-w-md mx-auto px-6 py-16">
        <div className="bg-white border border-rose-200 rounded-2xl p-8 text-center shadow-sm">
          <div className="text-4xl mb-3">⚠️</div>
          <h1 className="text-lg font-bold text-slate-900">초대 수락 실패</h1>
          <p className="text-sm text-slate-600 mt-3 leading-relaxed">
            {err.message}
          </p>
          <Link
            href="/"
            className="inline-block mt-6 px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-sm text-slate-700"
          >
            홈으로
          </Link>
        </div>
      </main>
    );
  }

  if (!info) {
    return (
      <main className="max-w-md mx-auto px-6 py-16 text-center text-sm text-slate-400">
        불러오는 중...
      </main>
    );
  }

  if (pending) {
    return (
      <main className="max-w-md mx-auto px-6 py-16">
        <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center shadow-sm">
          <div className="text-4xl mb-3">📨</div>
          <h1 className="text-lg font-bold text-slate-900">합류 신청 완료</h1>
          <p className="text-sm text-slate-600 mt-3 leading-relaxed">
            <strong>{info.orgName}</strong> 법인담당자의 승인을 기다리고 있습니다.
            승인되면 공유된 공고에 면접관으로 자동 등록되어, 공고 비밀번호 없이
            후보자·평가를 확인하실 수 있습니다.
          </p>
          <p className="text-xs text-slate-500 mt-3">
            승인 완료 후 로그인해 주세요.
          </p>
          <Link
            href="/login"
            className="inline-block mt-6 px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-sm text-slate-700"
          >
            로그인 화면으로
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-md mx-auto px-6 py-16">
      <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
        <div className="text-center">
          <div className="text-4xl mb-3">📨</div>
          <h1 className="text-xl font-bold text-slate-900">
            {info.orgName} 합류 초대
          </h1>
          <p className="text-sm text-slate-600 mt-3 leading-relaxed">
            <strong>{info.emailMasked}</strong> 로 발송된 초대입니다.
          </p>
        </div>

        {info.job && (
          <div className="mt-6 p-4 bg-slate-50 border border-slate-200 rounded-xl">
            <div className="text-xs text-slate-500">공유된 공고</div>
            <div className="text-sm font-semibold text-slate-900 mt-1">
              {info.job.title}
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              {info.job.position}
            </div>
          </div>
        )}

        {info.jobDeleted && (
          <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-xl">
            <div className="text-sm font-semibold text-amber-800">
              공유된 공고가 삭제되었습니다
            </div>
            <p className="text-xs text-amber-700 mt-1 leading-relaxed">
              그래도 <strong>{info.orgName}</strong> 채용 시스템에 가입을 신청하시겠어요?
              법인담당자 승인 후 다른 공고에 면접관으로 참여할 수 있습니다.
            </p>
          </div>
        )}

        <p className="text-[11px] text-slate-500 mt-4">
          링크 유효기간:{" "}
          {new Date(info.expiresAt).toLocaleDateString("ko-KR")}
        </p>

        <div className="mt-6">
          {authed ? (
            <AcceptButton
              token={token}
              onPending={() => setPending(true)}
            />
          ) : mode === "prompt" ? (
            <div className="space-y-3">
              <p className="text-xs text-slate-600 bg-amber-50 border border-amber-200 rounded-lg p-3">
                초대받은 이메일로 가입을 신청하면, {info.orgName} 법인담당자 승인 후
                이 공고에 면접관으로 자동 등록됩니다 (공고 비밀번호 불요). 이미{" "}
                {info.orgName} 소속 계정이라면 로그인 시 바로 등록됩니다.
              </p>
              <button
                onClick={() => setMode("signup")}
                className="block w-full text-center px-4 py-3 rounded-lg bg-primary hover:bg-primary-deep text-white text-sm font-medium"
              >
                신규 가입 신청
              </button>
              <Link
                href={`/login?next=${encodeURIComponent(`/invite/${info.token}`)}`}
                className="block w-full text-center px-4 py-3 rounded-lg border border-slate-300 hover:bg-slate-50 text-sm text-slate-700"
              >
                이미 계정이 있어요 — 로그인
              </Link>
            </div>
          ) : (
            <SignupForm
              token={token}
              onBack={() => setMode("prompt")}
              onPending={() => setPending(true)}
            />
          )}
        </div>
      </div>
    </main>
  );
}

function AcceptButton({
  token,
  onPending,
}: {
  token: string;
  onPending: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const accept = async () => {
    setBusy(true);
    setErr("");
    const r = await fetch(`/api/invites/${token}/accept`, { method: "POST" });
    const data = await r.json().catch(() => null);
    setBusy(false);
    if (!r.ok) {
      setErr(data?.message ?? "수락 실패");
      return;
    }
    // 신규 합류(무소속) → 승인 대기 화면. 이미 같은 법인 멤버 → 공고로 바로 이동.
    if (data.code === "pending") {
      onPending();
      return;
    }
    if (data.jobId) router.replace(`/jobs/${data.jobId}`);
    else router.replace("/");
  };

  return (
    <>
      {err && (
        <div className="mb-3 text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg p-3">
          {err}
        </div>
      )}
      <button
        onClick={accept}
        disabled={busy}
        className="w-full px-4 py-3 rounded-lg bg-primary hover:bg-primary-deep text-white text-sm font-medium disabled:opacity-50"
      >
        {busy ? "처리 중..." : "합류하기"}
      </button>
    </>
  );
}

function SignupForm({
  token,
  onBack,
  onPending,
}: {
  token: string;
  onBack: () => void;
  onPending: () => void;
}) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [ageOver14, setAgeOver14] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const r = await fetch("/api/auth/signup-via-invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        name: name.trim(),
        password,
        acceptTerms,
        acceptPrivacy,
        ageOver14,
      }),
    });
    setBusy(false);
    if (!r.ok) {
      setErr(await r.text());
      return;
    }
    // 가입은 합류 요청(pending) 으로만 생성됨 — 법인담당자 승인 대기 화면으로.
    onPending();
  };

  return (
    <form onSubmit={submit} className="space-y-3 text-sm">
      <button
        type="button"
        onClick={onBack}
        className="text-xs text-slate-500 hover:underline"
      >
        ← 뒤로
      </button>
      <label className="block">
        <span className="text-xs text-slate-600">이름</span>
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </label>
      <label className="block">
        <span className="text-xs text-slate-600">비밀번호</span>
        <input
          required
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <PasswordStrength password={password} />
      </label>
      <div className="space-y-1 text-xs text-slate-600">
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={ageOver14}
            onChange={(e) => setAgeOver14(e.target.checked)}
            className="mt-0.5"
          />
          <span>본인은 만 14세 이상입니다 (PIPA §22의2)</span>
        </label>
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={acceptTerms}
            onChange={(e) => setAcceptTerms(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            <Link
              href="/terms"
              target="_blank"
              className="text-primary hover:underline"
            >
              이용약관
            </Link>
            에 동의합니다
          </span>
        </label>
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={acceptPrivacy}
            onChange={(e) => setAcceptPrivacy(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            <Link
              href="/privacy"
              target="_blank"
              className="text-primary hover:underline"
            >
              개인정보 처리방침
            </Link>
            에 동의합니다
          </span>
        </label>
      </div>
      {err && (
        <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg p-3 whitespace-pre-wrap">
          {err}
        </div>
      )}
      <button
        type="submit"
        disabled={busy || !ageOver14 || !acceptTerms || !acceptPrivacy}
        className="w-full px-4 py-3 rounded-lg bg-primary hover:bg-primary-deep text-white text-sm font-medium disabled:opacity-50"
      >
        {busy ? "신청 중..." : "가입 신청"}
      </button>
    </form>
  );
}
