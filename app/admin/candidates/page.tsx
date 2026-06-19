"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useStepUpFetch } from "@/app/components/StepUpModal";
import { formatLocalDate } from "@/lib/utils";

type Result = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  orgId: number | null;
  orgName: string | null;
  jobTitle: string | null;
  stage: string;
  createdAt: string;
};

export default function AdminCandidatesPage() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const { ensureFetch, modal: stepUpModal } = useStepUpFetch();

  const search = async (term: string, opts?: { silent?: boolean }) => {
    const trimmed = term.trim();
    if (trimmed.length < 2) {
      if (!opts?.silent) setErr("2글자 이상 입력하세요.");
      setRows([]);
      return;
    }
    setBusy(true);
    setErr("");
    let res: Response;
    try {
      res = await ensureFetch(
        `/api/admin/candidates?q=${encodeURIComponent(trimmed)}`,
        undefined,
        "다른 법인의 후보자 데이터를 조회합니다. (PIPA cross-org)"
      );
    } catch {
      setBusy(false);
      return;
    }
    setBusy(false);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    const d = (await res.json()) as { results: Result[] };
    setRows(d.results);
  };

  // 디바운스 자동 검색 — 2글자 이상 입력 시 300ms 후 자동 조회.
  // (감사 로그 부담 줄이려고 silent: 에러 메시지는 명시적 클릭/Enter 때만)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 2) {
      setRows([]);
      return;
    }
    debounceRef.current = setTimeout(() => void search(q, { silent: true }), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const remove = async (c: Result) => {
    const expected = c.email ?? c.name;
    const confirmText = prompt(
      `PIPA 권리요청 등으로 후보자 데이터를 삭제합니다.\n\n` +
        `사유 (5자 이상, 감사 로그에 기록 — 요청자·조항 명시 권장):`
    );
    if (confirmText === null) return;
    if (confirmText.trim().length < 5) {
      setErr("사유는 5자 이상");
      return;
    }
    const confirm2 = prompt(
      `실수 방지: 후보자 식별자를 정확히 입력하세요.\n\n  ${expected}`
    );
    if (confirm2 === null) return;
    if (confirm2.trim() !== expected) {
      setErr("식별자 불일치");
      return;
    }
    setBusy(true);
    let res: Response;
    try {
      res = await ensureFetch(
        `/api/admin/candidates/${c.id}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: confirmText.trim(),
            confirm: confirm2.trim(),
          }),
        },
        `${c.name} 후보자 데이터를 영구 삭제합니다. (PIPA 권리요청)`
      );
    } catch {
      setBusy(false);
      return;
    }
    setBusy(false);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    setRows(rows.filter((r) => r.id !== c.id));
    alert("삭제 완료. 감사 로그에 기록되었습니다.");
  };

  return (
    <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      {stepUpModal}
      <div className="mb-6">
        <Link href="/admin/dashboard" className="text-xs text-ink-muted hover:underline">
          ← 운영 대시보드
        </Link>
        <h1 className="text-2xl font-bold text-ink mt-2">
          후보자 검색 (cross-org)
        </h1>
        <p className="text-sm text-ink-muted mt-1">
          PIPA 권리요청 (열람·삭제) 대응. 모든 법인의 후보자를 이름/이메일/전화번호로 검색.
        </p>
        <div className="mt-3 text-[11px] text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2">
          ⚠️ 이 페이지에서의 모든 조회·삭제는 감사 로그에 "타법인접근"으로 기록됩니다.
        </div>
      </div>

      <form
        className="flex gap-2 mb-4"
        onSubmit={(e) => {
          e.preventDefault();
          void search(q);
        }}
      >
        <input
          className="flex-1 border border-border-strong rounded-lg px-3 py-2 text-sm bg-card"
          placeholder="이름 · 이메일 · 전화번호 (2글자+) — 자동 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
        <button
          type="submit"
          disabled={busy}
          className="px-3 py-2 text-sm bg-primary text-surface rounded-lg hover:bg-primary-deep disabled:opacity-50"
        >
          검색
        </button>
      </form>

      {err && (
        <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2 mb-4">
          {err}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="text-sm text-ink-muted text-center py-12 bg-card border border-dashed border-border-strong rounded-2xl">
          {q ? "결과 없음" : "검색어를 입력하세요."}
        </div>
      ) : (
        <div className="bg-card border border-border-default rounded-2xl shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-alt text-ink-soft text-xs">
              <tr>
                <th className="text-left px-4 py-3 font-medium">이름</th>
                <th className="text-left px-4 py-3 font-medium">이메일</th>
                <th className="text-left px-4 py-3 font-medium">전화</th>
                <th className="text-left px-4 py-3 font-medium">법인</th>
                <th className="text-left px-4 py-3 font-medium">공고</th>
                <th className="text-left px-4 py-3 font-medium">단계</th>
                <th className="text-left px-4 py-3 font-medium">등록일</th>
                <th className="text-right px-4 py-3 font-medium">작업</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3 text-ink-soft">{c.email ?? "-"}</td>
                  <td className="px-4 py-3 text-ink-soft">{c.phone ?? "-"}</td>
                  <td className="px-4 py-3 text-ink-soft">
                    {c.orgName ?? `org#${c.orgId}`}
                  </td>
                  <td className="px-4 py-3 text-ink-soft truncate max-w-[200px]">
                    {c.jobTitle ?? "-"}
                  </td>
                  <td className="px-4 py-3 text-xs">{c.stage}</td>
                  <td className="px-4 py-3 text-xs text-ink-muted">
                    {formatLocalDate(c.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => remove(c)}
                      disabled={busy}
                      className="px-2.5 py-1 text-xs bg-card border border-danger/40 hover:bg-danger-soft text-danger rounded disabled:opacity-50"
                    >
                      PIPA 삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
