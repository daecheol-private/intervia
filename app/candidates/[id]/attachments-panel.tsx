"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { confirmDialog } from "@/app/components/Dialog";
import { Section } from "./shared";

type Attachment = {
  id: number;
  kind: "resume" | "career_history" | "portfolio" | "cover_letter" | "other";
  originalName: string;
  mime: string | null;
  sizeBytes: number;
  createdAt: string;
};

const KIND_OPTIONS = [
  { value: "portfolio", label: "포트폴리오" },
  { value: "career_history", label: "경력기술서" },
  { value: "cover_letter", label: "자기소개서" },
  { value: "other", label: "기타" },
] as const;

const MAX_SIZE = 10 * 1024 * 1024; // 서버 MAX_ATTACHMENT_SIZE 와 동일

export function AttachmentsPanel({
  candidateId,
  screeningDone,
  canModify,
}: {
  candidateId: number;
  // true = 서류평가가 이미 완료됨 → 추가/삭제는 재평가 전까지 평가에 미반영
  screeningDone: boolean;
  // false = 합·불 결정됨 또는 원본 폐기됨 → 추가/삭제 UI 숨김
  canModify: boolean;
}) {
  const [list, setList] = useState<Attachment[] | null>(null);
  const [kind, setKind] = useState<string>("portfolio");
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");
  // 평가 완료 후 첨부를 추가/삭제하면 재평가 안내를 띄운다
  const [rescreenNotice, setRescreenNotice] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const r = await fetch(`/api/candidates/${candidateId}/attachments`);
    setList(r.ok ? ((await r.json()) as Attachment[]) : []);
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateId]);

  if (list == null) return null;

  const extras = list.filter((a) => a.kind !== "resume");
  if (extras.length === 0 && !canModify) return null;

  const kindLabel = {
    career_history: "경력기술서",
    portfolio: "포트폴리오",
    cover_letter: "자기소개서",
    other: "기타",
  } as const;
  const kindColor = {
    career_history: "bg-primary-soft text-primary-deep border-primary/40",
    portfolio: "bg-accent-soft text-accent-deep border-accent/40",
    cover_letter: "bg-info-soft text-info border-info/30",
    other: "bg-surface-alt text-ink-soft border-border-default",
  } as const;

  const upload = async () => {
    const f = fileRef.current?.files?.[0];
    if (!f) {
      setErr("파일을 선택해 주세요.");
      return;
    }
    if (f.size > MAX_SIZE) {
      setErr("파일이 너무 큽니다 (최대 10MB).");
      return;
    }
    setUploading(true);
    setErr("");
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("kind", kind);
      const r = await fetch(`/api/candidates/${candidateId}/attachments`, {
        method: "POST",
        body: fd,
      });
      if (!r.ok) {
        setErr(await r.text());
        return;
      }
      const d = (await r.json()) as { parsed: boolean };
      if (fileRef.current) fileRef.current.value = "";
      if (screeningDone && d.parsed) setRescreenNotice(true);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  const remove = async (a: Attachment) => {
    if (
      !(await confirmDialog(
        `"${a.originalName}" 첨부를 삭제할까요?\n이미 평가에 반영된 첨부라면 재평가해야 평가에서 제외됩니다.`,
        { title: "첨부 삭제", tone: "danger", confirmText: "삭제" }
      ))
    )
      return;
    const r = await fetch(
      `/api/candidates/${candidateId}/attachments/${a.id}`,
      { method: "DELETE" }
    );
    if (!r.ok) {
      setErr(await r.text());
      return;
    }
    if (screeningDone) setRescreenNotice(true);
    await load();
  };

  return (
    <Section title="첨부 파일" collapsible={false}>
      <p className="text-xs text-slate-500 mb-3">
        경력기술서·자기소개서·포트폴리오 등. 텍스트 추출이 가능한 문서(PDF·DOCX·TXT 등)는
        AI 서류평가에 함께 반영되며, 이미지 등 추출 불가 파일은 사람 면접관 참고용입니다.
      </p>
      {rescreenNotice && (
        <div className="text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 mb-3">
          <strong>첨부 변경은 기존 AI 서류평가에 반영되어 있지 않습니다.</strong>{" "}
          이력서는 업로드 시 자동으로 평가되었으므로, 변경된 첨부를 포함해 평가하려면
          상단의 <strong>🔄 재평가</strong> 버튼을 이용하세요. (재평가 성공 시 토큰이
          다시 차감됩니다.)
        </div>
      )}
      {extras.length > 0 && (
        <ul className="space-y-2">
          {extras.map((a) => {
            const k = a.kind as keyof typeof kindLabel;
            return (
              <li
                key={a.id}
                className="flex items-center justify-between gap-3 px-3 py-2 border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                <div className="min-w-0 flex items-center gap-2">
                  <span
                    className={`text-[10px] font-medium px-2 py-0.5 rounded-md border ${kindColor[k]}`}
                  >
                    {kindLabel[k]}
                  </span>
                  <a
                    href={`/api/uploads/candidate/${candidateId}/attachment/${a.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline truncate"
                    title={a.originalName}
                  >
                    📎 {a.originalName}
                  </a>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] text-slate-400">
                    {formatBytes(a.sizeBytes)}
                  </span>
                  {canModify && (
                    <button
                      onClick={() => void remove(a)}
                      className="text-xs text-slate-400 hover:text-danger px-1"
                      title="첨부 삭제"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {canModify && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="text-sm border border-slate-300 rounded-md px-2 py-1.5 bg-white text-slate-700"
            >
              {KIND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.doc,.hwp,.hwpx,.png,.jpg,.jpeg,.pptx,.xlsx,.txt,.md"
              className="text-sm text-slate-600 file:mr-2 file:px-3 file:py-1.5 file:rounded-md file:border file:border-slate-300 file:bg-white file:text-slate-700 file:text-xs file:cursor-pointer hover:file:bg-slate-50"
            />
            <button
              onClick={() => void upload()}
              disabled={uploading}
              className="text-xs px-3 py-1.5 rounded-md bg-primary hover:bg-primary-deep text-white font-medium disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {uploading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {uploading ? "업로드 중..." : "첨부 추가"}
            </button>
          </div>
          <p className="text-[11px] text-slate-400 mt-1.5">
            PDF·DOCX·HWP·이미지 등, 최대 10MB.
          </p>
          {err && <p className="text-xs text-danger mt-1.5 whitespace-pre-wrap">{err}</p>}
        </div>
      )}
    </Section>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}
