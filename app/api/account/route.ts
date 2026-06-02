import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { and, eq, ne, count } from "drizzle-orm";
import { getCurrentUser, verifyPassword, clearSessionCookie } from "@/lib/auth";
import { verifyCode } from "@/lib/totp";
import { decrypt } from "@/lib/crypto";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * 계정 탈퇴 (본인). 파괴적 · 되돌릴 수 없음.
 *
 * 게이트: 비밀번호 재확인 + (2FA 켜져 있으면) 코드 + 이메일 정확히 입력.
 *
 * 차단:
 *   - system_admin: 플랫폼 잠김 방지. 다른 시스템 관리자에게 권한을 넘긴 뒤 가능.
 *   - 마지막 org_admin 이면서 법인에 다른 멤버가 남아있는 경우: 법인이 관리 불능이 됨.
 *     먼저 다른 멤버에게 관리자 권한을 넘겨야 함 (법인 멤버 관리).
 *
 * 삭제 시 세션·알림·즐겨찾기·합류요청·면접관 메모 등은 FK CASCADE 로 정리.
 * 작성한 후보자/공고 참조는 ON DELETE SET NULL — 데이터 자체는 법인에 보존.
 */
export async function DELETE(req: Request) {
  const me = await getCurrentUser();
  if (!me) return new Response("로그인이 필요합니다.", { status: 401 });

  const limited = await rateLimit(
    req,
    "account-delete",
    { limit: 5, windowSec: 60 },
    me.id
  );
  if (limited) return limited;

  if (me.role === "system_admin")
    return new Response(
      "시스템 관리자 계정은 탈퇴할 수 없습니다. 다른 시스템 관리자에게 권한을 이전한 뒤 진행하세요.",
      { status: 409 }
    );

  const { password, code, confirm } = (await req.json().catch(() => ({}))) as {
    password?: string;
    code?: string;
    confirm?: string;
  };
  if (!password) return new Response("비밀번호를 입력하세요.", { status: 400 });

  const [u] = await db.select().from(users).where(eq(users.id, me.id));
  if (!u) return new Response("사용자 없음", { status: 404 });

  // 본인 인증 — 비밀번호 + (2FA 활성 시) 코드
  if (!(await verifyPassword(password, u.passwordHash)))
    return new Response("비밀번호가 일치하지 않습니다.", { status: 401 });
  if (u.totpEnabledAt && u.totpSecret) {
    if (!code)
      return new Response("2단계 인증 코드를 입력하세요.", { status: 400 });
    if (!verifyCode(decrypt(u.totpSecret), code))
      return new Response("인증 코드가 올바르지 않습니다.", { status: 401 });
  }

  // 실수 방지 — 이메일 정확히 입력
  if ((confirm ?? "").trim() !== u.email.trim())
    return new Response(
      `실수 방지: 이메일(${u.email}) 을 정확히 입력하세요.`,
      { status: 400 }
    );

  // 마지막 org_admin 보호 — 법인에 다른 멤버가 남아있으면 관리 불능이 됨.
  if (me.role === "org_admin" && me.orgId != null) {
    const [{ otherAdmins }] = await db
      .select({ otherAdmins: count() })
      .from(users)
      .where(
        and(
          eq(users.orgId, me.orgId),
          eq(users.role, "org_admin"),
          ne(users.id, me.id)
        )
      );
    if (otherAdmins === 0) {
      const [{ otherMembers }] = await db
        .select({ otherMembers: count() })
        .from(users)
        .where(
          and(
            eq(users.orgId, me.orgId),
            ne(users.id, me.id),
            ne(users.status, "disabled")
          )
        );
      if (otherMembers > 0)
        return new Response(
          "법인의 유일한 관리자입니다. 먼저 다른 멤버에게 관리자 권한을 넘긴 뒤 탈퇴할 수 있습니다. (법인 멤버 관리 페이지)",
          { status: 409 }
        );
    }
  }

  await db.delete(users).where(eq(users.id, me.id));
  await clearSessionCookie();

  logAudit(req, {
    actor: me,
    action: "account.self_delete",
    resourceType: "user",
    resourceId: me.id,
    orgId: me.orgId,
    metadata: { email: u.email, name: u.name, role: u.role },
  });

  return new Response(null, { status: 204 });
}
