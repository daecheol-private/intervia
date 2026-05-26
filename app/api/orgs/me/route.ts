/**
 * 본인 법인 정보 조회. 면접 스케쥴 제시 시 회사 주소 prefill 등에 사용.
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
    officeAddress: org.officeAddress,
    officeAddressDetail: org.officeAddressDetail,
  });
}
