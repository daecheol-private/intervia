import { db } from "@/lib/db";
import { users, organizations } from "@/lib/schema";
import { eq } from "drizzle-orm";
import {
  verifyPassword,
  createSession,
  setSessionCookie,
} from "@/lib/auth";
import {
  isLocked,
  recordAttempt,
  extractIp,
  LOCK_WINDOW_MINUTES,
} from "@/lib/auth-attempts";
import { logAudit } from "@/lib/audit";
import { issueLoginChallenge } from "@/lib/login-challenge";
import { ensureSystemAdmin } from "@/lib/bootstrap-admin";

export const runtime = "nodejs";

function jsonError(
  message: string,
  status: number,
  extra?: Record<string, unknown>
): Response {
  return new Response(JSON.stringify({ error: message, ...extra }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req: Request) {
  const { email, password } = (await req.json()) as {
    email?: string;
    password?: string;
  };

  if (!email || !password)
    return new Response("이메일/비밀번호 필수", { status: 400 });

  // 환경변수 기반 system_admin 부트스트랩 — 첫 로그인 시도 시 계정이 없으면 생성.
  // (status 라우트를 거치지 않고 직접 로그인하는 경우 대비) 미설정/이미 존재 시 no-op.
  await ensureSystemAdmin();

  const ip = extractIp(req);
  const userAgent = req.headers.get("user-agent");
  const normalizedEmail = email.toLowerCase().trim();

  // 1) 잠금 체크 — 비밀번호 검증 전에 (계정 enum 방지 + 부하 절감)
  const lock = await isLocked(normalizedEmail, ip);
  if (lock.locked) {
    const minutes = Math.ceil(lock.retryAfterSeconds / 60);
    return jsonError(
      `너무 많은 로그인 실패. 약 ${minutes}분 후 다시 시도해 주세요.`,
      429,
      {
        code: "rate_limited",
        retryAfterSeconds: lock.retryAfterSeconds,
      }
    );
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizedEmail));

  // 사용자 존재 + 비번 일치 여부를 한 묶음으로 처리 (계정 enum 방지)
  const passwordOk = user
    ? await verifyPassword(password, user.passwordHash)
    : false;

  if (!user || !passwordOk) {
    // 실패 기록
    await recordAttempt({
      email: normalizedEmail,
      ip,
      success: false,
      userAgent,
    });
    return new Response("이메일 또는 비밀번호가 올바르지 않습니다.", {
      status: 401,
    });
  }

  // 인증/상태 가드 — 실패 카운터에 포함하지 않음 (정상 사용자가 메일 인증 안 한 케이스 등)
  // 합류 요청 사용자는 emailVerifiedAt=null + status=pending 이므로 승인 대기 메시지가 우선
  if (user.status === "pending")
    return new Response("법인 관리자의 승인 대기 중입니다.", { status: 403 });
  if (!user.emailVerifiedAt)
    return jsonError("이메일 인증이 필요합니다.", 403, {
      code: "email_unverified",
    });
  if (user.status === "disabled")
    return new Response("비활성 계정입니다. 관리자에게 문의하세요.", {
      status: 403,
    });

  // 법인 정지 가드 — system_admin 은 우회 (정지 해제 위해 접근 필요)
  if (user.orgId != null && user.role !== "system_admin") {
    const [org] = await db
      .select({
        suspendedAt: organizations.suspendedAt,
        suspendedReason: organizations.suspendedReason,
      })
      .from(organizations)
      .where(eq(organizations.id, user.orgId));
    if (org?.suspendedAt) {
      const reason = org.suspendedReason ? ` (${org.suspendedReason})` : "";
      return new Response(
        `소속 법인이 일시 정지 상태입니다.${reason} 시스템 관리자에게 문의하세요.`,
        { status: 403 }
      );
    }
  }

  // 2FA 활성 사용자: 비번 검증까지만 통과시키고 세션은 아직 안 만듦.
  // challenge token 발급 → 클라이언트가 /api/auth/login/totp 로 코드 제출 시 세션 발급.
  if (user.totpEnabledAt) {
    // 실패 기록 reset 은 TOTP 까지 통과한 시점에 함 — 비번만 알고 TOTP 모르는 공격자는 잠금 카운트 유지
    const challenge = issueLoginChallenge(user.id);
    return Response.json({ needsTotp: true, challenge });
  }

  // 성공 — 실패 기록 리셋 + 세션 발급
  await recordAttempt({
    email: normalizedEmail,
    ip,
    success: true,
    userAgent,
  });
  void LOCK_WINDOW_MINUTES; // 정책 노출용 export 유지

  const token = await createSession(user.id, { ip, userAgent });
  await setSessionCookie(token);

  logAudit(req, {
    actor: {
      id: user.id,
      email: user.email,
      name: user.name,
      isAdmin: !!user.isAdmin || user.role === "system_admin",
      orgId: user.orgId,
      role: user.role,
      status: user.status,
      mustChangePassword: !!user.mustChangePassword,
      sessionToken: token,
    },
    action: "login.success",
    resourceType: "user",
    resourceId: user.id,
  });

  return Response.json({ id: user.id, email: user.email, name: user.name });
}
