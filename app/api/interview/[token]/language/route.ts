/**
 * 면접 진행 언어 설정 — 지원자가 면접 시작 화면(동의 전)에서 선택한다.
 *
 * PATCH body: { language: "ko" | "en" }
 *
 * 채팅이 시작되기 전(messages 비어있고 미완료)에만 변경 가능. 시작 후 변경은
 *   대화·평가 언어 일관성을 깨므로 거부하고 현재값을 반환(locked).
 * 인증: 토큰만. 언어는 비민감 정보이고 본인확인(동의) 이전 단계라 이메일 검증을 두지 않는다.
 */
import { db } from "@/lib/db";
import { interviewSessions } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { normalizeLang } from "@/lib/i18n/interview";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  // 스팸 방지 — IP 분당 10회 (consent 라우트와 동일 정책).
  const limited = await rateLimit(req, "interview.language", {
    limit: 10,
    windowSec: 60,
  });
  if (limited) return limited;

  const { token } = await params;
  const body = (await req.json().catch(() => null)) as {
    language?: unknown;
  } | null;
  const language = normalizeLang(body?.language);

  const [session] = await db
    .select()
    .from(interviewSessions)
    .where(eq(interviewSessions.accessToken, token));
  if (!session) return new Response("세션 없음", { status: 404 });
  if (new Date(session.expiresAt) < new Date())
    return new Response("만료된 세션입니다.", { status: 410 });
  if (session.status === "completed" || session.status === "expired")
    return new Response("이미 종료된 세션입니다.", { status: 409 });

  // 채팅 시작 후에는 언어를 바꾸지 않는다 — 현재값 그대로 반환(멱등).
  if (session.messages.length > 0) {
    return Response.json({ ok: true, language: session.language, locked: true });
  }

  if (session.language !== language) {
    await db
      .update(interviewSessions)
      .set({ language })
      .where(eq(interviewSessions.id, session.id));
  }
  return Response.json({ ok: true, language });
}
