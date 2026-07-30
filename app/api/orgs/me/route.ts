/**
 * 본인 법인 정보 조회. 법인 설정 화면·브랜딩 등에 사용.
 * (면접 장소 주소는 다건이라 별도 — GET /api/orgs/me/addresses)
 */
import { db } from "@/lib/db";
import { organizations } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";

export const runtime = "nodejs";

export async function GET() {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (!me!.orgId) return Response.json({ orgId: null });

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, me!.orgId));
  if (!org) return Response.json({ orgId: null });

  return Response.json({
    id: org.id,
    name: org.name,
    emailDomain: org.emailDomain,
    bizRegistrationNo: org.bizRegistrationNo,
    allowScanOcr: org.allowScanOcr,
    brandColor: org.brandColor,
    hasLogo: !!org.logoFileKey,
  });
}
