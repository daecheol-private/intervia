"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { PasswordStrength } from "@/app/password-strength";
import { LogoMark } from "@/app/components/Logo";
import { PasswordInput } from "@/app/components/PasswordInput";

// status=pending 사용자가 로그인 시도 시 받는 정보 — 2단계 진행 상태 + 운영자 권한 요청 폼에 사용.
type PendingInfo = {
  orgId: number | null;
  orgName: string | null;
  requesterName: string | null;
  requesterEmail: string;
  emailVerified: boolean;
};

export default function LoginPage() {
  const router = useRouter();
  const search = useSearchParams();
  // 오픈 리다이렉트 방어 — 내부 상대경로(`/...`)만 허용. `//evil`·`/\evil`·`https://evil` 차단.
  const rawNext = search.get("next") || "/";
  const next = /^\/(?![/\\])/.test(rawNext) ? rawNext : "/";
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null);
  const [form, setForm] = useState({ email: "", password: "", name: "" });
  const [rememberId, setRememberId] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [needsVerify, setNeedsVerify] = useState(false);
  const [info, setInfo] = useState("");
  const [totpChallenge, setTotpChallenge] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [pending, setPending] = useState<PendingInfo | null>(null);

  // 저장된 이메일(ID) 불러오기 — 체크박스 사용 시 다음 방문에 자동 입력
  useEffect(() => {
    const saved = localStorage.getItem("intervia.savedEmail");
    if (saved) {
      setForm((f) => ({ ...f, email: saved }));
      setRememberId(true);
    }
  }, []);

  useEffect(() => {
    void fetch("/api/auth/status")
      .then((r) => r.json())
      .then((d) => {
        if (d.user) {
          router.replace(next);
          return;
        }
        setSetupRequired(d.setupRequired);
      });
  }, [next, router]);

  const submit = async () => {
    setErr("");
    setInfo("");
    setNeedsVerify(false);
    if (!form.email || !form.password || (setupRequired && !form.name)) {
      setErr("필수 항목을 모두 입력하세요.");
      return;
    }
    // ID 저장 선택에 따라 이메일 보관/삭제
    if (rememberId) {
      localStorage.setItem("intervia.savedEmail", form.email);
    } else {
      localStorage.removeItem("intervia.savedEmail");
    }
    setBusy(true);
    const url = setupRequired ? "/api/auth/setup" : "/api/auth/login";
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setBusy(false);
    if (!res.ok) {
      const text = await res.text();
      try {
        const data = JSON.parse(text);
        if (data?.code === "email_unverified") {
          setNeedsVerify(true);
          setErr(data.error);
          return;
        }
        // 합류 요청 후 담당자 승인 대기 중 — 그 자리에서 운영자 권한 부여 요청 동선 제공
        if (data?.code === "pending_approval") {
          setPending({
            orgId: data.orgId ?? null,
            orgName: data.orgName ?? null,
            requesterName: data.requesterName ?? null,
            requesterEmail: form.email.trim(),
            emailVerified: !!data.emailVerified,
          });
          return;
        }
        if (data?.code === "rate_limited") {
          setErr(data.error ?? "너무 많은 시도. 잠시 후 다시 시도해 주세요.");
          return;
        }
        if (data?.error) {
          setErr(data.error);
          return;
        }
      } catch {
        // not json — plain text 응답
      }
      setErr(text);
      return;
    }
    // 2FA 단계 진입 — 세션은 아직 발급 안 됨
    try {
      const data = await res.clone().json();
      if (data?.needsTotp && data?.challenge) {
        setTotpChallenge(data.challenge);
        return;
      }
    } catch {
      // not json — proceed as login success
    }
    router.replace(next);
    router.refresh();
  };

  const submitTotp = async () => {
    setErr("");
    if (!totpChallenge || totpCode.length !== 6) {
      setErr("6자리 코드를 입력하세요.");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/auth/login/totp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challenge: totpChallenge, code: totpCode }),
    });
    setBusy(false);
    if (!res.ok) {
      const text = await res.text();
      try {
        const data = JSON.parse(text);
        if (data?.code === "challenge_invalid") {
          setErr(data.error);
          setTotpChallenge(null);
          setTotpCode("");
          return;
        }
        if (data?.error) {
          setErr(data.error);
          return;
        }
      } catch {
        /* not json */
      }
      setErr(text);
      return;
    }
    router.replace(next);
    router.refresh();
  };

  const resend = async () => {
    setBusy(true);
    setInfo("");
    setErr("");
    const res = await fetch("/api/auth/resend-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: form.email }),
    });
    setBusy(false);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    setInfo("인증 메일을 재발송했습니다. 메일함을 확인해주세요.");
    setNeedsVerify(false);
  };

  if (setupRequired === null) {
    return (
      <main className="flex-1 flex items-center justify-center text-slate-400">
        불러오는 중...
      </main>
    );
  }

  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <LogoMark size={48} className="mx-auto mb-3 shadow-lg" />
          <h1 className="text-xl font-bold text-slate-900">
            {pending
              ? "승인 대기 중"
              : setupRequired
                ? "초기 관리자 계정 생성"
                : "로그인"}
          </h1>
          {setupRequired && (
            <p className="text-sm text-slate-500 mt-1">
              최초 1회 관리자 계정을 생성합니다.
            </p>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
          {pending ? (
            <PendingApprovalPanel
              info={pending}
              onBack={() => {
                setPending(null);
                setForm((f) => ({ ...f, password: "" }));
                setErr("");
              }}
            />
          ) : totpChallenge ? (
            <>
              <p className="text-sm text-slate-600">
                Authenticator 앱의 6자리 코드를 입력하세요.
              </p>
              <Field label="인증 코드">
                <input
                  className={inputCls}
                  inputMode="numeric"
                  maxLength={6}
                  autoFocus
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                  onKeyDown={(e) => e.key === "Enter" && submitTotp()}
                />
              </Field>
              {err && (
                <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2">
                  {err}
                </div>
              )}
              <button
                onClick={submitTotp}
                disabled={busy || totpCode.length !== 6}
                className="w-full bg-primary hover:bg-primary-deep disabled:opacity-50 text-white font-medium py-2.5 rounded-lg shadow-sm transition-colors"
              >
                {busy ? "확인 중..." : "확인"}
              </button>
              <button
                onClick={() => {
                  setTotpChallenge(null);
                  setTotpCode("");
                  setErr("");
                }}
                className="w-full text-xs text-slate-500 hover:underline"
              >
                처음으로 돌아가기
              </button>
            </>
          ) : (
          <>
          {setupRequired && (
            <Field label="이름">
              <input
                className={inputCls}
                placeholder="홍길동"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
          )}
          <Field label="이메일">
            <input
              className={inputCls}
              type="email"
              autoComplete="email"
              placeholder="admin@example.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label="비밀번호">
            <PasswordInput
              className={inputCls}
              autoComplete={setupRequired ? "new-password" : "current-password"}
              placeholder={setupRequired ? "10자 이상, 3종 이상 조합" : ""}
              value={form.password}
              onChange={(v) => setForm({ ...form, password: v })}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
            {setupRequired && <PasswordStrength password={form.password} />}
          </Field>

          {!setupRequired && (
            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                checked={rememberId}
                onChange={(e) => setRememberId(e.target.checked)}
              />
              ID 저장
            </label>
          )}

          {err && (
            <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2">
              {err}
              {needsVerify && (
                <button
                  onClick={resend}
                  disabled={busy}
                  className="ml-2 underline hover:opacity-80 disabled:opacity-50"
                >
                  인증 메일 재발송
                </button>
              )}
            </div>
          )}
          {info && (
            <div className="text-xs text-primary-deep bg-primary-soft border border-primary/30 rounded-lg px-3 py-2">
              {info}
            </div>
          )}

          <button
            onClick={submit}
            disabled={busy}
            className="w-full bg-primary hover:bg-primary-deep disabled:opacity-50 text-white font-medium py-2.5 rounded-lg shadow-sm transition-colors"
          >
            {busy
              ? "처리 중..."
              : setupRequired
                ? "관리자 계정 생성"
                : "로그인"}
          </button>

          {!setupRequired && (
            <div className="text-center text-xs text-slate-500 pt-3 border-t border-slate-100 space-y-2">
              <div>
                <Link
                  href="/password-reset"
                  className="text-slate-600 hover:text-primary hover:underline"
                >
                  비밀번호를 잊으셨나요?
                </Link>
              </div>
              <div>
                계정이 없나요?{" "}
                <Link href="/signup" className="text-primary hover:underline">
                  회원가입
                </Link>
              </div>
            </div>
          )}
          </>
          )}
        </div>
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

/**
 * 합류 요청 후 담당자 승인 대기(status=pending) 사용자가 로그인 시도 시 표시.
 * 승인 지연·담당자 연락 두절 시 시스템 운영자에게 법인 권한 부여를 요청하는 동선.
 * 회원가입 시점이 아니라 "로그인하려다 막혔을 때" 노출 — 흐름상 자연스럽고, 본인 메일
 * 소유·비밀번호 검증을 이미 통과한 상태라 요청 주체가 분명하다.
 */
function PendingApprovalPanel({
  info,
  onBack,
}: {
  info: PendingInfo;
  onBack: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [err, setErr] = useState("");

  const [resendBusy, setResendBusy] = useState(false);
  const [resendMsg, setResendMsg] = useState("");

  const resend = async () => {
    setResendMsg("");
    setResendBusy(true);
    const res = await fetch("/api/auth/resend-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: info.requesterEmail }),
    });
    setResendBusy(false);
    setResendMsg(
      res.ok
        ? "인증 메일을 재발송했습니다. 메일함(스팸·정크함 포함)을 확인하세요."
        : "재발송에 실패했습니다. 잠시 후 다시 시도해주세요."
    );
  };

  const submit = async () => {
    setErr("");
    if (info.orgId == null) {
      setErr("법인 정보를 확인할 수 없습니다. 잠시 후 다시 시도해주세요.");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/orgs/admin-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orgId: info.orgId,
        requesterName: info.requesterName ?? info.requesterEmail,
        requesterEmail: info.requesterEmail,
        reason: reason.trim(),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    setSubmitted(true);
  };

  return (
    <div className="space-y-3">
      <div className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-3 leading-relaxed">
        <strong>{info.orgName ?? "법인"}</strong> 합류 승인을 기다리는 중입니다.
        이용하려면 아래 두 단계가 모두 완료되어야 합니다.
      </div>

      {/* 2단계 진행 상태 — 이메일 인증 + 법인 관리자 승인 둘 다 필요 */}
      <div className="text-left bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-3 space-y-3">
        <div className="flex items-start gap-2.5">
          <StepBadge done={info.emailVerified} />
          <div className="flex-1 space-y-1.5">
            <div className="text-xs">
              <strong className="text-slate-800">이메일 인증</strong>{" "}
              {info.emailVerified ? (
                <span className="text-emerald-600 font-medium">완료</span>
              ) : (
                <span className="text-amber-600 font-medium">미완료</span>
              )}
            </div>
            {!info.emailVerified && (
              <>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  가입 시 보낸 인증 메일의 링크를 클릭하세요. 메일이 없으면
                  재발송할 수 있습니다.
                </p>
                <button
                  onClick={resend}
                  disabled={resendBusy}
                  className="text-[11px] text-primary hover:underline font-medium disabled:opacity-50"
                >
                  {resendBusy ? "발송 중..." : "인증 메일 재발송"}
                </button>
                {resendMsg && (
                  <div className="text-[11px] text-primary-deep bg-primary-soft border border-primary/30 rounded px-2 py-1">
                    {resendMsg}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        <div className="flex items-start gap-2.5">
          <StepBadge done={false} />
          <div className="flex-1">
            <div className="text-xs">
              <strong className="text-slate-800">법인 관리자 승인</strong>{" "}
              <span className="text-amber-600 font-medium">대기 중</span>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              담당자가 합류 요청을 검토·승인합니다. 결과는 가입하신 이메일로
              안내됩니다.
            </p>
          </div>
        </div>
      </div>

      {submitted ? (
        <div className="text-xs text-primary-deep bg-primary-soft border border-primary/30 rounded-lg px-3 py-2.5 leading-relaxed">
          운영자에게 권한 부여 요청을 보냈습니다. 신원·재직 증명을 위해 별도
          회신을 드릴 수 있습니다.
        </div>
      ) : !expanded ? (
        <div className="text-xs text-slate-500 leading-relaxed space-y-2">
          <p>
            담당자 승인이 지연되거나 담당자와 연락이 닿지 않나요? 운영자에게 법인
            권한 부여를 요청할 수 있습니다.
          </p>
          <button
            onClick={() => setExpanded(true)}
            className="text-primary hover:underline font-medium"
          >
            운영자에게 권한 부여 요청 →
          </button>
        </div>
      ) : (
        <div className="border border-slate-200 rounded-lg p-3 space-y-2">
          <div className="text-xs font-medium text-slate-700">
            시스템 운영자에게 법인 권한 부여 요청
          </div>
          <div className="text-[11px] text-slate-500">
            신청자: {info.requesterName ? `${info.requesterName} · ` : ""}
            {info.requesterEmail}
          </div>
          <textarea
            className={inputCls + " resize-y min-h-[72px]"}
            placeholder="사유 (예: 회사 인사담당자로 부임, 기존 담당자 퇴사 등). 운영자가 별도 회신으로 증빙을 요청할 수 있습니다."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {err && (
            <div className="text-[11px] text-danger bg-danger-soft border border-danger/30 rounded px-2.5 py-1.5">
              {err}
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={submit}
              disabled={busy}
              className="px-3 py-1.5 text-xs bg-primary hover:bg-primary-deep text-white rounded font-medium disabled:opacity-50"
            >
              {busy ? "전송 중..." : "운영자에게 요청 전송"}
            </button>
            <button
              onClick={() => setExpanded(false)}
              className="px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded border border-slate-300"
            >
              접기
            </button>
          </div>
        </div>
      )}

      <button
        onClick={onBack}
        className="w-full text-xs text-slate-500 hover:underline pt-1"
      >
        다른 계정으로 로그인
      </button>
    </div>
  );
}

// 2단계(이메일 인증 / 법인 승인) 진행 상태 뱃지 — 완료=emerald 체크, 미완료=amber 빈 원.
function StepBadge({ done }: { done: boolean }) {
  return done ? (
    <span className="shrink-0 w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 text-[11px] font-bold flex items-center justify-center mt-0.5">
      ✓
    </span>
  ) : (
    <span className="shrink-0 w-5 h-5 rounded-full border-2 border-amber-300 bg-white mt-0.5" />
  );
}
