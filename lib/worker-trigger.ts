/**
 * 내부 워커(큐 라우트)를 다시 호출하는 루프백 base URL.
 *
 * ⚠️ 메일/알림톡 등 "외부로 나가는 링크"에는 절대 쓰지 말 것 — 그건 공개 URL(APP_BASE_URL).
 *    이 함수는 오직 "자기 서버의 워커 라우트를 다시 부르는" 내부 루프백 전용이다.
 *
 * - 개발: 요청 origin(없으면 localhost:3003). **APP_BASE_URL 을 의도적으로 무시한다** —
 *   로컬 .env.local 에 운영 URL(https://intervia.kr, 알림톡 링크용 등)이 들어 있어도
 *   워커 깨우기 요청이 운영 서버로 새지 않게. (샜을 때 로컬 큐 잡이 영원히 처리 안 돼
 *   이력서/녹취 평가가 무한 "평가중" 으로 정체됐다 — 로컬엔 cron 안전망도 없음.)
 * - 운영: APP_BASE_URL(안정적 자기 도메인) 우선. Vercel 함수의 req origin 은 배포 URL 과
 *   어긋날 수 있어 명시 URL 을 먼저 쓴다. 없으면 origin/localhost 로 폴백.
 */
export function workerBaseUrl(req?: Request): string {
  const origin = req ? new URL(req.url).origin : "http://localhost:3003";
  if (process.env.NODE_ENV !== "production") return origin;
  return process.env.APP_BASE_URL ?? origin;
}

/**
 * 큐 워커를 즉시 깨우는 헬퍼. fire-and-forget.
 * cron 안전망과 별개로, enqueue 직후 빠른 처리를 위해 호출.
 */
export function triggerWorker(req?: Request): void {
  const url = `${workerBaseUrl(req)}/api/internal/process-screenings`;
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
