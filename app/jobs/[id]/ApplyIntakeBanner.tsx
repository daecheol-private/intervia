"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { notify, confirmDialog } from "@/app/components/Dialog";

/**
 * 지원 링크(공개 업로드) 관련 상태 배너 — 공고 상세 상단에 표시.
 *
 *  - 임시 공고: "내용을 채워 정식 등록하세요" 안내 + 수정 링크.
 *  - 정식 공고인데 hold 된 이력서가 있으면: "미평가 N건 — 지금 평가 시작" 버튼.
 *
 * jobId 만으로 GET /api/jobs/[id]/evaluate-held 를 호출해 상태를 스스로 가져온다
 * (상세 페이지의 거대한 상태/타입에 의존하지 않도록 자기완결형으로 분리).
 */
export default function ApplyIntakeBanner({
  jobId,
}: {
  jobId: string | number;
}) {
  const [heldCount, setHeldCount] = useState(0);
  const [pausedCount, setPausedCount] = useState(0);
  const [isDraft, setIsDraft] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/jobs/${jobId}/evaluate-held`);
        if (!r.ok) return;
        const d = (await r.json()) as {
          heldCount?: number;
          pausedCount?: number;
          isDraft?: boolean;
        };
        if (!alive) return;
        setHeldCount(d.heldCount ?? 0);
        setPausedCount(d.pausedCount ?? 0);
        setIsDraft(!!d.isDraft);
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [jobId]);

  async function evaluate() {
    const ok = await confirmDialog(
      `지원 링크로 들어온 미평가 이력서 ${heldCount}건을 AI 평가합니다.\n평가 완료 시 건당 토큰이 차감됩니다. 진행하시겠습니까?`,
      { tone: "warn", title: "이력서 평가 시작", confirmText: "평가 시작" }
    );
    if (!ok) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/jobs/${jobId}/evaluate-held`, { method: "POST" });
      if (!r.ok) {
        let msg = "평가 시작에 실패했습니다.";
        try {
          const j = await r.json();
          if (j?.message) msg = j.message;
        } catch {
          /* non-json */
        }
        notify(msg, { tone: "danger", title: "평가 실패" });
        return;
      }
      const d = (await r.json()) as { enqueued: number };
      notify(
        `${d.enqueued}건의 이력서 평가를 시작했습니다. 잠시 후 아래 목록에 진행 상황이 표시됩니다.`,
        { tone: "success", title: "평가 시작됨" }
      );
      setHeldCount(0);
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return null;
  if (!isDraft && heldCount === 0 && pausedCount === 0) return null;

  return (
    <>
      {isDraft && (
        <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">
            임시 공고입니다 — 아직 정식 등록 전이에요
          </p>
          <p className="mt-1 text-xs text-amber-800 leading-relaxed">
            아래 “지원 링크로 직접 받기”에서 링크를 복사해 사람인 등에 등록할 수 있습니다. 공고
            내용을 채워 저장하면 정식 공고로 전환되고, 그동안 들어온 이력서를 평가할 수 있습니다.
            {heldCount > 0 && ` 현재 지원 이력서 ${heldCount}건이 평가 대기 중입니다.`}
          </p>
          <Link
            href={`/jobs/${jobId}/edit`}
            className="mt-3 inline-flex rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
          >
            공고 내용 작성하고 정식 등록 →
          </Link>
        </div>
      )}

      {!isDraft && heldCount > 0 && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary-soft p-4">
          <p className="text-sm text-primary-deep">
            🔗 지원 링크로 들어온 <b>미평가 이력서 {heldCount}건</b>이 있습니다. 지금 AI 평가를
            시작할 수 있어요.
          </p>
          <button
            onClick={evaluate}
            disabled={busy}
            className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-deep disabled:opacity-50"
          >
            {busy ? "시작 중…" : "지금 평가 시작"}
          </button>
        </div>
      )}

      {pausedCount > 0 && (
        <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm text-amber-900">
            ⏸ 토큰 부족으로 평가가 보류된 이력서 <b>{pausedCount}건</b>이 있습니다. 토큰을 충전하면
            자동으로 평가가 재개됩니다.
          </p>
        </div>
      )}
    </>
  );
}
