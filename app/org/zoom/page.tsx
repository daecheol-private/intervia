"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DesktopOnlyNotice } from "@/app/components/DesktopOnlyNotice";
import { PasswordInput } from "@/app/components/PasswordInput";
import { formatLocalDateTime } from "@/lib/utils";

type ZoomConfig = {
  orgId: number;
  accountId: string;
  clientId: string;
  clientSecret: string; // 마스킹된 값
  lastCheckedAt: string | null;
  lastCheckStatus: "ok" | "fail" | null;
  lastCheckError: string | null;
};

export default function OrgZoomPage() {
  const [loaded, setLoaded] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [lastChecked, setLastChecked] = useState<ZoomConfig | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null
  );
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const r = await fetch("/api/orgs/zoom");
    setLoaded(true);
    if (!r.ok) return;
    const data = (await r.json()) as ZoomConfig | null;
    if (!data) return;
    setAccountId(data.accountId);
    setClientId(data.clientId);
    setClientSecret(data.clientSecret);
    setLastChecked(data);
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/orgs/zoom", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId, clientId, clientSecret }),
    });
    setBusy(false);
    if (!res.ok) {
      setMsg({ kind: "err", text: await res.text() });
      return;
    }
    const data = (await res.json()) as { ok: boolean; error: string | null };
    if (data.ok) {
      setMsg({ kind: "ok", text: "저장 완료. 줌 연결 테스트 통과." });
    } else {
      setMsg({ kind: "err", text: `저장됨, 단 연결 테스트 실패: ${data.error}` });
    }
    void load();
  };

  const remove = async () => {
    if (
      !confirm(
        "줌 연동을 삭제할까요? 이후 온라인 면접 확정 시 줌 링크가 자동 생성되지 않습니다."
      )
    )
      return;
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/orgs/zoom", { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      setMsg({ kind: "err", text: await res.text() });
      return;
    }
    setAccountId("");
    setClientId("");
    setClientSecret("");
    setLastChecked(null);
    setMsg({ kind: "ok", text: "삭제 완료" });
  };

  return (
    <main className="max-w-3xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-6">
        <Link href="/org/settings" className="text-xs text-slate-500 hover:underline">
          ← 법인 설정
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-2">
          화상 면접 (줌) 연동
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          회사 줌 계정을 한 번 연결해 두면, 온라인 1차 면접 시간이 확정될 때
          줌 회의 링크가 자동으로 생성되어 후보자·면접관에게 메일로 발송됩니다.
        </p>
        <Link
          href="/org/zoom/guide"
          className="inline-flex items-center gap-1 mt-3 text-sm font-medium text-primary hover:text-primary-deep underline"
        >
          📘 연동 방법 설명서 보기
        </Link>
      </div>

      {/* 모바일: 데스크톱 전용 안내 */}
      <div className="sm:hidden">
        <DesktopOnlyNotice
          title="줌 연동 설정은 PC에서"
          description="줌 자격증명 등록·검증은 PC(데스크톱)에서 진행해 주세요."
        />
      </div>

      <div className="hidden sm:block">
        {!loaded ? (
          <div className="text-sm text-slate-500">불러오는 중...</div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
            {lastChecked && (
              <div
                className={`text-xs px-3 py-2 rounded-lg border ${
                  lastChecked.lastCheckStatus === "ok"
                    ? "bg-primary-soft border-primary/30 text-primary-deep"
                    : "bg-danger-soft border-danger/30 text-danger"
                }`}
              >
                마지막 연결 테스트:{" "}
                {lastChecked.lastCheckStatus === "ok" ? "✓ 정상" : "✗ 실패"}
                {lastChecked.lastCheckError
                  ? ` — ${lastChecked.lastCheckError}`
                  : ""}
                {lastChecked.lastCheckedAt
                  ? ` (${formatLocalDateTime(lastChecked.lastCheckedAt)})`
                  : ""}
              </div>
            )}

            <div className="text-xs bg-slate-50 border border-slate-200 text-slate-600 rounded-lg px-3 py-2.5 leading-relaxed">
              줌 마켓플레이스에서{" "}
              <strong className="text-slate-800">Server-to-Server OAuth</strong>{" "}
              앱을 만들면 아래 3개 값이 나옵니다. 그대로 복사해 붙여넣으세요.
              자세한 순서는{" "}
              <Link
                href="/org/zoom/guide"
                className="text-primary underline hover:text-primary-deep"
              >
                설명서
              </Link>
              를 참고하세요.
            </div>

            <Row label="Account ID">
              <input
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                placeholder="줌 앱의 Account ID"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </Row>
            <Row label="Client ID">
              <input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="줌 앱의 Client ID"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </Row>
            <Row label="Client Secret">
              <PasswordInput
                value={clientSecret}
                onChange={setClientSecret}
                placeholder={lastChecked ? "변경 시에만 입력" : "줌 앱의 Client Secret"}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                autoComplete="new-password"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                저장된 Client Secret 은 마스킹되어 보입니다. 변경하려면 새 값을
                입력하세요. (비밀번호와 같으니 외부에 공유하지 마세요.)
              </p>
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
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-2">
              <button
                onClick={save}
                disabled={busy}
                className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-white text-sm font-medium disabled:opacity-50"
              >
                {busy ? "처리 중..." : "저장 및 연결 테스트"}
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
      <label className="block text-xs font-medium text-slate-600 mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
