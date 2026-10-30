import { after } from "next/server";
import { consumeVerificationToken } from "@/lib/email-verify";
import { sendWelcomeMail } from "@/lib/email-welcome";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { token } = (await req.json().catch(() => ({}))) as { token?: string };
  if (!token) return new Response("token 필수", { status: 400 });
  const result = await consumeVerificationToken(token);
  if (!result.ok) return new Response(result.reason ?? "검증 실패", { status: 400 });

  // 환영 메일(서비스 소개서·사용 설명서) — 첫 인증 완료 때 한 번만, 법인 개설자에게만.
  // 응답 뒤에 보낸다: 발송 실패나 지연이 인증 완료를 막아서는 안 된다.
  // void 는 서버리스 suspend 로 잘려 유실되므로 after() 를 쓴다 (GOTCHAS §0-1).
  if (result.firstVerification && result.userId) {
    const userId = result.userId;
    const baseUrl = process.env.APP_BASE_URL ?? new URL(req.url).origin;
    after(() =>
      sendWelcomeMail({ userId, baseUrl }).catch((e) =>
        console.error("[verify-email] 환영 메일 발송 실패:", e)
      )
    );
  }

  return Response.json({ ok: true });
}
