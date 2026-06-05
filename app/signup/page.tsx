"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PasswordStrength } from "@/app/password-strength";
import { LogoMark } from "@/app/components/Logo";
import { PasswordInput } from "@/app/components/PasswordInput";
import { isPublicDomain, getEmailDomain } from "@/lib/email-domain";
import { COMPANY_INFO } from "@/lib/site-info";

type CheckResponse = {
  available: boolean;
  reason?: string;
  domain?: string | null;
  isPublicDomain?: boolean;
  matchedOrg?: { id: number; name: string } | null;
  admins?: Array<{ email: string; name: string }>;
  matchedOrgs?: Array<{
    id: number;
    name: string;
    verificationStatus:
      | "dart_matched"
      | "verified"
      | "pending_review"
      | "rejected";
    bizRegistrationNo: string | null;
    admins: Array<{ email: string; name: string }>;
  }>;
  suggestion?: "login" | "join" | "create_or_search" | "choose_match";
};

type OrgSearchResult = {
  id: number;
  name: string;
  bizRegistrationNo: string | null;
  emailDomain: string | null;
};

// /api/orgs/match 응답 — 중복 등록 의심 법인 (결정적 + LLM)
type MatchCandidate = {
  id: number;
  name: string;
  bizRegistrationNo: string | null;
  emailDomain: string | null;
  reason?: string;
};

