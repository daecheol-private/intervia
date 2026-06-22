"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { XCircle } from "lucide-react";

// 결제 실패/취소 시 토스가 ?code=&message= 로 리다이렉트. 결제 미확정이라 주문은 pending 으로
// 남고 토큰·청구 영향 없음(재시도 시 새 주문 생성). 여기서는 안내만 한다.
function FailInner() {
  const params = useSearchParams();
  const code = params.get("code") ?? "";
  const message = params.get("message");
  const isCancel = code === "USER_CANCEL" || code === "PAY_PROCESS_CANCELED";

  return (
    <main className="max-w-md mx-auto px-4 py-16">
      <div className="rounded-2xl border border-border-default bg-card p-8 text-center shadow-sm">
        <XCircle className="w-12 h-12 mx-auto text-ink-muted" />
        <h1 className="text-lg font-bold text-ink mt-4">
          {isCancel ? "결제가 취소되었습니다" : "결제에 실패했습니다"}
        </h1>
        <p className="text-sm text-ink-soft mt-2 whitespace-pre-wrap">
          {message ||
            (isCancel
              ? "결제를 취소하셨습니다. 다시 시도하실 수 있습니다."
              : "결제를 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.")}
        </p>
        {code && !isCancel && (
          <p className="text-[11px] text-ink-muted mt-2">오류 코드: {code}</p>
        )}
        <Link
          href="/org/tokens"
          className="mt-6 inline-block text-sm px-5 py-2.5 rounded-lg bg-primary hover:bg-primary-deep text-surface font-medium transition-colors"
        >
          다시 시도하기
        </Link>
      </div>
    </main>
  );
}

export default function ChargeFailPage() {
  return (
    <Suspense
      fallback={
        <main className="max-w-md mx-auto px-4 py-16 text-center text-sm text-ink-muted">
          불러오는 중…
        </main>
      }
    >
      <FailInner />
    </Suspense>
  );
}
