/**
 * 사업자번호 검증 + 기존 법인 매칭 — 비로그인.
 *
 * 응답:
 *   - registered: 국세청에 등록된 활성 사업자인지 (API 키 없으면 unknown)
 *   - existingOrg: 같은 사업자번호로 이미 등록된 법인 — 신규 가입자에게 자동 매칭 안내
 */
import { db } from "@/lib/db";
import { organizations } from "@/lib/schema";
import { eq } from "drizzle-orm";
import {
  isBusinessRegistryConfigured,
  lookupBusinessStatus,
  normalizeBizNo,
  formatBizNo,
} from "@/lib/business-registry";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const limited = await rateLimit(req, "verify-biz", { limit: 10, windowSec: 60 });
  if (limited) return limited;

  const { bizNo } = (await req.json().catch(() => ({}))) as { bizNo?: string };
  if (!bizNo) return new Response("사업자번호 필수", { status: 400 });

  const normalized = normalizeBizNo(bizNo);
  if (!normalized)
    return Response.json({
      ok: false,
      reason: "사업자번호는 10자리 숫자입니다.",
    });

  // 1) 우리 DB 에 같은 사업자번호 법인 있는지
  const [existing] = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      emailDomain: organizations.emailDomain,
    })
    .from(organizations)
    .where(eq(organizations.bizRegistrationNo, formatBizNo(normalized)));

  // 2) 국세청 API 키가 있으면 외부 검증
  let registered: boolean | null = null;
  let status: string | null = null;
  let externalError: string | null = null;
  if (isBusinessRegistryConfigured()) {
    try {
      const r = await lookupBusinessStatus(normalized);
      if (r) {
        registered = r.active;
        status = r.status;
      } else {
        registered = false;
        status = "조회 결과 없음";
      }
    } catch (e) {
      externalError = e instanceof Error ? e.message : String(e);
    }
  }

  return Response.json({
    ok: true,
    bizNoFormatted: formatBizNo(normalized),
    registered,
    status,
    externalError,
    apiAvailable: isBusinessRegistryConfigured(),
    existingOrg: existing ?? null,
  });
}
