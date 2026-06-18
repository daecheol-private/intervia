"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  PasswordStrength,
  passwordMeetsPolicy,
} from "@/app/password-strength";
import LogoutButton from "@/app/logout-button";
import { PasswordInput } from "@/app/components/PasswordInput";

export default function AccountPage() {
  const router = useRouter();
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "error" | "success"; text: string } | null>(null);

  useEffect(() => {
    void fetch("/api/auth/status")
      .then((r) => r.json())
      .then((d) => {
        if (!d.user) {
          router.replace("/login");
          return;
        }
        setUser(d.user);
      });
  }, [router]);

  const submit = async () => {
    setMsg(null);
    if (!form.currentPassword || !form.newPassword) {
      setMsg({ type: "error", text: "현재/새 비밀번호를 모두 입력하세요." });
      return;
    }
    if (!passwordMeetsPolicy(form.newPassword)) {
      setMsg({
        type: "error",
        text:
          "비밀번호 정책 미충족: 10자 이상 + 영문 대/소·숫자·특수문자 중 3종 이상.",
      });
      return;
    }
    if (form.newPassword !== form.confirm) {
      setMsg({ type: "error", text: "새 비밀번호 확인이 일치하지 않습니다." });
      return;
    }
    setBusy(true);
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setMsg({ type: "error", text: await res.text() });
      return;
    }
    setMsg({ type: "success", text: "비밀번호가 변경되었습니다." });
    setForm({ currentPassword: "", newPassword: "", confirm: "" });
  };

  if (!user)
    return (
      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8 text-slate-500">
        불러오는 중...
      </main>
    );

  return (
    <main className="max-w-2xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      <Link href="/" className="text-sm text-slate-500 hover:text-slate-900">
        ← 대시보드
      </Link>
      <h1 className="text-2xl font-bold mt-3 mb-6">계정 설정</h1>

      <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm mb-6">
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
          내 정보
        </h2>
        <div className="space-y-2 text-sm">
          <Row label="이름" value={user.name} />
          <Row label="이메일" value={user.email} />
        </div>
      </section>

      <OrgInfoPanel />

      <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
          비밀번호 변경
        </h2>
        <div className="space-y-4">
          <Field label="현재 비밀번호">
            <PasswordInput
              className={inputCls}
              autoComplete="current-password"
              value={form.currentPassword}
              onChange={(v) => setForm({ ...form, currentPassword: v })}
            />
          </Field>
          <Field label="새 비밀번호">
            <PasswordInput
              className={inputCls}
              autoComplete="new-password"
              placeholder="10자 이상, 3종 이상 조합"
              value={form.newPassword}
              onChange={(v) => setForm({ ...form, newPassword: v })}
            />
            <PasswordStrength password={form.newPassword} />
          </Field>
          <Field label="새 비밀번호 확인">
            <PasswordInput
              className={inputCls}
              autoComplete="new-password"
              value={form.confirm}
              onChange={(v) => setForm({ ...form, confirm: v })}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </Field>

          {msg && (
            <div
              className={`text-xs rounded-lg px-3 py-2 ${
                msg.type === "error"
                  ? "text-danger bg-danger-soft border border-danger/30"
                  : "text-primary-deep bg-primary-soft border border-primary/30"
              }`}
            >
              {msg.text}
            </div>
          )}

          <button
            onClick={submit}
            disabled={busy}
            className="bg-primary hover:bg-primary-deep disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg shadow-sm"
          >
            {busy ? "변경 중..." : "비밀번호 변경"}
          </button>
        </div>
      </section>

      <TwoFactorPanel />
      <SessionsPanel />
      <MarketingEmailPanel />

      <section className="mt-8 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
          로그아웃
        </h2>
        <p className="text-sm text-slate-600 mb-4">
          현재 디바이스의 세션을 종료합니다. 다른 디바이스의 세션은 영향받지 않습니다 — 모든 디바이스를 한 번에 종료하려면 위 "활성 세션" 패널의 "다른 모든 세션 종료" 를 사용하세요.
        </p>
        <LogoutButton variant="full" />
      </section>

      <DangerZone email={user.email} />
    </main>
  );
}

