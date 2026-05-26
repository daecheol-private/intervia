/**
 * 큐 워커를 즉시 깨우는 헬퍼. fire-and-forget.
 * cron 안전망과 별개로, enqueue 직후 빠른 처리를 위해 호출.
 */
export function triggerWorker(req?: Request): void {
  const base =
    process.env.APP_BASE_URL ??
    (req ? new URL(req.url).origin : "http://localhost:3002");
  const url = `${base}/api/internal/process-screenings`;
  // 응답 안 기다림 — 호출자 응답 지연 방지
  void fetch(url, {
    method: "POST",
    headers: {
      "X-Internal-Secret": process.env.INTERNAL_API_SECRET ?? "",
    },
  }).catch((e) => {
    // 워커가 살아있어 다음 cron 에 처리되므로 비치명적
    console.error("[worker-trigger] failed:", e instanceof Error ? e.message : e);
  });
}
