/**
 * 민감 액션 step-up 인증 — 로그인된 사용자가 비밀번호 재입력으로 본인 확인.
 * 성공 시 sessions.step_up_verified_at 갱신. TTL 10분간 같은 세션에서 유효.
 */
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser, verifyPassword } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { markStepUpVerified } from "@/lib/step-up";
import { cookies } from "next/headers";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const limited = await rateLimit(
    req,
    "step-up",
    { limit: 5, windowSec: 60 },
    me!.id
  );
  if (limited) return limited;

  const body = (await req.json().catch(() => null)) as {
    password?: string;
  } | null;
  if (!body?.password)
    return new Response("비밀번호 필요", { status: 400 });

  const [row] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, me!.id));
  if (!row) return new Response("사용자 없음", { status: 404 });

  const ok = await verifyPassword(body.password, row.passwordHash);
  if (!ok) {
    logAudit(req, {
      actor: me!,
      action: "user.status_change",
      resourceType: "user",
      resourceId: me!.id,
      orgId: me!.orgId,
      metadata: { kind: "step_up_failed" },
    });
    return Response.json(
      { ok: false, message: "비밀번호가 일치하지 않습니다." },
      { status: 401 }
    );
  }

  const c = await cookies();
  const token = c.get("session")?.value;
  if (!token) return new Response("세션 없음", { status: 401 });
  await markStepUpVerified(token);

  logAudit(req, {
    actor: me!,
    action: "user.status_change",
    resourceType: "user",
    resourceId: me!.id,
    orgId: me!.orgId,
    metadata: { kind: "step_up_ok" },
  });

  return Response.json({ ok: true, ttlSec: 10 * 60 });
}