function DangerZone({ email }: { email: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [twoFa, setTwoFa] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    void fetch("/api/account/2fa")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setTwoFa(!!d.enabled);
      });
  }, []);

  const submit = async () => {
    setErr("");
    if (!password) {
      setErr("비밀번호를 입력하세요.");
      return;
    }
    if (twoFa && code.length !== 6) {
      setErr("2단계 인증 6자리 코드를 입력하세요.");
      return;
    }
    if (confirmEmail.trim() !== email.trim()) {
      setErr("확인을 위해 이메일을 정확히 입력하세요.");
      return;
    }
    if (
      !confirm(
        "정말로 계정을 탈퇴하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다. 계정과 로그인 정보, 알림·즐겨찾기·작성한 면접관 메모가 삭제됩니다."
      )
    )
      return;
    setBusy(true);
    const res = await fetch("/api/account", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password,
        code: twoFa ? code : undefined,
        confirm: confirmEmail,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    router.replace("/login");
  };

  return (
    <section className="mt-8 bg-white border border-danger/30 rounded-2xl p-6 shadow-sm">
      <h2 className="text-xs font-semibold text-danger uppercase tracking-wider mb-3">
        계정 탈퇴
      </h2>
      <p className="text-sm text-slate-600 mb-4 leading-relaxed">
        계정을 영구적으로 삭제합니다. <strong>되돌릴 수 없습니다.</strong> 로그인
        정보·알림·즐겨찾기와 본인이 작성한 면접관 메모가 함께 삭제됩니다. 본인이
        등록한 공고·후보자 데이터는 법인에 그대로 보존됩니다.
      </p>

      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="bg-danger-soft border border-danger/30 hover:bg-danger-soft/70 text-danger text-sm font-medium px-5 py-2 rounded-lg transition-colors"
        >
          계정 탈퇴
        </button>
      ) : (
        <div className="space-y-4 border-t border-slate-100 pt-4">
          <Field label="현재 비밀번호">
            <PasswordInput
              className={inputCls}
              autoComplete="current-password"
              value={password}
              onChange={setPassword}
            />
          </Field>
          {twoFa && (
            <Field label="2단계 인증 6자리 코드">
              <input
                className={inputCls}
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
          )}
          <Field label={`확인을 위해 이메일(${email}) 을 입력하세요`}>
            <input
              className={inputCls}
              type="email"
              autoComplete="off"
              placeholder={email}
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
            />
          </Field>

          {err && (
            <div className="text-xs rounded-lg px-3 py-2 text-danger bg-danger-soft border border-danger/30 whitespace-pre-line">
              {err}
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={submit}
              disabled={busy}
              className="bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg shadow-sm"
            >
              {busy ? "처리 중..." : "영구 삭제"}
            </button>
            <button
              onClick={() => {
                setOpen(false);
                setPassword("");
                setCode("");
                setConfirmEmail("");
                setErr("");
              }}
              className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium px-5 py-2 rounded-lg border border-slate-300"
            >
              취소
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function TwoFactorPanel() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [setup, setSetup] = useState<{ secret: string; url: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "error" | "success"; text: string } | null>(null);

  const load = async () => {
    const r = await fetch("/api/account/2fa");
    if (r.ok) {
      const d = (await r.json()) as { enabled: boolean };
      setEnabled(d.enabled);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const startSetup = async () => {
    setMsg(null);
    setBusy(true);
    const r = await fetch("/api/account/2fa/setup", { method: "POST" });
    setBusy(false);
    if (!r.ok) {
      setMsg({ type: "error", text: await r.text() });
      return;
    }
    const d = (await r.json()) as {
      secret: string;
      otpauthUrl: string;
      qrDataUrl: string;
    };
    setSetup({ secret: d.secret, url: d.otpauthUrl, qr: d.qrDataUrl });
  };

  const enableConfirm = async () => {
    if (!setup) return;
    setMsg(null);
    setBusy(true);
    const r = await fetch("/api/account/2fa/enable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: setup.secret, code }),
    });
    setBusy(false);
    if (!r.ok) {
      setMsg({ type: "error", text: await r.text() });
      return;
    }
    setSetup(null);
    setCode("");
    setEnabled(true);
    setMsg({ type: "success", text: "2단계 인증이 활성화되었습니다." });
  };

  const disable = async () => {
    setMsg(null);
    if (!pw || !code) {
      setMsg({ type: "error", text: "비밀번호와 인증 코드 둘 다 입력하세요." });
      return;
    }
    if (!confirm("2단계 인증을 해제하시겠습니까?")) return;
    setBusy(true);
    const r = await fetch("/api/account/2fa/disable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw, code }),
    });
    setBusy(false);
    if (!r.ok) {
      setMsg({ type: "error", text: await r.text() });
      return;
    }
    setEnabled(false);
    setPw("");
    setCode("");
    setMsg({ type: "success", text: "2단계 인증이 해제되었습니다." });
  };

  if (enabled === null) return null;

  return (
    <section className="mt-8 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
      <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
        2단계 인증 (TOTP)
      </h2>
      {enabled ? (
        <div className="space-y-3">
          <div className="text-sm text-primary-deep bg-primary-soft border border-primary/30 rounded-lg px-3 py-2">
            2단계 인증이 <strong>활성화</strong>되어 있습니다. 로그인 시 Authenticator 앱의 6자리 코드가 필요합니다.
          </div>
          <div className="border-t border-slate-100 pt-4 space-y-3">
            <p className="text-sm text-slate-600 font-medium">2단계 인증 해제</p>
            <Field label="현재 비밀번호">
              <PasswordInput
                className={inputCls}
                autoComplete="current-password"
                value={pw}
                onChange={setPw}
              />
            </Field>
            <Field label="현재 6자리 인증 코드">
              <input
                className={inputCls}
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
            {msg && (
              <div
                className={`text-xs rounded-lg px-3 py-2 ${
                  msg.type === "error"
                    ? "text-danger bg-danger-soft border border-danger/30"
                    : "text-primary-deep bg-primary-soft border border-primary/30"
                }`}
              >
                {msg.text}
              </div>
            )}
            <button
              onClick={disable}
              disabled={busy}
              className="bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg shadow-sm"
            >
              {busy ? "처리 중..." : "2단계 인증 해제"}
            </button>
          </div>
        </div>
      ) : setup ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            <strong>Google Authenticator</strong> 앱을 열고 우하단 <strong>+</strong> 버튼 → <strong>QR 코드 스캔</strong>으로 아래 QR을 찍어주세요. 스캔할 수 없는 환경이면 아래 시크릿을 수동 입력하세요.
          </p>
          <div className="flex flex-col items-center bg-white border border-slate-200 rounded-xl p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={setup.qr}
              alt="2단계 인증 QR 코드"
              className="w-60 h-60"
            />
            <div className="text-[11px] text-slate-500 mt-2">
              스캔 후 앱에 표시되는 6자리 코드를 아래에 입력하면 활성화됩니다.
            </div>
          </div>
          <details className="text-xs">
            <summary className="cursor-pointer text-slate-500 hover:text-slate-700">
              스캔이 안 되나요? 시크릿 수동 입력
            </summary>
            <div className="mt-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 space-y-1.5">
              <div className="text-slate-500">시크릿</div>
              <code className="font-mono text-sm break-all select-all">{setup.secret}</code>
              <div className="text-slate-500 pt-2">otpauth 링크 (모바일에서 직접 클릭)</div>
              <a
                href={setup.url}
                className="font-mono text-xs text-primary hover:underline break-all"
              >
                {setup.url}
              </a>
            </div>
          </details>
          <Field label="앱에 표시된 6자리 코드">
            <input
              className={inputCls}
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && enableConfirm()}
            />
          </Field>
          {msg && (
            <div
              className={`text-xs rounded-lg px-3 py-2 ${
                msg.type === "error"
                  ? "text-danger bg-danger-soft border border-danger/30"
                  : "text-primary-deep bg-primary-soft border border-primary/30"
              }`}
            >
              {msg.text}
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={enableConfirm}
              disabled={busy || code.length !== 6}
              className="bg-primary hover:bg-primary-deep disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg shadow-sm"
            >
              {busy ? "처리 중..." : "활성화"}
            </button>
            <button
              onClick={() => {
                setSetup(null);
                setCode("");
                setMsg(null);
              }}
              className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium px-5 py-2 rounded-lg border border-slate-300"
            >
              취소
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            로그인 시 비밀번호 외에 Authenticator 앱의 6자리 코드를 한 번 더 요구합니다. 보안 강화를 위해 권장됩니다 (특히 시스템관리자).
          </p>
          {msg && (
            <div
              className={`text-xs rounded-lg px-3 py-2 ${
                msg.type === "error"
                  ? "text-danger bg-danger-soft border border-danger/30"
                  : "text-primary-deep bg-primary-soft border border-primary/30"
              }`}
            >
              {msg.text}
            </div>
          )}
          <button
            onClick={startSetup}
            disabled={busy}
            className="bg-primary hover:bg-primary-deep disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg shadow-sm"
          >
            {busy ? "처리 중..." : "2단계 인증 설정 시작"}
          </button>
        </div>
      )}
    </section>
  );
}

type Session = {
  displayId: string;
  isCurrent: boolean;
  ip: string | null;
  browser: string;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  expiresAt: string;
};

function SessionsPanel() {
  const [list, setList] = useState<Session[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const load = async () => {
    setErr("");
    const r = await fetch("/api/auth/sessions");
    if (!r.ok) {
      setErr(await r.text());
      return;
    }
    setList(await r.json());
  };

  useEffect(() => {
    void load();
  }, []);

  const revoke = async (id: string) => {
    if (!confirm("해당 디바이스 세션을 종료할까요?")) return;
    setBusy(id);
    const r = await fetch(`/api/auth/sessions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    setBusy(null);
    if (!r.ok) {
      setErr(await r.text());
      return;
    }
    void load();
  };

  const revokeOthers = async () => {
    if (!confirm("현재 디바이스를 제외한 모든 세션을 종료할까요?")) return;
    setBusy("__all__");
    const r = await fetch("/api/auth/sessions/revoke-others", {
      method: "POST",
    });
    setBusy(null);
    if (!r.ok) {
      setErr(await r.text());
      return;
    }
    void load();
  };

  const fmt = (s: string | null) =>
    s ? new Date(s).toLocaleString("ko-KR") : "-";

  return (
    <section className="mt-8 bg-white rounded-2xl border border-slate-200 shadow-sm">
      <header className="px-6 py-5 border-b border-slate-100 flex justify-between items-center">
        <div>
          <h2 className="text-base font-semibold text-slate-900">활성 세션</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            로그인된 디바이스 목록. 모르는 세션이 있으면 즉시 종료하세요.
          </p>
        </div>
        {list && list.length > 1 && (
          <button
            onClick={revokeOthers}
            disabled={busy === "__all__"}
            className="text-xs px-3 py-1.5 rounded-md border border-danger/30 text-danger hover:bg-danger-soft disabled:opacity-50 transition-colors"
          >
            {busy === "__all__" ? "처리 중..." : "다른 모든 세션 종료"}
          </button>
        )}
      </header>
      <div className="px-6 py-4">
        {err && (
          <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2 mb-3">
            {err}
          </div>
        )}
        {!list ? (
          <div className="text-sm text-slate-500">불러오는 중...</div>
        ) : list.length === 0 ? (
          <div className="text-sm text-slate-500">활성 세션 없음.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.map((s) => (
              <li
                key={s.displayId}
                className="py-3 flex items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-900">
                      {s.browser}
                    </span>
                    {s.isCurrent && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary-soft text-primary-deep font-medium">
                        현재 세션
                      </span>
                    )}
                  </div>
                  <div
                    className="text-[11px] text-slate-500 mt-0.5 truncate"
                    title={s.userAgent ?? ""}
                  >
                    {s.ip ? `IP ${s.ip} · ` : ""}
                    최근 활동 {fmt(s.lastSeenAt)} · 로그인 {fmt(s.createdAt)} ·
                    만료 {fmt(s.expiresAt)}
                  </div>
                </div>
                {!s.isCurrent && (
                  <button
                    onClick={() => revoke(s.displayId)}
                    disabled={busy === s.displayId}
                    className="text-xs px-3 py-1 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50 shrink-0"
                  >
                    {busy === s.displayId ? "종료 중..." : "세션 종료"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function MarketingEmailPanel() {
  const [optIn, setOptIn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "error" | "success"; text: string } | null>(null);

  useEffect(() => {
    void fetch("/api/account/marketing-consent")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setOptIn(!!d.optIn);
      });
  }, []);

  const toggle = async () => {
    if (optIn === null || busy) return;
    const next = !optIn;
    setBusy(true);
    setMsg(null);
    const r = await fetch("/api/account/marketing-consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ optIn: next }),
    });
    setBusy(false);
    if (!r.ok) {
      setMsg({ type: "error", text: await r.text() });
      return;
    }
    setOptIn(next);
    setMsg({
      type: "success",
      text: next
        ? "마케팅 메일 수신에 동의했습니다."
        : "마케팅 메일 수신을 해지했습니다. 더 이상 광고성 메일을 받지 않습니다.",
    });
  };

  if (optIn === null) return null;

  return (
    <section className="mt-8 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
      <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
        마케팅 메일 수신
      </h2>
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-slate-600 leading-relaxed">
          제품 소식·이벤트 등 마케팅(광고성) 메일 수신 여부입니다. 끄면 즉시 수신거부
          처리됩니다. 면접 일정·합격 통지 등 서비스 운영·계정 관련 안내 메일은 이 설정과
          무관하게 계속 발송됩니다.
        </p>
        <button
          type="button"
          role="switch"
          aria-checked={optIn}
          onClick={toggle}
          disabled={busy}
          className={`relative shrink-0 inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
            optIn ? "bg-primary" : "bg-slate-300"
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              optIn ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>
      {msg && (
        <div
          className={`mt-3 text-xs rounded-lg px-3 py-2 ${
            msg.type === "error"
              ? "text-danger bg-danger-soft border border-danger/30"
              : "text-primary-deep bg-primary-soft border border-primary/30"
          }`}
        >
          {msg.text}
        </div>
      )}
    </section>
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span className="w-20 text-slate-500">{label}</span>
      <span className="text-slate-900">{value}</span>
    </div>
  );
}

function OrgInfoPanel() {
  type Org = {
    id: number | null;
    name?: string;
    emailDomain?: string | null;
    officeAddress?: string | null;
    officeAddressDetail?: string | null;
  };
  const [org, setOrg] = useState<Org | null>(null);
  const [canEdit, setCanEdit] = useState(false);

  const load = async () => {
    const [orgRes, statusRes] = await Promise.all([
      fetch("/api/orgs/me"),
      fetch("/api/auth/status"),
    ]);
    if (orgRes.ok) {
      const o = (await orgRes.json()) as Org;
      setOrg(o);
    }
    if (statusRes.ok) {
      const s = await statusRes.json();
      setCanEdit(
        s.user?.role === "org_admin" || s.user?.role === "system_admin"
      );
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (!org || !org.id) return null;

  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm mb-6">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          소속 법인
        </h2>
        {canEdit && (
          <Link
            href="/org/settings"
            className="text-xs text-primary hover:underline"
          >
            법인 설정에서 수정 →
          </Link>
        )}
      </div>
      <div className="space-y-2 text-sm">
        <Row label="법인명" value={org.name ?? "-"} />
        {org.emailDomain && (
          <Row label="이메일 도메인" value={org.emailDomain} />
        )}
        <Row label="회사 주소" value={org.officeAddress ?? "(미설정)"} />
        {org.officeAddressDetail && (
          <Row label="상세 주소" value={org.officeAddressDetail} />
        )}
        {!org.officeAddress && (
          <p className="text-[11px] text-slate-500 bg-slate-50 rounded-md px-3 py-2 mt-1">
            오프라인 면접 일정 메일에 회사 주소가 포함됩니다.
            {canEdit
              ? " 법인 설정에서 등록해 두면 매번 입력하지 않아도 됩니다."
              : " 법인 관리자에게 등록을 요청하세요."}
          </p>
        )}
        {canEdit && (
          <p className="text-[11px] text-slate-500 bg-slate-50 rounded-md px-3 py-2 mt-1">
            회사 주소·스캔 PDF AI OCR 등 법인 단위 설정은{" "}
            <Link href="/org/settings" className="text-primary hover:underline">
              법인 설정
            </Link>
            에서 변경할 수 있습니다.
          </p>
        )}
      </div>
    </section>
  );
}
