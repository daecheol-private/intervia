"use client";

import { useEffect, useState } from "react";
import { Section } from "./shared";

type Attachment = {
  id: number;
  kind: "resume" | "career_history" | "portfolio" | "cover_letter" | "other";
  originalName: string;
  mime: string | null;
  sizeBytes: number;
  createdAt: string;
};

export function AttachmentsPanel({ candidateId }: { candidateId: number }) {
  const [list, setList] = useState<Attachment[] | null>(null);
  useEffect(() => {
    void fetch(`/api/candidates/${candidateId}/attachments`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setList(d as Attachment[]));
  }, [candidateId]);

  if (list == null) return null;

  // 메인 이력서는 별도 섹션에서 노출되므로 첨부 패널엔 제외
  const extras = list.filter((a) => a.kind !== "resume");
  if (extras.length === 0) return null;

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

  return (
    <Section title="첨부 파일" collapsible={false}>
      <p className="text-xs text-slate-500 mb-3">
        업로드 시 함께 올라온 경력기술서·자기소개서·포트폴리오 등. 텍스트 추출이 가능한 문서(경력기술서·자기소개서 등)는 AI 서류평가에 함께 반영되며, 이미지 등 추출 불가 파일은 사람 면접관 참고용입니다.
      </p>
      <ul className="space-y-2">
        {extras.map((a) => {
          const k = a.kind as
            | "career_history"
            | "portfolio"
            | "cover_letter"
            | "other";
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
              <span className="text-[11px] text-slate-400 shrink-0">
                {formatBytes(a.sizeBytes)}
              </span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}
