import { purgeExpiredOriginals } from "@/lib/purge-original";
import { cleanupOldAttempts } from "@/lib/auth-attempts";
import { cleanupOldRateLog } from "@/lib/rate-limit";
import { runLifecycleSweep } from "@/lib/job-lifecycle";
import { expireInterviewSessions } from "@/lib/expire-sessions";
import { cleanupExpiredSessions } from "@/lib/auth";
import { pruneMailEvents } from "@/lib/mail-usage";
import { cleanupStalePhoneRequests } from "@/lib/notify-phone";
import { cleanupOldPhoneOtps } from "@/lib/phone-otp";
import { secretEquals } from "@/lib/secret-compare";

export const runtime = "nodejs";

/**
 * 되돌릴 수 없는 삭제라 다른 cron 과 인증을 달리한다 — **세션은 받지 않는다**.
 *
 * 세션 쿠키는 SameSite=Lax 라 외부 사이트에서 온 top-level GET 에도 실려 나간다.
 * 그래서 로그인한 system_admin 이 `…/purge-original?days=0` 링크를 한 번 누르면
 * 전 법인 이력서 원본·사진이 영구 삭제됐다(docs/SECURITY_AUDIT_2026-10-31.md C2).
 * CRON_SECRET 헤더는 쿠키가 아니라 브라우저가 자동으로 붙이지 않으므로 이 경로가 막힌다.
 *
 * 미설정이면 열어 두지 않고 멈춘다 — 무인증으로 도는 것보다 안 도는 쪽이 안전하다.
 * (Vercel Cron 은 CRON_SECRET 이 설정돼 있으면 Bearer 헤더를 자동으로 붙인다.)
 */
function authorize(req: Request): Response | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("CRON_SECRET 미설정 — 폐기 크론을 실행하지 않음", { status: 503 });
  if (secretEquals(req.headers.get("authorization"), `Bearer ${secret}`)) return null;
  return new Response("권한 없음", { status: 401 });
}

export async function GET(req: Request) {
  const denied = authorize(req);
  if (denied) return denied;
  // 보관 기간은 정책값(PURGE_AFTER_DAYS)만 쓴다. 옛 `?days=N` 오버라이드는 days=0 한 번이면
  // 전량 삭제라 제거했다 — 기간을 바꿔야 하면 환경변수로 바꾸고 배포한다.
  // 같은 일일 cron 에 끼워서 처리 — Vercel Hobby 2 cron 한도 대응
  const result = await purgeExpiredOriginals();
  const purgedAttempts = await cleanupOldAttempts();
  const purgedRateLog = await cleanupOldRateLog();
  const purgedSessions = await cleanupExpiredSessions();
  const lifecycle = await runLifecycleSweep();
  // 만료 처리 안전망 — expire-interviews 는 외부 cron(cron-job.org, 매시간)에 의존한다.
  // 그 등록이 누락/실패하면 만료 세션 자동불합격·만료 PII 폐기가 영원히 안 돈다. 멱등(이미
  // expired/outcome 설정분은 스킵)이라 일일 cron 에도 끼워 단일 실패점을 제거한다.
  const expiry = await expireInterviewSessions();
  // 메일 발송 집계 로그(mail_send_events) 무한 누적 방지 — 쿼터 창(월)보다 넉넉한 45일 보관.
  const prunedMailEvents = await pruneMailEvents();
  // 면접 일정 알림톡 번호 중 확인하지 않은 채 기한이 한참 지난 것 삭제 (최소 보유).
  const purgedPhoneRequests = await cleanupStalePhoneRequests();
  const purgedPhoneOtps = await cleanupOldPhoneOtps();
  return Response.json({
    ok: true,
    ...result,
    purgedAttempts,
    purgedRateLog,
    purgedSessions,
    lifecycle,
    expiry,
    prunedMailEvents,
    purgedPhoneRequests,
    purgedPhoneOtps,
  });
}

export async function POST(req: Request) {
  return GET(req);
}
