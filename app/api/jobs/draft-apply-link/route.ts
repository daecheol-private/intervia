import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { generateApplyToken } from "@/lib/apply-link";
import { subdomainApplyEnabled, applyUrlFor } from "@/lib/subdomain";
import { ensureOrgSubdomain } from "@/lib/org-subdomain";

export const runtime = "nodejs";

/**
 * 새 공고 등록 화면의 "지원 링크 미리 발급" — 공고 저장 전에 토큰만 발급한다.
 * 저장 시 이 토큰이 body.applyToken 으로 전달돼 그 공고에 붙는다(apply_token unique 보증).
 *
 * URL 은 로그인 사용자 법인의 서브도메인 정본({sub}.intervia.kr)으로 서버가 구성한다 —
 * 클라이언트가 window.location.origin 으로 조립하면 법인 서브도메인을 몰라 apex 로만
 * 나오던 문제 해결. 기능 OFF·유도 불가(공용 도메인)면 url=null → 클라이언트가 apex 폴백.
 */
export async function POST() {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const token = generateApplyToken();
  const sub = subdomainApplyEnabled()
    ? await ensureOrgSubdomain(me!.orgId)
    : null;
  return Response.json({
    token,
    path: `/apply/${token}`,
    url: sub ? applyUrlFor(sub, token) : null,
  });
}
