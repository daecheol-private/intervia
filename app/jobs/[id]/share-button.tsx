"use client";

import { useEffect, useState } from "react";
import { Share2 } from "lucide-react";

type MemberResult = {
  userId: number;
  email: string;
  name: string;
  status: "assigned" | "already_assigned" | "skipped_other_org" | "failed";
  error?: string;
};

export function ShareButton({
  jobId,
  jobTitle,
  iconOnly,
}: {
  jobId: number;
  jobTitle: string;
  /** 헤더에서 아이콘 버튼으로 렌더 (라벨 대신 아이콘+툴팁). */
  iconOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [emails, setEmails] = useState("");
  const [busy, setBusy] = useState(false);
  const [members, setMembers] = useState<
    { id: number; email: string; name: string; role: string }[]
  >([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<number>>(
    new Set()
  );
  // 이미 이 공고 면접관인 멤버 id — 멤버 목록에서 "이미 면접관"으로 표시 + 선택 비활성화.
  const [interviewerIds, setInterviewerIds] = useState<Set<number>>(new Set());
  const [memberLoading, setMemberLoading] = useState(false);
  const [results, setResults] = useState<
    | {
        results: {
          email: string;
          status: "sent" | "already_member" | "other_org" | "failed";
          error?: string;
        }[];
        memberResults: MemberResult[];
        invalidInputs: string[];
      }
    | null
  >(null);
  const [err, setErr] = useState("");

  // 모달 열릴 때 같은 법인 멤버 로드 (본인 제외, disabled 제외).
  // /api/orgs/members 는 org_admin/system_admin 만 허용 — member 는 403 받고 빈 목록.
  useEffect(() => {
    if (!open) return;
    setMemberLoading(true);
    Promise.all([
      fetch("/api/orgs/members").then((r) =>
        r.ok ? r.json() : Promise.resolve([])
      ),
      fetch("/api/auth/status").then((r) =>
        r.ok ? r.json() : Promise.resolve({ user: null })
      ),
      fetch(`/api/jobs/${jobId}/interviewers`).then((r) =>
        r.ok ? r.json() : Promise.resolve({ interviewers: [] })
      ),
    ])
      .then(([list, status, interviewerData]) => {
        // /api/orgs/members 응답은 { members, domainShared } 형태 (구버전 배열 응답도 호환).
        const memberList = Array.isArray(list) ? list : list?.members;
        const rows = Array.isArray(memberList)
          ? (memberList as {
              id: number;
              email: string;
              name: string;
              role: string;
              status?: string;
            }[])
          : [];
        const myId = status?.user?.id ?? null;
        setMembers(
          rows
            .filter((m) => m.id !== myId && m.status !== "disabled")
            .map((m) => ({
              id: m.id,
              email: m.email,
              name: m.name,
              role: m.role,
            }))
        );
        const ivs = Array.isArray(interviewerData?.interviewers)
          ? (interviewerData.interviewers as { userId: number }[])
          : [];
        setInterviewerIds(new Set(ivs.map((r) => r.userId)));
      })
      .catch(() => {
        setMembers([]);
        setInterviewerIds(new Set());
      })
      .finally(() => setMemberLoading(false));
  }, [open, jobId]);

  const toggleMember = (id: number) => {
    if (interviewerIds.has(id)) return; // 이미 면접관은 선택 불가
    setSelectedMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    setBusy(true);
    setErr("");
    setResults(null);
    const r = await fetch(`/api/jobs/${jobId}/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        emails,
        memberIds: Array.from(selectedMemberIds),
      }),
    });
    setBusy(false);
    if (!r.ok) {
      const t = await r.text();
      let display = t || "발송 실패";
      try {
        const j = JSON.parse(t);
        display = j.error || j.message || display;
        if (j.retryAfterSeconds) display += ` (${j.retryAfterSeconds}초 후 재시도)`;
      } catch {
        /* not JSON — keep raw text */
      }
      setErr(display);
      return;
    }
    const data = await r.json();
    setResults({
      results: data.results ?? [],
      memberResults: data.memberResults ?? [],
      invalidInputs: data.invalidInputs ?? [],
    });
  };

  const close = () => {
    setOpen(false);
    setEmails("");
    setSelectedMemberIds(new Set());
    setErr("");
    setResults(null);
  };

  const canSubmit =
    !busy && (emails.trim().length > 0 || selectedMemberIds.size > 0);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="공고 공유"
        aria-label="공고 공유"
        className={
          iconOnly
            ? "inline-flex items-center justify-center w-8 h-8 rounded-lg border border-border-strong text-ink-soft hover:bg-surface-alt hover:text-ink transition-colors"
            : "px-3 py-1.5 rounded-lg border border-primary/30 text-primary-deep hover:bg-primary-soft text-sm"
        }
      >
        {iconOnly ? <Share2 className="w-4 h-4" /> : "공유"}
      </button>
      {open && (
        <div
          className="fixed inset-0 bg-ink/40 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          onClick={close}
        >
          <div
            className="bg-card rounded-2xl p-6 w-full max-w-md shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-ink">공고 공유</h3>
            <p className="text-xs text-ink-muted mt-1 truncate">{jobTitle}</p>
            {!results ? (
              <>
                {/* 법인 멤버 선택 — 선택 시 면접관 자동 추가 + 알림 메일 */}
                <div className="mt-4">
                  <div className="flex items-baseline justify-between mb-1.5">
                    <span className="text-xs font-semibold text-ink-soft">
                      법인 멤버 선택 (면접관으로 자동 추가)
                    </span>
                    {selectedMemberIds.size > 0 && (
                      <span className="text-[11px] text-ink-soft font-medium">
                        {selectedMemberIds.size}명 선택됨
                      </span>
                    )}
                  </div>
                  {memberLoading ? (
                    <div className="text-xs text-ink-muted py-3 px-3 border border-dashed border-border-default rounded-lg">
                      멤버 목록 불러오는 중...
                    </div>
                  ) : members.length === 0 ? (
                    <div className="text-xs text-ink-muted py-3 px-3 border border-dashed border-border-default rounded-lg">
                      선택 가능한 법인 멤버가 없습니다.
                    </div>
                  ) : (
                    <ul className="max-h-40 overflow-y-auto border border-border-default rounded-lg divide-y divide-border-default">
                      {members.map((m) => {
                        const already = interviewerIds.has(m.id);
                        const checked = !already && selectedMemberIds.has(m.id);
                        return (
                          <li key={m.id}>
                            <label
                              className={`flex items-center gap-2 px-3 py-2 ${
                                already
                                  ? "cursor-default opacity-60"
                                  : "hover:bg-surface-alt cursor-pointer"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={already}
                                onChange={() => toggleMember(m.id)}
                                className="w-4 h-4 rounded border-border-strong accent-primary disabled:opacity-50"
                              />
                              <span className="flex-1 min-w-0">
                                <span className="text-sm font-medium text-ink truncate block">
                                  {m.name}
                                </span>
                                <span className="text-[11px] text-ink-muted truncate block">
                                  {m.email}
                                </span>
                              </span>
                              {already ? (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-alt text-ink-soft border border-border-default font-medium shrink-0">
                                  이미 면접관
                                </span>
                              ) : (
                                m.role !== "member" && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-alt text-ink-soft border border-border-default font-medium">
                                    {m.role === "system_admin" ? "최고관리자" : "관리자"}
                                  </span>
                                )
                              )}
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                <label className="block mt-4">
                  <span className="text-xs font-semibold text-ink-soft">
                    외부 이메일로 공유 (콤마{" "}
                    <code className="font-mono bg-surface-alt px-1 rounded">,</code>{" "}
                    또는 세미콜론{" "}
                    <code className="font-mono bg-surface-alt px-1 rounded">;</code>{" "}
                    구분, 최대 20명)
                  </span>
                  <textarea
                    value={emails}
                    onChange={(e) => setEmails(e.target.value)}
                    rows={3}
                    placeholder={'alice@example.com, bob@example.com; carol@example.com'}
                    className="mt-1 w-full border border-border-strong rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary font-mono"
                  />
                </label>
                <p className="text-[11px] text-ink-muted mt-2 bg-surface-alt border border-border-default rounded-lg p-2">
                  📨 법인 멤버 — 면접관으로 자동 추가됩니다. 외부 이메일 — 1회용 링크(7일)로 공유, 클릭 시 자동 합류.
                </p>
                {err && (
                  <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg p-3 mt-2">
                    {err}
                  </div>
                )}
                <div className="flex gap-2 mt-5">
                  <button
                    onClick={close}
                    className="flex-1 px-4 py-2 rounded-lg border border-border-strong text-sm hover:bg-surface-alt transition-colors"
                  >
                    취소
                  </button>
                  <button
                    onClick={submit}
                    disabled={!canSubmit}
                    className="flex-1 px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-surface text-sm font-medium disabled:opacity-50 transition-colors"
                  >
                    {busy ? "발송 중..." : "공유"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="mt-4 space-y-2 max-h-[40vh] overflow-y-auto text-xs">
                  {results.memberResults.length > 0 && (
                    <div className="text-[11px] uppercase tracking-wider text-ink-muted font-semibold pt-1">
                      법인 멤버
                    </div>
                  )}
                  {results.memberResults.map((m) => (
                    <div
                      key={`m-${m.userId}`}
                      className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border ${
                        m.status === "assigned"
                          ? "bg-success-soft border-success/30 text-success"
                          : m.status === "already_assigned"
                            ? "bg-surface-alt border-border-default text-ink-soft"
                            : m.status === "skipped_other_org"
                              ? "bg-warning-soft border-warning/30 text-warning"
                              : "bg-danger-soft border-danger/30 text-danger"
                      }`}
                    >
                      <span className="truncate">
                        {m.name} <span className="opacity-60">({m.email})</span>
                      </span>
                      <span className="shrink-0 font-medium">
                        {m.status === "assigned"
                          ? "✓ 면접관 추가 + 메일 발송"
                          : m.status === "already_assigned"
                            ? "이미 면접관 (메일 미발송)"
                            : m.status === "skipped_other_org"
                              ? "이미 다른 법인 소속이라 초대 불가"
                              : "✗ 실패"}
                      </span>
                    </div>
                  ))}
                  {results.results.length > 0 && (
                    <div className="text-[11px] uppercase tracking-wider text-ink-muted font-semibold pt-2">
                      외부 이메일
                    </div>
                  )}
                  {results.results.map((r) => (
                    <div
                      key={r.email}
                      className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border ${
                        r.status === "sent"
                          ? "bg-success-soft border-success/30 text-success"
                          : r.status === "already_member"
                            ? "bg-surface-alt border-border-default text-ink-soft"
                            : r.status === "other_org"
                              ? "bg-warning-soft border-warning/30 text-warning"
                              : "bg-danger-soft border-danger/30 text-danger"
                      }`}
                    >
                      <span className="truncate">{r.email}</span>
                      <span className="shrink-0 font-medium">
                        {r.status === "sent"
                          ? "✓ 발송"
                          : r.status === "already_member"
                            ? "이미 멤버"
                            : r.status === "other_org"
                              ? "이미 다른 법인 소속이라 초대 불가"
                              : `✗ 실패`}
                      </span>
                    </div>
                  ))}
                  {results.invalidInputs.length > 0 && (
                    <div className="px-3 py-2 rounded-lg bg-warning-soft border border-warning/30 text-warning">
                      잘못된 형식 (무시됨): {results.invalidInputs.join(", ")}
                    </div>
                  )}
                </div>
                <button
                  onClick={close}
                  className="w-full mt-4 px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-surface text-sm font-medium"
                >
                  닫기
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