type AdminInfo = { email: string; name: string };
type MatchedOrgFull = NonNullable<CheckResponse["matchedOrgs"]>[number];
type Stage =
  | { kind: "check" }
  | { kind: "join"; org: { id: number; name: string }; admins: AdminInfo[] }
  | { kind: "choose" }
  | { kind: "create" }
  | { kind: "search"; results: OrgSearchResult[]; q: string }
  | { kind: "choose_match"; orgs: MatchedOrgFull[] }
  | { kind: "match_suggest"; orgs: MatchCandidate[] }
  | {
      kind: "done";
      title: string;
      body: string;
      // 인증 메일 복구 동선을 띄울 대상 이메일 (법인 신규 등록 경로에서만 설정).
      // 회사 메일서버가 인증 메일을 차단해도 "재가입" 대신 재발송/문의로 유도 — 법인 중복 생성 방지.
      verifyEmail?: string;
      mailSent?: boolean;
    };

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [stage, setStage] = useState<Stage>({ kind: "check" });
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [bizNo, setBizNo] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [resendInfo, setResendInfo] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [ageOver14, setAgeOver14] = useState(false);

  useEffect(() => {
    void fetch("/api/auth/status")
      .then((r) => r.json())
      .then((d) => {
        if (d.user) router.replace("/");
      });
  }, [router]);

  // 입력된 이메일이 공용도메인(gmail/naver/...)인지 — 사업자번호 필수 여부 결정에 사용
  const emailDomainIsPublic = isPublicDomain(getEmailDomain(email));

  const checkEmail = async () => {
    setErr("");
    setInfo("");
    if (!email) {
      setErr("이메일을 입력하세요.");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/auth/check-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setBusy(false);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    const data = (await res.json()) as CheckResponse;
    if (!data.available) {
      if (data.reason === "public_email") {
        setErr(
          "회사(법인) 이메일로만 가입할 수 있습니다. gmail · naver 등 공용 이메일은 사용할 수 없습니다. 회사 도메인 이메일(you@회사.com)로 다시 시도해 주세요."
        );
      } else {
        setErr("이미 가입된 이메일입니다. 로그인해주세요.");
      }
      return;
    }
    const list = data.matchedOrgs ?? [];
    if (list.length >= 2) {
      setStage({ kind: "choose_match", orgs: list });
    } else if (data.matchedOrg) {
      setStage({
        kind: "join",
        org: data.matchedOrg,
        admins: data.admins ?? [],
      });
    } else {
      setStage({ kind: "choose" });
    }
  };

  // 검색 결과로 들어가는 경로 — admin 정보 없으니 한 번 더 조회
  const enterJoinFromSearch = async (org: { id: number; name: string }) => {
    // best-effort 로 admin 조회: check-email 이 email 필요하므로 별도 endpoint 호출
    let admins: AdminInfo[] = [];
    try {
      const r = await fetch(`/api/orgs/${org.id}/admins`);
      if (r.ok) admins = (await r.json()) as AdminInfo[];
    } catch {
      /* ignore — 표시 없이 진행 */
    }
    setStage({ kind: "join", org, admins });
  };

  const submitJoin = async (orgId: number) => {
    setErr("");
    if (!name || !password) {
      setErr("이름/비밀번호 필수");
      return;
    }
    if (!acceptTerms || !acceptPrivacy) {
      setErr("이용약관과 처리방침에 동의해야 합니다.");
      return;
    }
    if (!ageOver14) {
      setErr("만 14세 이상만 가입할 수 있습니다.");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/orgs/join-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orgId,
        email,
        password,
        name,
        acceptTerms,
        acceptPrivacy,
        ageOver14,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    setInfo("");
    setStage({
      kind: "done",
      title: "합류 요청이 접수되었습니다",
      body: "법인 관리자가 승인하면 로그인할 수 있습니다. 승인 결과는 입력하신 이메일로 안내됩니다.",
    });
  };

  const submitCreate = async (force = false) => {
    setErr("");
    if (!name || !password || !orgName) {
      setErr("법인명/이름/비밀번호 필수");
      return;
    }
    if (!acceptTerms || !acceptPrivacy) {
      setErr("이용약관과 처리방침에 동의해야 합니다.");
      return;
    }
    if (!ageOver14) {
      setErr("만 14세 이상만 가입할 수 있습니다.");
      return;
    }

    // 중복 법인 탐지 — 제출 직전 1회 (결정적 + LLM). "강행" 시 건너뜀.
    // 매칭 호출 실패는 가입을 막지 않음(graceful) — 등록 진행.
    if (!force) {
      setBusy(true);
      try {
        const mres = await fetch("/api/orgs/match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orgName, bizNo: bizNo || undefined }),
        });
        if (mres.ok) {
          const { matches } = (await mres.json()) as { matches: MatchCandidate[] };
          if (matches && matches.length > 0) {
            setBusy(false);
            setStage({ kind: "match_suggest", orgs: matches });
            return;
          }
        }
      } catch {
        /* graceful — 매칭 실패해도 등록 진행 */
      }
      setBusy(false);
    }

    setBusy(true);
    const res = await fetch("/api/orgs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orgName,
        bizRegistrationNo: bizNo || undefined,
        email,
        password,
        name,
        acceptTerms,
        acceptPrivacy,
        ageOver14,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    setInfo("");
    const data = (await res.json().catch(() => ({}))) as { mailSent?: boolean };
    setStage({
      kind: "done",
      title: "법인이 등록되었습니다",
      body: "입력하신 이메일로 인증 메일을 보냈습니다. 메일의 링크를 클릭한 뒤 로그인해주세요.",
      verifyEmail: email,
      mailSent: data?.mailSent !== false,
    });
  };

  // 가입 완료 화면 재발송 — 회사 메일서버 차단/지연 시 "재가입" 대신 복구.
  const resendVerification = async (targetEmail: string) => {
    setResendInfo("");
    setErr("");
    setBusy(true);
    const res = await fetch("/api/auth/resend-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: targetEmail }),
    });
    setBusy(false);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    setResendInfo("인증 메일을 재발송했습니다. 메일함(스팸·정크함 포함)을 확인해주세요.");
  };

  const runSearch = async () => {
    setErr("");
    if (searchQ.trim().length < 2) {
      setErr("2글자 이상 입력하세요.");
      return;
    }
    setBusy(true);
    const res = await fetch(
      `/api/orgs/search?q=${encodeURIComponent(searchQ.trim())}`
    );
    setBusy(false);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    const results = (await res.json()) as OrgSearchResult[];
    setStage({ kind: "search", results, q: searchQ });
  };

  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <LogoMark size={48} className="mx-auto mb-3 shadow-lg" />
          <h1 className="text-xl font-bold text-slate-900">회원가입</h1>
          <p className="text-sm text-slate-500 mt-1">
            법인 계정에 합류하거나 새 법인을 등록합니다
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
          {stage.kind === "done" ? (
            <div className="text-center py-4 space-y-4">
              <div className="w-12 h-12 rounded-full bg-primary-soft mx-auto flex items-center justify-center text-primary text-2xl">
                ✓
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  {stage.title}
                </h2>
                <p className="text-sm text-slate-600 mt-2 leading-relaxed">
                  {stage.body}
                </p>
              </div>
              {stage.verifyEmail && (
                <div className="text-left bg-amber-50 border border-amber-200 rounded-lg px-3 py-3 text-xs text-amber-900 leading-relaxed space-y-2">
                  {stage.mailSent === false && (
                    <div className="font-semibold text-danger">
                      ⚠️ 인증 메일 발송에 실패했습니다. 아래 “인증 메일 재발송”을 눌러주세요.
                    </div>
                  )}
                  <div className="font-semibold text-amber-800">
                    인증 메일이 오지 않나요?
                  </div>
                  <ul className="list-disc pl-4 space-y-0.5">
                    <li>스팸·정크 메일함을 먼저 확인해 주세요.</li>
                    <li>
                      회사 메일 보안 필터가 외부 메일을 지연·격리할 수 있습니다
                      (수 분~수 시간 소요될 수 있음).
                    </li>
                    <li>
                      <strong>
                        다른 이메일로 다시 가입하지 마세요.
                      </strong>{" "}
                      같은 회사가 여러 법인으로 중복 등록되어 데이터·권한이
                      분리됩니다.
                    </li>
                    <li>
                      재발송 후에도 계속 오지 않으면{" "}
                      <a
                        href={`mailto:${COMPANY_INFO.email}`}
                        className="underline hover:opacity-80"
                      >
                        운영자({COMPANY_INFO.email})
                      </a>
                      에게 문의해 주세요.
                    </li>
                  </ul>
                  <div className="pt-1">
                    <button
                      onClick={() => resendVerification(stage.verifyEmail!)}
                      disabled={busy}
                      className="px-3 py-1.5 text-xs bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded font-medium"
                    >
                      {busy ? "발송 중..." : "인증 메일 재발송"}
                    </button>
                  </div>
                  {resendInfo && (
                    <div className="text-primary-deep bg-primary-soft border border-primary/30 rounded px-2.5 py-1.5">
                      {resendInfo}
                    </div>
                  )}
                  {err && (
                    <div className="text-danger bg-danger-soft border border-danger/30 rounded px-2.5 py-1.5">
                      {err}
                    </div>
                  )}
                </div>
              )}
              <Link
                href="/login"
                className="inline-block px-5 py-2.5 rounded-lg bg-primary hover:bg-primary-deep text-white text-sm font-medium"
              >
                로그인 페이지로
              </Link>
            </div>
          ) : (
            <>
          <Field label="이메일" required>
            <div className="flex gap-2">
              <input
                className={inputCls}
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                value={email}
                disabled={stage.kind !== "check" && stage.kind !== "choose"}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && checkEmail()}
              />
              <button
                onClick={checkEmail}
                disabled={busy || stage.kind === "join"}
                className="shrink-0 px-3 text-sm bg-slate-100 hover:bg-slate-200 rounded-lg border border-slate-300 disabled:opacity-50"
              >
                중복확인
              </button>
            </div>
          </Field>

          {stage.kind === "join" && (
            <div className="space-y-3">
              <Banner>
                <strong>{stage.org.name}</strong> 법인이 발견되었습니다.
                합류 요청을 보내면 관리자 승인 후 로그인 가능합니다.
              </Banner>
              <AdminContactsPanel
                org={stage.org}
                admins={stage.admins}
              />
              <Field label="이름" required>
                <input
                  className={inputCls}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field label="비밀번호" required>
                <PasswordInput
                  className={inputCls}
                  placeholder="10자 이상, 3종 이상 조합"
                  value={password}
                  onChange={setPassword}
                />
                <PasswordStrength password={password} />
              </Field>
              <ConsentBox
                acceptTerms={acceptTerms}
                acceptPrivacy={acceptPrivacy}
                ageOver14={ageOver14}
                onTerms={setAcceptTerms}
                onPrivacy={setAcceptPrivacy}
                onAge={setAgeOver14}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => submitJoin(stage.org.id)}
                  disabled={busy}
                  className={primaryBtn}
                >
                  {busy ? "처리 중..." : "합류 요청 보내기"}
                </button>
                <button
                  onClick={() => setStage({ kind: "choose" })}
                  className={secondaryBtn}
                >
                  다른 법인
                </button>
              </div>
            </div>
          )}

          {stage.kind === "choose" && (
            <div className="space-y-3">
              <Banner>
                매칭되는 법인이 없습니다. 새 법인을 등록하거나 기존 법인을 검색하세요.
              </Banner>
              <div className="flex gap-2">
                <button onClick={() => setStage({ kind: "create" })} className={primaryBtn}>
                  새 법인 등록
                </button>
                <button
                  onClick={() => setStage({ kind: "search", results: [], q: "" })}
                  className={secondaryBtn}
                >
                  법인 검색
                </button>
              </div>
            </div>
          )}

          {stage.kind === "choose_match" && (
            <div className="space-y-3">
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 leading-relaxed">
                <strong>같은 도메인의 법인이 여러 개입니다.</strong> SaaS 메일을 여러 회사가 공유하는 경우일 수 있습니다. 합류할 법인을 선택해 주세요. 본인의 회사가 없으면 아래 "새 법인 등록"으로 진행할 수 있습니다.
              </div>
              <ul className="space-y-2">
                {stage.orgs.map((o) => (
                  <li
                    key={o.id}
                    className="border border-slate-200 rounded-lg p-3 hover:bg-slate-50"
                  >
                    <div className="flex justify-between items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-slate-900">
                            {o.name}
                          </span>
                          <VerificationChip status={o.verificationStatus} />
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {o.bizRegistrationNo
                            ? `사업자번호 ${o.bizRegistrationNo}`
                            : "사업자번호 미등록"}
                        </div>
                        {o.admins.length > 0 && (
                          <div className="text-[11px] text-slate-500 mt-1">
                            담당자: {o.admins.map((a) => `${a.name} ${a.email}`).join(" · ")}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() =>
                          enterJoinFromSearch({ id: o.id, name: o.name })
                        }
                        className="shrink-0 px-3 py-1.5 text-xs bg-primary hover:bg-primary-deep text-white rounded-lg"
                      >
                        합류 요청
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setStage({ kind: "create" })}
                  className={secondaryBtn}
                >
                  내 회사 없음 — 새 법인 등록
                </button>
                <button
                  onClick={() => setStage({ kind: "search", results: [], q: "" })}
                  className={secondaryBtn}
                >
                  법인 검색
                </button>
              </div>
            </div>
          )}

          {stage.kind === "match_suggest" && (
            <div className="space-y-3">
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 leading-relaxed">
                <strong>이미 등록된 것으로 보이는 법인이 있습니다.</strong> 같은
                회사라면 아래에서 합류 요청을 보내세요 (중복 법인 등록 시
                데이터·권한이 분리됩니다). 본인 회사가 아니면 새 법인으로 등록할
                수 있습니다.
              </div>
              <ul className="space-y-2">
                {stage.orgs.map((o) => (
                  <li
                    key={o.id}
                    className="border border-slate-200 rounded-lg p-3 hover:bg-slate-50"
                  >
                    <div className="flex justify-between items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-slate-900">
                            {o.name}
                          </span>
                          {o.reason && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-amber-50 text-amber-800 border-amber-200">
                              {o.reason}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {o.bizRegistrationNo
                            ? `사업자번호 ${o.bizRegistrationNo}`
                            : "사업자번호 미등록"}
                          {o.emailDomain ? ` · ${o.emailDomain}` : ""}
                        </div>
                      </div>
                      <button
                        onClick={() =>
                          enterJoinFromSearch({ id: o.id, name: o.name })
                        }
                        className="shrink-0 px-3 py-1.5 text-xs bg-primary hover:bg-primary-deep text-white rounded-lg"
                      >
                        합류 요청
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => submitCreate(true)}
                  disabled={busy}
                  className={secondaryBtn}
                >
                  {busy ? "처리 중..." : "그래도 새 법인으로 등록"}
                </button>
                <button
                  onClick={() => setStage({ kind: "create" })}
                  className={secondaryBtn}
                >
                  뒤로
                </button>
              </div>
            </div>
          )}

          {stage.kind === "create" && (
            <div className="space-y-3">
              {!emailDomainIsPublic && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 leading-relaxed">
                  <strong>도메인 점유 안내</strong> — 가입을 진행하면{" "}
                  <code className="font-mono">
                    {getEmailDomain(email) ?? ""}
                  </code>{" "}
                  도메인은 본 법인 단독 도메인으로 등록되며, 이후 같은 도메인으로
                  가입하는 사용자는 자동으로 본 법인에 매핑됩니다. <br />
                  <span className="text-amber-800">
                    Google Workspace 와 같은 SaaS 메일을 여러 회사가 공유하는
                    경우라면 가입을 중단하고 운영자에게 문의해 주세요 (사칭·혼선
                    방지).
                  </span>
                </div>
              )}
              <DartCorpCombobox
                value={orgName}
                onChange={setOrgName}
                onPickBizno={(b) => setBizNo(b)}
              />
              <SimilarOrgsHint
                query={orgName}
                onSelect={(o) =>
                  enterJoinFromSearch({ id: o.id, name: o.name })
                }
              />
              <Field label="이름" required>
                <input
                  className={inputCls}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field label="비밀번호" required>
                <PasswordInput
                  className={inputCls}
                  placeholder="10자 이상, 3종 이상 조합"
                  value={password}
                  onChange={setPassword}
                />
                <PasswordStrength password={password} />
              </Field>
              <p className="text-xs text-slate-500">
                새 법인 등록 시 본인이 법인 관리자가 됩니다.
              </p>
              <ConsentBox
                acceptTerms={acceptTerms}
                acceptPrivacy={acceptPrivacy}
                ageOver14={ageOver14}
                onTerms={setAcceptTerms}
                onPrivacy={setAcceptPrivacy}
                onAge={setAgeOver14}
              />
              <div className="flex gap-2">
                <button onClick={() => submitCreate()} disabled={busy} className={primaryBtn}>
                  {busy ? "처리 중..." : "법인 등록 및 가입"}
                </button>
                <button onClick={() => setStage({ kind: "choose" })} className={secondaryBtn}>
                  뒤로
                </button>
              </div>
            </div>
          )}

          {stage.kind === "search" && (
            <div className="space-y-3">
              <Field label="법인명 또는 사업자번호">
                <div className="flex gap-2">
                  <input
                    className={inputCls}
                    value={searchQ}
                    onChange={(e) => setSearchQ(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && runSearch()}
                  />
                  <button onClick={runSearch} disabled={busy} className={secondaryBtn}>
                    검색
                  </button>
                </div>
              </Field>
              <div className="space-y-1 max-h-60 overflow-auto">
                {stage.results.length === 0 && stage.q && (
                  <p className="text-xs text-slate-500">결과가 없습니다.</p>
                )}
                {stage.results.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => enterJoinFromSearch({ id: o.id, name: o.name })}
                    className="w-full text-left px-3 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50"
                  >
                    <div className="font-medium">{o.name}</div>
                    <div className="text-xs text-slate-500">
                      {o.bizRegistrationNo || "사업자번호 없음"} ·{" "}
                      {o.emailDomain || "도메인 없음"}
                    </div>
                  </button>
                ))}
              </div>
              <button onClick={() => setStage({ kind: "choose" })} className={secondaryBtn}>
                뒤로
              </button>
            </div>
          )}

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

          <div className="text-center text-xs text-slate-500 pt-2 border-t border-slate-100">
            이미 계정이 있나요?{" "}
            <Link href="/login" className="text-primary hover:underline">
              로그인
            </Link>
          </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

const inputCls =
  "w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent";
const primaryBtn =
  "flex-1 bg-primary hover:bg-primary-deep disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg shadow-sm";
const secondaryBtn =
  "px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium py-2.5 rounded-lg border border-slate-300";

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
        {required && (
          <span className="text-danger ml-0.5" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children}
    </div>
  );
}

/**
 * 법인명 입력 콤보박스 — DART 상장·외감법인 자동완성. 선택 시 사업자번호도 함께 채움.
 * 데이터 없거나 매칭 0 이면 자유 텍스트 입력으로 동작 (graceful).
 */
function DartCorpCombobox({
  value,
  onChange,
  onPickBizno,
}: {
  value: string;
  onChange: (v: string) => void;
  onPickBizno: (bizno: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<
    Array<{ name: string; eng: string; bizno: string | null }>
  >([]);
  const [activeIdx, setActiveIdx] = useState(-1);

  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/orgs/dart-search?q=${encodeURIComponent(q)}`);
        const d = (await r.json()) as {
          results: Array<{ name: string; eng: string; bizno: string | null }>;
        };
        setResults(d.results);
        setActiveIdx(-1);
      } catch {
        setResults([]);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [value]);

  const pick = (item: { name: string; bizno: string | null }) => {
    onChange(item.name);
    if (item.bizno) onPickBizno(item.bizno);
    setOpen(false);
    setResults([]);
  };

  return (
    <Field label="법인명" required>
      <div className="relative">
        <input
          className={inputCls}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (!open || results.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIdx((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIdx((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && activeIdx >= 0) {
              e.preventDefault();
              pick(results[activeIdx]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder="회사명 일부만 입력해도 자동완성됩니다 (상장사·외감법인)"
        />
        {open && results.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-72 overflow-auto">
            {results.map((r, i) => (
              <li key={i}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(r);
                  }}
                  className={
                    "w-full text-left px-3 py-2 text-sm flex items-baseline justify-between gap-3 " +
                    (i === activeIdx ? "bg-primary-soft" : "hover:bg-slate-50")
                  }
                >
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-slate-900">{r.name}</span>
                    {r.eng && (
                      <span className="ml-2 text-xs text-slate-400 truncate">
                        {r.eng}
                      </span>
                    )}
                  </span>
                  {r.bizno && (
                    <span className="text-[11px] text-slate-500 tabular-nums shrink-0">
                      {r.bizno.replace(/(\d{3})(\d{2})(\d{5})/, "$1-$2-$3")}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-[11px] text-slate-400 mt-1">
        검색되지 않는 법인은 직접 입력하세요 (비상장 기업, 신생법인 등).
      </p>
    </Field>
  );
}

/**
 * 법인명 입력 중에 디바운스로 유사 법인 매칭 → 중복 등록 방지 카드.
 */
function SimilarOrgsHint({
  query,
  onSelect,
}: {
  query: string;
  onSelect: (org: { id: number; name: string }) => void;
}) {
  const [similar, setSimilar] = useState<OrgSearchResult[]>([]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setSimilar([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(
          `/api/orgs/search?q=${encodeURIComponent(query.trim())}`
        );
        if (r.ok) setSimilar(((await r.json()) as OrgSearchResult[]).slice(0, 3));
      } catch {
        /* ignore */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [query]);

  if (similar.length === 0) return null;
  return (
    <div className="text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 space-y-1.5">
      <div className="font-semibold text-amber-800">
        혹시 이 법인 아닌가요? 중복 등록을 방지하려고 안내드립니다.
      </div>
      {similar.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onSelect({ id: o.id, name: o.name })}
          className="w-full text-left px-2.5 py-1.5 text-xs bg-white border border-amber-300 rounded hover:bg-amber-100"
        >
          <span className="font-medium text-slate-900">{o.name}</span>
          {o.bizRegistrationNo && (
            <span className="text-slate-500 ml-2">{o.bizRegistrationNo}</span>
          )}
          {o.emailDomain && (
            <span className="text-slate-400 ml-2">{o.emailDomain}</span>
          )}
        </button>
      ))}
    </div>
  );
}

function VerificationChip({
  status,
}: {
  status: "dart_matched" | "verified" | "pending_review" | "rejected";
}) {
  const cfg =
    status === "dart_matched"
      ? { label: "✓ DART", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" }
      : status === "verified"
        ? { label: "✓ 검증", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" }
        : status === "pending_review"
          ? { label: "⏳ 검토 대기", cls: "bg-amber-50 text-amber-800 border-amber-200" }
          : { label: "✕ 거절", cls: "bg-rose-100 text-rose-700 border-rose-200" };
  return (
    <span
      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${cfg.cls}`}
    >
      {cfg.label}
    </span>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs text-primary-deep bg-primary-soft border border-primary/30 rounded-lg px-3 py-2">
      {children}
    </div>
  );
}

function AdminContactsPanel({
  org,
  admins,
}: {
  org: { id: number; name: string };
  admins: AdminInfo[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [reqName, setReqName] = useState("");
  const [reqEmail, setReqEmail] = useState("");
  const [reqReason, setReqReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    setErr("");
    if (!reqName.trim() || !reqEmail.trim()) {
      setErr("이름과 이메일은 필수입니다.");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/orgs/admin-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orgId: org.id,
        requesterName: reqName.trim(),
        requesterEmail: reqEmail.trim(),
        reason: reqReason.trim(),
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
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
      <div className="text-xs font-semibold text-slate-700">
        현재 법인 담당자 (org admin)
      </div>
      {admins.length === 0 ? (
        <div className="text-xs text-slate-500">
          담당자 정보를 불러올 수 없습니다.
        </div>
      ) : (
        <ul className="space-y-1">
          {admins.map((a, i) => (
            <li
              key={i}
              className="flex items-center justify-between text-xs text-slate-700 bg-white border border-slate-200 rounded px-2.5 py-1.5"
            >
              <div>
                <span className="font-medium">{a.name}</span>{" "}
                <span className="text-slate-500">{a.email}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-slate-500 pt-1">
        합류 요청은 위 담당자가 승인합니다. 담당자와 연락이 닿지 않으면 운영자에게 권한 부여를 요청할 수 있습니다.
      </p>

      {submitted ? (
        <div className="text-xs text-primary-deep bg-primary-soft border border-primary/30 rounded px-2.5 py-2">
          운영자에게 권한 부여 요청을 보냈습니다. 별도 회신으로 신원·재직 증명 요청이 올 수 있습니다.
        </div>
      ) : !expanded ? (
        <button
          onClick={() => setExpanded(true)}
          className="text-xs text-primary hover:underline"
        >
          담당자와 연락이 안 되나요? 운영자에게 권한 부여 요청 →
        </button>
      ) : (
        <div className="border-t border-slate-200 pt-2 space-y-2">
          <div className="text-xs font-medium text-slate-700">
            시스템 운영자에게 법인 권한 이관 요청
          </div>
          <input
            className={inputCls}
            placeholder="본인 이름"
            value={reqName}
            onChange={(e) => setReqName(e.target.value)}
          />
          <input
            className={inputCls}
            type="email"
            placeholder="연락받을 이메일"
            value={reqEmail}
            onChange={(e) => setReqEmail(e.target.value)}
          />
          <textarea
            className={inputCls + " resize-y min-h-[72px]"}
            placeholder="사유 (예: 회사 인사담당자로 부임, 기존 admin 퇴사 등). 운영자가 별도 회신으로 증빙을 요청할 수 있습니다."
            value={reqReason}
            onChange={(e) => setReqReason(e.target.value)}
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
    </div>
  );
}

function ConsentBox({
  acceptTerms,
  acceptPrivacy,
  ageOver14,
  onTerms,
  onPrivacy,
  onAge,
}: {
  acceptTerms: boolean;
  acceptPrivacy: boolean;
  ageOver14: boolean;
  onTerms: (v: boolean) => void;
  onPrivacy: (v: boolean) => void;
  onAge: (v: boolean) => void;
}) {
  const allChecked = ageOver14 && acceptTerms && acceptPrivacy;
  const toggleAll = (v: boolean) => {
    onAge(v);
    onTerms(v);
    onPrivacy(v);
  };
  return (
    <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5">
      <label className="flex items-start gap-2 cursor-pointer pb-2 mb-2 border-b border-slate-200 font-medium text-slate-800">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={allChecked}
          onChange={(e) => toggleAll(e.target.checked)}
        />
        <span>전체 동의</span>
      </label>
      <div className="space-y-1.5">
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={ageOver14}
            onChange={(e) => onAge(e.target.checked)}
          />
          <span>
            본인은 만 14세 이상입니다. <span className="text-danger">(필수)</span>
          </span>
        </label>
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={acceptTerms}
            onChange={(e) => onTerms(e.target.checked)}
          />
          <span>
            <Link href="/terms" target="_blank" className="text-primary hover:underline">
              이용약관
            </Link>
            에 동의합니다. <span className="text-danger">(필수)</span>
          </span>
        </label>
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={acceptPrivacy}
            onChange={(e) => onPrivacy(e.target.checked)}
          />
          <span>
            <Link href="/privacy" target="_blank" className="text-primary hover:underline">
              개인정보 처리방침
            </Link>
            에 동의합니다. <span className="text-danger">(필수)</span>
          </span>
        </label>
      </div>
    </div>
  );
}
