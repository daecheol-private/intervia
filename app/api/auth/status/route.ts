import { hasAnyUser, getCurrentUser } from "@/lib/auth";
import { ensureSystemAdmin } from "@/lib/bootstrap-admin";
import { isStaffAlimtalkEnabled } from "@/lib/alimtalk";

export const runtime = "nodejs";

export async function GET() {
  // 환경변수 기반 system_admin 부트스트랩 — 미설정/이미 존재 시 no-op.
  await ensureSystemAdmin();
  const user = await getCurrentUser();
  const setupRequired = !(await hasAnyUser());
  // 가입 폼의 면접 일정 알림톡 번호 칸 표시 여부 — 템플릿 코드가 들어오기 전엔 숨긴다.
  return Response.json({
    user,
    setupRequired,
    staffAlimtalkEnabled: isStaffAlimtalkEnabled(),
  });
}
