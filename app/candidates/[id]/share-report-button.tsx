"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Share2,
  Copy,
  Check,
  Loader2,
  X,
  Link2,
  ExternalLink,
} from "lucide-react";
import { formatLocalDate, formatLocalDateTime } from "@/lib/utils";

type ShareLink = {
  id: number;
  token: string;
  path: string;
  expiresAt: string;
  createdAt: string;
  viewCount: number;
  lastViewedAt: string | null;
};

export function ShareReportButton({ candidateId }: { candidateId: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-border-strong text-ink-soft hover:border-primary/50 hover:text-primary hover:bg-primary-soft transition-colors"
        title="평가 공유"
        aria-label="평가 공유"
      >
        <Share2 className="w-4 h-4" />
      </button>
      {open && (
        <ShareModal candidateId={candidateId} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function ShareModal({
  candidateId,
  onClose,
}: {
  candidateId: number;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [link, setLink] = useState<ShareLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/share`);
      if (!res.ok) throw new Error();
      const j = (await res.json()) as { link: ShareLink | null };
      setLink(j.link);
    } catch {
      setErr("링크 정보를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [candidateId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error();
      const j = (await res.json()) as { link: ShareLink };
      setLink(j.link);
      setCopied(false);
    } catch {
      setErr("링크 발급에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/candidates/${candidateId}/share`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      setLink(null);
    } catch {
      setErr("링크 폐기에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const fullUrl =
    link && typeof window !== "undefined"
      ? `${window.location.origin}${link.path}`
      : link?.path ?? "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setErr("복사에 실패했습니다. 링크를 직접 선택해 복사하세요.");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="평가 리포트 공유"
    >
      <div
        className="w-full max-w-md bg-surface rounded-2xl shadow-xl border border-border-default"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-default">
          <div className="flex items-center gap-2">
            <Share2 className="w-4 h-4 text-primary" />
            <h2 className="text-base font-semibold text-ink">평가 리포트 공유</h2>
          </div>
          <button
            onClick={onClose}
            className="text-ink-muted hover:text-ink transition-colors"
            aria-label="닫기"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-xs text-ink-muted leading-relaxed">
            Intervia 계정이 없는 사람도 이 링크로 평가 리포트를 볼 수 있습니다. 이력서
            원본·연락처·사진은 공유되지 않고, <strong className="text-ink-soft">평가 결과만</strong>{" "}
            표시됩니다. 언제든 폐기할 수 있습니다.
          </p>

          {loading ? (
            <div className="py-8 flex justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-ink-muted" />
            </div>
          ) : link ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 bg-surface-alt border border-border-default rounded-lg pl-3 pr-1.5 py-1.5">
                <Link2 className="w-4 h-4 text-ink-muted shrink-0" />
                <input
                  readOnly
                  value={fullUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 bg-transparent text-sm text-ink-soft truncate outline-none"
                />
                <button
                  onClick={copy}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    copied
                      ? "bg-success-soft text-success"
                      : "bg-primary text-surface hover:bg-primary-deep"
                  }`}
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5" /> 복사됨
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" /> 복사
                    </>
                  )}
                </button>
              </div>

              <div className="text-xs text-ink-muted flex flex-wrap gap-x-4 gap-y-1">
                <span>만료 {formatLocalDate(link.expiresAt)}</span>
                <span>열람 {link.viewCount}회</span>
                {link.lastViewedAt && (
                  <span>최근 {formatLocalDateTime(link.lastViewedAt)}</span>
                )}
              </div>

              <div className="flex items-center gap-2 pt-1">
                <a
                  href={fullUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border-strong text-ink-soft hover:bg-surface-alt text-sm font-medium transition-colors"
                >
                  미리보기 <ExternalLink className="w-3.5 h-3.5" />
                </a>
                <button
                  onClick={create}
                  disabled={busy}
                  className="px-3 py-1.5 rounded-lg border border-border-strong text-ink-soft hover:bg-surface-alt text-sm font-medium transition-colors disabled:opacity-50"
                >
                  재발급
                </button>
                <button
                  onClick={revoke}
                  disabled={busy}
                  className="ml-auto px-3 py-1.5 rounded-lg border border-danger/40 text-danger hover:bg-danger-soft text-sm font-medium transition-colors disabled:opacity-50"
                >
                  폐기
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={create}
              disabled={busy}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary hover:bg-primary-deep text-surface text-sm font-semibold transition-colors disabled:opacity-50 shadow-sm"
            >
              {busy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Share2 className="w-4 h-4" />
              )}
              공유 링크 만들기
            </button>
          )}

          {err && <p className="text-xs text-danger">{err}</p>}
        </div>
      </div>
    </div>
  );
}
