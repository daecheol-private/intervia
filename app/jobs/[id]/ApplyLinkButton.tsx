"use client";

import { useEffect, useState } from "react";
import { notify } from "@/app/components/Dialog";

/**
 * 공고별 공개 지원 링크 발급·복사.
 *
 * HR 이 이 링크를 사람인·잡코리아 등 공고의 "홈페이지 지원" 주소 칸에 붙여넣으면,
 * 지원자가 클릭해 /apply/[token] 에서 직접 이력서를 올린다(동의 포함).
 * 전체 URL 은 현재 브라우저 origin 으로 구성 — base URL env 의존 회피.
 */
export default function ApplyLinkButton({
  jobId,
  disabled,
  onActive,
}: {
  jobId: string | number;
  disabled?: boolean;
  /** 마운트 시 링크 존재 여부를 알린다(부모가 업로드 섹션 접힘 결정에 사용). 생성 시 true. */
  onActive?: (active: boolean) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // 이미 발급된 링크가 있으면 새로고침 후에도 그대로 보여준다 (재생성 X).
  useEffect(() => {
    let alive = true;
    (async () => {
      let active = false;
      try {
        const r = await fetch(`/api/jobs/${jobId}/apply-link`);
        if (r.ok) {
          const { path, url: branded } = (await r.json()) as {
            path: string | null;
            url: string | null;
          };
          if (path) {
            active = true;
            // 서브도메인 정본 URL 우선 ({sub}.intervia.kr), 미발급이면 현재 origin
            if (alive) setUrl(branded ?? `${window.location.origin}${path}`);
          }
        }
      } catch {
        /* 무시 — 버튼으로 생성 가능 */
      } finally {
        if (alive) onActive?.(active);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  async function generate() {
    setLoading(true);
    try {
      const r = await fetch(`/api/jobs/${jobId}/apply-link`, { method: "POST" });
      if (!r.ok) {
        notify(await r.text(), { tone: "danger", title: "링크 생성 실패" });
        return;
      }
      const { path, url: branded } = (await r.json()) as {
        token: string;
        path: string;
        url: string | null;
      };
      setUrl(branded ?? `${window.location.origin}${path}`);
      onActive?.(true);
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      notify("복사에 실패했습니다. 링크를 직접 선택해 복사해 주세요.", {
        tone: "danger",
      });
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-ink-muted">
          사람인·잡코리아 등 공고의 지원 방법(홈페이지 지원)에 이 링크를 넣으면, 지원자가
          직접 이력서를 올리고 자동으로 평가됩니다.
        </p>
        {!url && (
          <button
            onClick={generate}
            disabled={loading || disabled}
            className="shrink-0 rounded-lg border border-border-strong bg-card px-3 py-1.5 text-xs font-medium text-ink-soft hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "생성 중…" : "지원 링크 만들기"}
          </button>
        )}
      </div>

      {url && (
        <div className="mt-3 flex items-center gap-2">
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 rounded-lg border border-border-strong bg-card px-3 py-1.5 text-xs text-ink-soft"
          />
          <button
            onClick={copy}
            className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-surface hover:opacity-90"
          >
            {copied ? "복사됨 ✓" : "복사"}
          </button>
        </div>
      )}
    </div>
  );
}
