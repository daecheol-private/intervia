import { after } from "next/server";
import { consumeVerificationToken, peekVerificationToken } from "@/lib/email-verify";
import { sendWelcomeMail } from "@/lib/email-welcome";
import { db } from "@/lib/db";
import { users, organizations } from "@/lib/schema";
import { and, eq, ne } from "drizzle-orm";
import { verifyPassword } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const limited = await rateLimit(req, "verify-email", { limit: 10, windowSec: 600 });
  if (limited) return limited;

  const { token, password } = (await req.json().catch(() => ({}))) as {
    token?: string;
    password?: string;
  };
  if (!token) return new Response("token 필수", { status: 400 });
  if (!password) return new Response("가입할 때 정한 비밀번호를 입력해 주세요.", { status: 400 });

  // 가입할 때 정한 비밀번호를 아는 사람만 인증할 수 있다 — 남의 이메일로 가입한 사람의 계정을
  // 진짜 이메일 주인이 링크를 눌러 살려주는 일을 막는다(감사 C5).
  const peek = await peekVerificationToken(token);
  if (!peek.ok) return new Response(peek.reason, { status: 400 });
  const [u] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, peek.userId));
  if (!u || !(await verifyPassword(password, u.passwordHash)))
    return new Response(
      "비밀번호가 맞지 않습니다. 직접 가입하지 않았다면 이 메일은 무시하세요. 비밀번호를 잊었다면 로그인 화면의 '비밀번호 찾기'로 새로 정한 뒤 다시 시도하세요.",
      { status: 401 }
    );

  const result = await consumeVerificationToken(token);
  if (!result.ok) return new Response(result.reason ?? "검증 실패", { status: 400 });

  if (result.firstVerification && result.userId) {
    const userId = result.userId;
    // 신규 가입 체험 토큰은 이메일 인증을 마친 뒤에 지급 — 인증 안 한 가입으로 토큰을 받지 못하게.
    // 검토 대기 법인은 운영자 승인 때 지급(기존과 동일). grantWelcomeBonus 는 멱등.
    const [org] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(
        and(
          eq(organizations.createdByUserId, userId),
          ne(organizations.verificationStatus, "pending_review")
        )
      );
    if (org) {
      const { grantWelcomeBonus } = await import("@/lib/tokens");
      await grantWelcomeBonus(org.id, userId);
    }

    // 환영 메일(서비스 소개서·사용 설명서) — 첫 인증 완료 때 한 번만, 법인 개설자에게만.
    // 응답 뒤에 보낸다: 발송 실패나 지연이 인증 완료를 막아서는 안 된다.
    // void 는 서버리스 suspend 로 잘려 유실되므로 after() 를 쓴다 (GOTCHAS §0-1).
    const baseUrl = process.env.APP_BASE_URL ?? new URL(req.url).origin;
    after(() =>
      sendWelcomeMail({ userId, baseUrl }).catch((e) =>
        console.error("[verify-email] 환영 메일 발송 실패:", e)
      )
    );
  }

  return Response.json({ ok: true });
}
