"use client";

import { useEffect, useState } from "react";
import { Share2, Check } from "lucide-react";

/**
 * 줌 가이드 공개 링크(/zoom-guide) 복사 버튼 — 관리자 가이드(/org/zoom/guide) 상단에서
 * 계정 없는 담당자에게 전달할 링크를 클립보드로 복사한다. 현재 접속 도메인 기준으로 조립.
 */
export function ZoomShareLinkButton() {
  const [shareUrl, setShareUrl] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setShareUrl(`${window.location.origin}/zoom-guide`);
  }, []);

  const copy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 클립보드 접근 실패(비 secure context 등) — 조용히 무시
    }
  };

  return (
    <button
      onClick={copy}
      title="Intervia 계정 없이 볼 수 있는 공개 가이드 링크를 복사합니다"
      className="inline-flex items-center gap-1.5 shrink-0 px-3 py-2 rounded-lg border border-border-strong text-sm font-medium text-ink-soft hover:bg-surface-alt transition-colors"
    >
      {copied ? (
        <>
          <Check className="w-4 h-4 text-primary" />
          링크 복사됨
        </>
      ) : (
        <>
          <Share2 className="w-4 h-4" />
          링크 공유하기
        </>
      )}
    </button>
  );
}
