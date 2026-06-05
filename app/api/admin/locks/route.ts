/**
 * 시스템관리자용: 현재 로그인 잠금 상태인 email/IP 목록 + 강제 해제.
 *
 * GET  /api/admin/locks       → 현재 잠긴 식별자 목록
 * POST /api/admin/locks/unlock { email?, ip? } → 해당 실패 기록 즉시 삭제
 *
 * 락아웃 DoS (공격자가 타인 이메일로 의도적 실패 → 계정 잠금) 대응.
 */
import { getCurrentUser } from "@/lib/auth";
import { requireUser, requirePasswordChanged } from "@/lib/tenant";
import { listLockedIdentifiers } from "@/lib/auth-attempts";

export const runtime = "nodejs";

export async function GET() {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role !== "system_admin")
    return new Response("권한 없음", { status: 403 });
  const pwGuard = requirePasswordChanged(me);
  if (pwGuard) return pwGuard;

  const rows = await listLockedIdentifiers();
  return Response.json(rows);
}
