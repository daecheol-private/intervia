"use client";

import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import Link from "next/link";
import {
  Mail,
  Send,
  Trash2,
  FileText,
  Upload,
  X,
  Check,
  Maximize2,
} from "lucide-react";

type Recipient = {
  id: number;
  email: string;
  status: "active" | "unsubscribed";
  lastSentAt: string | null;
  unsubscribedAt: string | null;
  createdAt: string;
};

type Brochure = {
  id: number | string; // "default"(기본) 또는 DB id
  subject: string;
  createdAt: string | null;
  builtin: boolean;
};

function fmtDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z");
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const previewUrl = (id: number | string) =>
  `/api/admin/marketing/brochures/${id}/preview`;

export default function AdminMarketingPage() {
  const [rows, setRows] = useState<Recipient[]>([]);
  const [brochures, setBrochures] = useState<Brochure[]>([]);
  const [selectedBrochure, setSelectedBrochure] = useState<string>("default");
  const [modalId, setModalId] = useState<string | null>(null);
  const [emails, setEmails] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");

  // 브로슈어 추가 폼
  const [newSubject, setNewSubject] = useState("");
  const [newHtml, setNewHtml] = useState("");
  const [newFileName, setNewFileName] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/marketing", { cache: "no-store" });
      if (r.ok) {
        const d = (await r.json()) as { recipients: Recipient[] };
        setRows(d.recipients);
      }
    } catch {
      /* 목록 로드 실패 — 새로고침으로 복구 */
    }
  }, []);

  const loadBrochures = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/marketing/brochures", {
        cache: "no-store",
      });
      if (r.ok) {
        const d = (await r.json()) as { brochures: Brochure[] };
        setBrochures(d.brochures);
      }
    } catch {
      /* 무시 — 새로고침으로 복구 */
    }
  }, []);

  useEffect(() => {
    void load();
    void loadBrochures();
  }, [load, loadBrochures]);

  const activeCount = rows.filter((r) => r.status === "active").length;
  const unsubCount = rows.length - activeCount;
  const selected = brochures.find((b) => String(b.id) === selectedBrochure);
  const modalBrochure = brochures.find((b) => String(b.id) === modalId);

  const add = async () => {
    setErr("");
    setNotice("");
    if (!emails.trim()) return;
    setBusy(true);
    try {
      const r = await fetch("/api/admin/marketing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails }),
      });
      if (!r.ok) {
        setErr(await r.text());
        return;
      }
      const d = (await r.json()) as {
        added: number;
        skipped: number;
        invalid: number;
      };
      setNotice(
        `${d.added}명 등록 완료` +
          (d.skipped ? ` · 중복 ${d.skipped}건 제외` : "") +
          (d.invalid ? ` · 형식 오류 ${d.invalid}건 제외` : "")
      );
      setEmails("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  // HTML 파일을 읽어 본문으로 보관 (텍스트라 Blob 불필요 — DB 에 그대로 저장).
  const onPickFile = (e: ChangeEvent<HTMLInputElement>) => {
    setErr("");
    const f = e.target.files?.[0];
    if (!f) return;
    setNewFileName(f.name);
    const reader = new FileReader();
    reader.onload = () => setNewHtml(String(reader.result ?? ""));
    reader.onerror = () => setErr("파일을 읽지 못했습니다.");
    reader.readAsText(f);
  };

  const addBrochure = async () => {
    setErr("");
    setNotice("");
    if (!newSubject.trim()) {
      setErr("브로슈어 제목을 입력하세요.");
      return;
    }
    if (!newHtml.trim()) {
      setErr("본문 HTML 파일을 선택하세요.");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/admin/marketing/brochures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: newSubject, html: newHtml }),
      });
      if (!r.ok) {
        setErr(await r.text());
        return;
      }
      const d = (await r.json()) as { id: number };
      setNotice("브로슈어가 추가되었습니다.");
      setNewSubject("");
      setNewHtml("");
      setNewFileName("");
      await loadBrochures();
      setSelectedBrochure(String(d.id)); // 방금 추가한 브로슈어를 발송 대상으로 선택
    } finally {
      setBusy(false);
    }
  };

  const removeBrochure = async (b: Brochure) => {
    if (!confirm(`'${b.subject}' 브로슈어를 삭제합니까?`)) return;
    setErr("");
    setBusy(true);
    try {
      const res = await fetch("/api/admin/marketing/brochures", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: b.id }),
      });
      if (!res.ok) {
        setErr(await res.text());
        return;
      }
      if (selectedBrochure === String(b.id)) setSelectedBrochure("default");
      if (modalId === String(b.id)) setModalId(null);
      await loadBrochures();
    } finally {
      setBusy(false);
    }
  };

  const send = async (ids?: number[]) => {
    setErr("");
    setNotice("");
    const count = ids ? ids.length : activeCount;
    if (count === 0) {
      setErr("발송할 수신자가 없습니다.");
      return;
    }
    if (
      !confirm(
        `${count}명에게 "${selected?.subject ?? "브로슈어"}" 메일을 발송합니다.\n제목 앞에 (광고)가 자동으로 붙습니다.\n\n진행하시겠습니까?`
      )
    )
      return;
    setBusy(true);
    try {
      const r = await fetch("/api/admin/marketing/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, brochureId: selectedBrochure }),
      });
      if (!r.ok) {
        setErr(await r.text());
        return;
      }
      const d = (await r.json()) as {
        sent: number;
        failed: Array<{ email: string; error: string }>;
        remaining: number;
      };
      let msg = `${d.sent}명 발송 완료`;
      if (d.failed.length)
        msg += ` · 실패 ${d.failed.length}건 (${d.failed
          .map((f) => f.email)
          .join(", ")})`;
      if (d.remaining > 0)
        msg += ` · 남은 ${d.remaining}명은 "전체 발송"을 다시 눌러 이어서 발송하세요.`;
      setNotice(msg);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: Recipient) => {
    if (!confirm(`${r.email} 을(를) 목록에서 삭제합니까?`)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/marketing", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: r.id }),
      });
      if (!res.ok) {
        setErr(await res.text());
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="max-w-3xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-6">
        <Link
          href="/admin/dashboard"
          className="text-xs text-ink-muted hover:underline"
        >
          ← 운영 대시보드
        </Link>
        <div className="flex items-center gap-2.5 mt-2">
          <span className="w-9 h-9 rounded-lg bg-primary-soft text-primary-deep flex items-center justify-center shrink-0">
            <Mail className="w-5 h-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-ink">마케팅 메일</h1>
            <p className="text-sm text-ink-muted mt-0.5">
              브로슈어를 등록해 두고, 골라서 발송합니다. (광고) 표시와 수신거부는
              자동으로 처리됩니다.
            </p>
          </div>
        </div>
      </div>

      {notice && (
        <div className="mb-4 text-sm text-success bg-success-soft border border-success/30 rounded-lg px-3.5 py-2.5">
          {notice}
        </div>
      )}
      {err && (
        <div className="mb-4 text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3.5 py-2.5">
          {err}
        </div>
      )}

      {/* 브로슈어 관리 */}
      <div className="bg-card border border-border-default rounded-2xl shadow-sm p-5 sm:p-6 mb-6">
        <div className="flex items-center gap-2 mb-1">
          <FileText className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-ink-soft">브로슈어</h2>
        </div>
        <p className="text-[11px] text-ink-muted mb-4 leading-relaxed">
          썸네일을 클릭하면 크게 볼 수 있고, 발송할 브로슈어를 골라 선택합니다.
          (광고) 표시·수신거부 링크는 발송할 때 자동으로 처리되니, 순수 디자인
          HTML만 올리면 됩니다.
        </p>

        {/* 추가 폼 */}
        <div className="space-y-2.5 mb-5">
          <input
            type="text"
            value={newSubject}
            onChange={(e) => setNewSubject(e.target.value)}
            placeholder="메일 제목 (예: Intervia — AI 면접 플랫폼 소개)"
            className="w-full border border-border-strong rounded-lg px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-1.5 px-3 py-2 text-sm border border-border-strong rounded-lg cursor-pointer hover:bg-surface-alt text-ink-soft shrink-0">
              <Upload className="w-3.5 h-3.5" />
              HTML 파일 선택
              <input
                type="file"
                accept=".html,.htm,text/html"
                onChange={onPickFile}
                className="hidden"
              />
            </label>
            <span className="text-xs text-ink-muted truncate min-w-0 flex-1">
              {newFileName || "선택된 파일 없음"}
            </span>
            <button
              onClick={addBrochure}
              disabled={busy || !newSubject.trim() || !newHtml.trim()}
              className="px-4 py-2 text-sm bg-primary text-surface rounded-lg hover:bg-primary-deep disabled:opacity-50 font-medium shrink-0"
            >
              추가
            </button>
          </div>
        </div>

        {/* 썸네일 갤러리 */}
        <div className="flex flex-wrap gap-3 border-t border-border-default pt-4">
          {brochures.map((b) => {
            const isSel = selectedBrochure === String(b.id);
            return (
              <div
                key={String(b.id)}
                className={`w-[150px] rounded-xl overflow-hidden bg-card transition-shadow ${
                  isSel
                    ? "ring-2 ring-primary border border-primary"
                    : "border border-border-default hover:shadow-md"
                }`}
              >
                {/* 썸네일 — 클릭하면 확대 */}
                <button
                  type="button"
                  onClick={() => setModalId(String(b.id))}
                  title="크게 보기"
                  className="group relative block w-full h-[200px] overflow-hidden bg-surface-alt border-b border-border-default"
                >
                  <iframe
                    src={previewUrl(b.id)}
                    title={b.subject}
                    tabIndex={-1}
                    scrolling="no"
                    aria-hidden
                    className="pointer-events-none absolute top-0 left-0 origin-top-left"
                    style={{
                      width: 600,
                      height: 2400,
                      transform: "scale(0.25)",
                    }}
                  />
                  <span className="absolute inset-0 flex items-center justify-center bg-ink/0 group-hover:bg-ink/10 transition-colors">
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity bg-card/90 text-ink-soft rounded-full p-1.5 shadow">
                      <Maximize2 className="w-4 h-4" />
                    </span>
                  </span>
                  {isSel && (
                    <span className="absolute top-1.5 right-1.5 bg-primary text-surface rounded-full p-1 shadow">
                      <Check className="w-3 h-3" />
                    </span>
                  )}
                </button>

                {/* 하단: 선택(라디오) + 제목 + 삭제/기본 */}
                <div className="flex items-center gap-1.5 px-2.5 py-2">
                  <button
                    type="button"
                    onClick={() => setSelectedBrochure(String(b.id))}
                    title="이 브로슈어 선택"
                    className="flex items-center gap-1.5 min-w-0 flex-1 text-left"
                  >
                    <span
                      className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                        isSel
                          ? "border-primary bg-primary"
                          : "border-border-strong"
                      }`}
                    >
                      {isSel && <Check className="w-2.5 h-2.5 text-surface" />}
                    </span>
                    <span className="text-xs truncate text-ink-soft">
                      {b.subject}
                    </span>
                  </button>
                  {b.builtin ? (
                    <span className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-surface-alt text-ink-muted">
                      기본
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => removeBrochure(b)}
                      disabled={busy}
                      title="삭제"
                      className="shrink-0 p-1 rounded-md text-ink-muted hover:text-danger hover:bg-danger-soft disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 수신자 등록 */}
      <div className="bg-card border border-border-default rounded-2xl shadow-sm p-5 sm:p-6 mb-6">
        <label className="block text-sm font-medium text-ink-soft mb-1.5">
          수신자 등록
        </label>
        <textarea
          value={emails}
          onChange={(e) => setEmails(e.target.value)}
          rows={3}
          placeholder={"hr@company-a.co.kr\nrecruit@company-b.com (줄바꿈·쉼표로 여러 개 입력)"}
          className="w-full border border-border-strong rounded-lg px-3 py-2 text-sm bg-card resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <div className="flex items-center justify-between mt-3">
          <p className="text-[11px] text-ink-muted">
            중복·형식 오류는 자동으로 걸러집니다. 한 번에 최대 500개.
          </p>
          <button
            onClick={add}
            disabled={busy || !emails.trim()}
            className="px-4 py-2 text-sm bg-primary text-surface rounded-lg hover:bg-primary-deep disabled:opacity-50 font-medium"
          >
            등록
          </button>
        </div>
      </div>

      {/* 목록 + 발송 */}
      <div className="bg-card border border-border-default rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-border-default space-y-3">
          <div className="flex items-center gap-2 text-sm min-w-0">
            <span className="text-ink-muted shrink-0">발송할 브로슈어</span>
            <span className="font-medium text-ink-soft truncate">
              {selected?.subject ?? "—"}
            </span>
            {selected?.builtin && (
              <span className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-surface-alt text-ink-muted">
                기본
              </span>
            )}
          </div>
          <div className="flex items-center justify-between">
            <div className="text-sm text-ink-soft">
              수신 가능{" "}
              <strong className="text-ink">{activeCount}</strong>명 ·
              수신거부{" "}
              <strong className="text-ink">{unsubCount}</strong>명
            </div>
            <button
              onClick={() => send()}
              disabled={busy || activeCount === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-surface rounded-lg hover:bg-primary-deep disabled:opacity-50 font-medium"
            >
              <Send className="w-3.5 h-3.5" />
              {busy ? "처리 중…" : `전체 발송 (${activeCount}명)`}
            </button>
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-ink-muted text-center py-10">
            등록된 수신자가 없습니다.
          </p>
        ) : (
          <ul className="divide-y divide-border-default">
            {rows.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-3 px-5 py-3 text-sm"
              >
                <span
                  className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-md ${
                    r.status === "active"
                      ? "bg-primary-soft text-primary-deep"
                      : "bg-surface-alt text-ink-muted"
                  }`}
                >
                  {r.status === "active" ? "수신중" : "수신거부"}
                </span>
                <span
                  className={`min-w-0 flex-1 truncate ${
                    r.status === "active"
                      ? "text-ink"
                      : "text-ink-muted line-through"
                  }`}
                >
                  {r.email}
                </span>
                <span className="shrink-0 text-[11px] text-ink-muted tabular-nums">
                  {r.status === "unsubscribed"
                    ? `거부 ${fmtDate(r.unsubscribedAt)}`
                    : r.lastSentAt
                      ? `발송 ${fmtDate(r.lastSentAt)}`
                      : "미발송"}
                </span>
                {r.status === "active" && (
                  <button
                    onClick={() => send([r.id])}
                    disabled={busy}
                    title="이 수신자에게 발송"
                    className="shrink-0 p-1.5 rounded-md text-primary hover:bg-primary-soft disabled:opacity-50"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => remove(r)}
                  disabled={busy}
                  title="삭제"
                  className="shrink-0 p-1.5 rounded-md text-ink-muted hover:text-danger hover:bg-danger-soft disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-[11px] text-ink-muted mt-3 leading-relaxed">
        · 제목 앞에 <code>(광고)</code>가 자동으로 붙고, 본문에 수신거부 링크가
        자동 삽입됩니다 (정보통신망법). · 브로슈어 HTML 에{" "}
        <code>{`{{UNSUBSCRIBE_URL}}`}</code>를 넣으면 그 위치에 수신거부 링크가
        들어갑니다(없으면 본문 하단에 자동 추가). · 수신거부한 주소는 발송
        대상에서 자동 제외되며, 재발송하지 마세요.
      </p>

      {/* 확대 미리보기 모달 */}
      {modalBrochure && (
        <div
          className="fixed inset-0 z-50 bg-ink/60 flex items-center justify-center p-4"
          onClick={() => setModalId(null)}
        >
          <div
            className="bg-card rounded-2xl shadow-xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-5 py-3 border-b border-border-default">
              {modalBrochure.builtin && (
                <span className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-surface-alt text-ink-muted">
                  기본
                </span>
              )}
              <h3 className="text-sm font-semibold text-ink-soft truncate flex-1">
                {modalBrochure.subject}
              </h3>
              <button
                type="button"
                onClick={() => setModalId(null)}
                title="닫기"
                className="shrink-0 p-1.5 rounded-md text-ink-muted hover:text-ink-soft hover:bg-surface-alt"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-auto bg-surface-alt flex justify-center p-3 sm:p-4">
              <iframe
                src={previewUrl(modalBrochure.id)}
                title={`${modalBrochure.subject} 미리보기`}
                className="bg-card shadow rounded"
                style={{ width: 600, maxWidth: "100%", height: "68vh", border: 0 }}
              />
            </div>

            <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-border-default">
              {!modalBrochure.builtin ? (
                <button
                  type="button"
                  onClick={() => removeBrochure(modalBrochure)}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-danger hover:bg-danger-soft rounded-lg disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4" />
                  삭제
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={() => {
                  setSelectedBrochure(String(modalBrochure.id));
                  setModalId(null);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-surface rounded-lg hover:bg-primary-deep font-medium"
              >
                <Check className="w-4 h-4" />
                이 브로슈어로 발송 선택
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
