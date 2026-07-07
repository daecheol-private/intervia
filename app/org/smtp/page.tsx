"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DesktopOnlyNotice } from "@/app/components/DesktopOnlyNotice";
import { PasswordInput } from "@/app/components/PasswordInput";
import { formatLocalDateTime } from "@/lib/utils";

type SmtpConfig = {
  orgId: number;
  host: string;
  port: number;
  secure: boolean;
  authUser: string;
  authPass: string; // 마스킹된 값
  fromEmail: string;
  fromName: string | null;
  lastCheckedAt: string | null;
  lastCheckStatus: "ok" | "fail" | null;
  lastCheckError: string | null;
};

export default function OrgSmtpPage() {
  const [loaded, setLoaded] = useState(false);
  const [host, setHost] = useState("");
  const [port, setPort] = useState(465);
  const [secure, setSecure] = useState(true);
  const [authUser, setAuthUser] = useState("");
  const [authPass, setAuthPass] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [lastChecked, setLastChecked] = useState<SmtpConfig | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null
  );
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const r = await fetch("/api/orgs/smtp");
    setLoaded(true);
    if (!r.ok) return;
    const data = (await r.json()) as SmtpConfig | null;
    if (!data) return;
    setHost(data.host);
    setPort(data.port);
    setSecure(data.secure);
    setAuthUser(data.authUser);
    setAuthPass(data.authPass);
    setFromEmail(data.fromEmail);
    setFromName(data.fromName ?? "");
    setLastChecked(data);
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/orgs/smtp", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        host,
        port,
        secure,
        authUser,
        authPass,
        fromEmail,
        fromName: fromName || null,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setMsg({ kind: "err", text: await res.text() });
      return;
    }
    const data = (await res.json()) as { ok: boolean; error: string | null };
    if (data.ok) {
      setMsg({ kind: "ok", text: "저장 완료. 헬스체크 통과." });
    } else {
      setMsg({
        kind: "err",
        text: `저장됨, 단 헬스체크 실패: ${data.error}`,
      });
    }
    void load();
  };

  const remove = async () => {
    if (!confirm("SMTP 설정을 삭제할까요? 이후 면접 메일은 시스템 기본 서버로 발송됩니다."))
      return;
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/orgs/smtp", { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      setMsg({ kind: "err", text: await res.text() });
      return;
    }
    setHost("");
    setPort(465);
    setSecure(true);
    setAuthUser("");
    setAuthPass("");
    setFromEmail("");
    setFromName("");
    setLastChecked(null);
    setMsg({ kind: "ok", text: "삭제 완료" });
  };

  const isGmail = /gmail|googlemail/i.test(host);
  const isNaver = /naver/i.test(host);
  const isKakao = /kakao|daum/i.test(host);
  const isOutlook = /outlook|office365|hotmail|live/i.test(host);

  return (
    <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-6">
        <Link href="/org/settings" className="text-xs text-ink-muted hover:underline">
          ← 법인 설정
        </Link>
        <h1 className="text-2xl font-bold text-ink mt-2">메일 서버 설정</h1>
        <p className="text-sm text-ink-muted mt-1">
          법인의 SMTP 서버를 등록하면 면접 안내 메일이 이 서버를 통해 발송됩니다.
          미설정 시 시스템 기본 서버를 사용합니다.
        </p>
      </div>

      {/* 모바일: 메일 서버 설정은 데스크톱 전용 — 안내만 노출 */}
      <div className="sm:hidden">
        <DesktopOnlyNotice
          title="메일 서버 설정은 PC에서"
          description="SMTP 서버 등록·검증은 PC(데스크톱)에서 진행해 주세요."
        />
      </div>

      <div className="hidden sm:block">
      {!loaded ? (
        <div className="text-sm text-ink-muted">불러오는 중...</div>
      ) : (
        <div className="bg-card border border-border-default rounded-2xl p-6 shadow-sm space-y-4">
          {lastChecked && (
            <div
              className={`text-xs px-3 py-2 rounded-lg border ${
                lastChecked.lastCheckStatus === "ok"
                  ? "bg-primary-soft border-primary/30 text-primary-deep"
                  : "bg-danger-soft border-danger/30 text-danger"
              }`}
            >
              마지막 헬스체크: {lastChecked.lastCheckStatus === "ok" ? "✓ 정상" : "✗ 실패"}
              {lastChecked.lastCheckError ? ` — ${lastChecked.lastCheckError}` : ""}
              {lastChecked.lastCheckedAt
                ? ` (${formatLocalDateTime(lastChecked.lastCheckedAt)})`
                : ""}
              {lastChecked.lastCheckStatus === "fail" &&
                lastChecked.lastCheckError && (
                  <ErrorGuide
                    error={lastChecked.lastCheckError}
                    host={lastChecked.host}
                  />
                )}
            </div>
          )}

          <Row label="SMTP 호스트">
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="smtp.gmail.com"
              className="w-full border border-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </Row>
          <div className="grid grid-cols-2 gap-3">
            <Row label="포트">
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                className="w-full border border-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </Row>
            <Row label="보안 (SSL/TLS)">
              <label className="flex items-center gap-2 text-sm h-[42px]">
                <input
                  type="checkbox"
                  checked={secure}
                  onChange={(e) => setSecure(e.target.checked)}
                />
                <span className="text-ink-soft">
                  {secure ? "사용 (465)" : "미사용 (587 STARTTLS 등)"}
                </span>
              </label>
            </Row>
          </div>
          <Row label="계정 (Username)">
            <input
              value={authUser}
              onChange={(e) => setAuthUser(e.target.value)}
              placeholder="account@yourcompany.com"
              className="w-full border border-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </Row>
          <Row label="비밀번호">
            <PasswordInput
              value={authPass}
              onChange={setAuthPass}
              placeholder={lastChecked ? "변경 시에만 입력" : "앱 비밀번호 권장"}
              className="w-full border border-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              autoComplete="new-password"
            />
            <p className="text-[11px] text-ink-muted mt-1">
              저장된 비밀번호는 마스킹되어 보입니다. 변경하려면 새 값을 입력하세요.
              {!authPass.includes("*") && /\s/.test(authPass) && (
                <span className="ml-1 text-warning">
                  ⚠️ 공백이 포함되어 있습니다 — 저장 시 자동 제거됩니다 (Gmail 앱 비밀번호 OK).
                </span>
              )}
              {!authPass.includes("*") &&
                authPass.length > 0 &&
                authPass.replace(/\s/g, "").length !== 16 &&
                isGmail && (
                  <span className="ml-1 text-warning">
                    ⚠️ Gmail 앱 비밀번호는 정확히 16자입니다 (현재{" "}
                    {authPass.replace(/\s/g, "").length}자).
                  </span>
                )}
            </p>
            {(isGmail || isNaver || isKakao || isOutlook) && (
              <ProviderHint
                provider={
                  isGmail ? "gmail" : isNaver ? "naver" : isKakao ? "kakao" : "outlook"
                }
              />
            )}
          </Row>
          <Row label="발신 이메일 (From)">
            <input
              value={fromEmail}
              onChange={(e) => setFromEmail(e.target.value)}
              placeholder="hr@yourcompany.com"
              className="w-full border border-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </Row>
          <Row label="발신자 이름 (선택)">
            <input
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
              placeholder="채용팀"
              className="w-full border border-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </Row>

          {msg && (
            <div
              className={`text-xs px-3 py-2 rounded-lg border ${
                msg.kind === "ok"
                  ? "bg-primary-soft border-primary/30 text-primary-deep"
                  : "bg-danger-soft border-danger/30 text-danger"
              }`}
            >
              {msg.text}
              {msg.kind === "err" && <ErrorGuide error={msg.text} host={host} />}
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <button
              onClick={save}
              disabled={busy}
              className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-surface text-sm font-medium disabled:opacity-50"
            >
              {busy ? "처리 중..." : "저장 및 헬스체크"}
            </button>
            {lastChecked && (
              <button
                onClick={remove}
                disabled={busy}
                className="ml-auto px-4 py-2 rounded-lg border border-danger/30 text-danger hover:bg-danger-soft text-sm disabled:opacity-50 transition-colors"
              >
                삭제
              </button>
            )}
          </div>
        </div>
      )}
      </div>

    </main>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-ink-soft mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

type Provider = "gmail" | "naver" | "kakao" | "outlook";

const PROVIDER_GUIDES: Record<
  Provider,
  { title: string; host: string; port: string; steps: string[]; url: string }
> = {
  gmail: {
    title: "Gmail SMTP",
    host: "smtp.gmail.com",
    port: "465 (SSL) 또는 587 (STARTTLS)",
    steps: [
      "2단계 인증을 먼저 켭니다 (myaccount.google.com → 보안 → 2단계 인증).",
      "앱 비밀번호를 발급합니다 (myaccount.google.com/apppasswords).",
      "발급된 16자리 비밀번호를 위 [비밀번호] 칸에 붙여넣기 (공백 제거).",
      "일반 Gmail 비밀번호로는 절대 인증되지 않습니다.",
    ],
    url: "https://myaccount.google.com/apppasswords",
  },
  naver: {
    title: "네이버 SMTP",
    host: "smtp.naver.com",
    port: "465 (SSL) 또는 587 (STARTTLS)",
    steps: [
      "네이버 메일 → 환경설정 → POP3/IMAP 설정 → 'POP3/SMTP 사용함' 체크.",
      "보안을 위해 [애플리케이션 비밀번호] 발급 후 사용 권장.",
      "내정보 → 보안설정 → 애플리케이션 비밀번호 관리에서 발급.",
    ],
    url: "https://mail.naver.com/option/imapPop",
  },
  kakao: {
    title: "Daum/카카오 SMTP",
    host: "smtp.daum.net",
    port: "465 (SSL) 또는 587 (STARTTLS)",
    steps: [
      "Daum 메일 → 환경설정 → IMAP/POP3에서 SMTP 사용함 활성화.",
      "보안 강화를 위해 별도 앱 비밀번호 사용 권장.",
    ],
    url: "https://mail.daum.net/hanmailex/Pop3SmtpSetting.daum",
  },
  outlook: {
    title: "Outlook / Microsoft 365 SMTP",
    host: "smtp-mail.outlook.com 또는 smtp.office365.com",
    port: "587 (STARTTLS, SSL 체크 해제)",
    steps: [
      "MS 계정 2단계 인증 사용 중이면 앱 비밀번호 발급 필요.",
      "account.microsoft.com → 보안 → 추가 보안 옵션 → 앱 비밀번호 만들기.",
      "포트는 587, SSL 체크박스는 해제 (STARTTLS 사용).",
    ],
    url: "https://account.microsoft.com/security",
  },
};

function ProviderHint({ provider }: { provider: Provider }) {
  const g = PROVIDER_GUIDES[provider];
  return (
    <div className="mt-2 text-xs bg-primary-soft border border-primary/30 text-primary-deep rounded-lg px-3 py-2 leading-relaxed">
      <div className="font-semibold mb-1">💡 {g.title} 설정 안내</div>
      <ul className="list-disc list-inside space-y-0.5">
        {g.steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ul>
      <a
        href={g.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block mt-1.5 text-primary-deep hover:text-primary-deep underline"
      >
        설정 페이지 열기 →
      </a>
    </div>
  );
}

function diagnose(error: string, host: string): { title: string; tip: string; url?: string } | null {
  const e = error.toLowerCase();
  if (/application-specific password|invalidsecondfactor/.test(e)) {
    return {
      title: "Gmail 앱 비밀번호가 필요합니다",
      tip:
        "일반 Gmail 비밀번호로는 인증이 불가능합니다. 2단계 인증을 켠 뒤 myaccount.google.com/apppasswords 에서 16자리 앱 비밀번호를 발급받아 입력하세요.",
      url: "https://myaccount.google.com/apppasswords",
    };
  }
  if (/badcredentials|username and password not accepted/.test(e)) {
    if (/gmail|googlemail/i.test(host))
      return {
        title: "Gmail 비밀번호가 맞지 않습니다",
        tip:
          "✅ 체크리스트: ① 2단계 인증이 실제로 켜져 있는지, ② 앱 비밀번호 발급한 그 계정과 [계정] 칸의 이메일이 동일한지, ③ 16자리 앱 비밀번호를 정확히 복사했는지 (공백은 자동 제거됨), ④ 앱 비밀번호가 폐기되지 않았는지. 새 앱 비밀번호를 재발급해서 다시 시도해 보세요.",
        url: "https://myaccount.google.com/apppasswords",
      };
    return {
      title: "비밀번호가 맞지 않습니다",
      tip: "계정과 비밀번호가 정확히 일치하는지 확인하세요.",
    };
  }
  if (/535|invalid login|authentication failed|auth.*fail/.test(e)) {
    if (/gmail|googlemail/i.test(host))
      return {
        title: "Gmail 인증 실패",
        tip:
          "16자리 앱 비밀번호인지 확인하세요 (일반 비밀번호로는 불가). 계정에 2단계 인증이 켜져 있어야 발급 가능합니다.",
        url: "https://myaccount.google.com/apppasswords",
      };
    return {
      title: "인증 실패",
      tip: "계정/비밀번호를 다시 확인하세요. 일부 메일 서버는 별도의 앱 비밀번호 또는 SMTP 권한 설정이 필요합니다.",
    };
  }
  if (/timeout|etimedout|enetunreach|econnrefused|getaddrinfo/.test(e)) {
    return {
      title: "서버 연결 실패",
      tip:
        "호스트/포트가 정확한지 확인하세요. 회사 방화벽이나 ISP가 SMTP 포트(465/587/25)를 차단했을 수도 있습니다.",
    };
  }
  if (/self.signed|certificate|cert/.test(e)) {
    return {
      title: "TLS 인증서 문제",
      tip: "사설 SMTP 인 경우 발생할 수 있습니다. 시스템 관리자에게 문의하세요.",
    };
  }
  if (/relay|not permitted|sender.*reject/.test(e)) {
    return {
      title: "발신 권한 거부",
      tip:
        "발신 이메일(From) 주소가 SMTP 계정과 다른 도메인이면 거부될 수 있습니다. From 주소를 SMTP 계정과 같은 도메인으로 맞춰 보세요.",
    };
  }
  return null;
}

function ErrorGuide({ error, host }: { error: string; host: string }) {
  const d = diagnose(error, host);
  if (!d) return null;
  return (
    <div className="mt-2 px-3 py-2 rounded-md bg-card border border-danger/30 text-danger">
      <div className="font-semibold">📍 {d.title}</div>
      <div className="mt-0.5 text-[11px] leading-relaxed">{d.tip}</div>
      {d.url && (
        <a
          href={d.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block mt-1 text-[11px] text-danger underline hover:opacity-80"
        >
          해결 페이지 열기 →
        </a>
      )}
    </div>
  );
}
