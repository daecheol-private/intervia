/**
 * 본인 법인의 사업자등록번호 등록/수정. org_admin / system_admin 만 가능.
 *
 * 가입은 회사 도메인 이메일만으로 가능(사업자번호 불요)하지만, 세금계산서·정산 등
 * 필요 시점에 여기서 사업자번호를 추가 입력한다. 다른 법인이 이미 쓰는 번호면 차단.
 */
import { db } from "@/lib/db";
import { organizations } from "@/lib/schema";
import { and, eq, ne } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { normalizeBizNo, formatBizNo } from "@/lib/business-registry";

export const runtime = "nodejs";

export async function PUT(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (!me!.orgId) return new Response("법인 없음", { status: 400 });
  if (me!.role !== "org_admin" && me!.role !== "system_admin")
    return new Response(
      "권한 없음 — 법인 관리자만 사업자번호를 수정할 수 있습니다.",
      { status: 403 }
    );

  const body = (await req.json().catch(() => null)) as {
    bizRegistrationNo?: string | null;
  } | null;
  if (!body) return new Response("바디 필요", { status: 400 });

  // 빈 값이면 등록 해제(null) 허용.
  const raw = typeof body.bizRegistrationNo === "string" ? body.bizRegistrationNo.trim() : "";
  let canonical: string | null = null;
  if (raw) {
    const norm = normalizeBizNo(raw);
    if (!norm)
      return new Response("사업자번호는 10자리 숫자여야 합니다.", { status: 400 });
    canonical = formatBizNo(norm);

    // 다른 법인이 같은 번호를 이미 쓰고 있으면 차단 (중복 등록 방지).
    const [taken] = await db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(
        and(
          eq(organizations.bizRegistrationNo, canonical),
          ne(organizations.id, me!.orgId)
        )
      );
    if (taken)
      return new Response(
        `사업자번호 ${canonical} 는 이미 '${taken.name}' 법인으로 등록되어 있습니다.`,
        { status: 409 }
      );
  }

  await db
    .update(organizations)
    .set({ bizRegistrationNo: canonical })
    .where(eq(organizations.id, me!.orgId));

  logAudit(req, {
    actor: me!,
    action: "org.update" as const,
    resourceType: "org" as const,
    resourceId: me!.orgId,
    orgId: me!.orgId,
    metadata: { kind: "biz_registration_no_update", hasBizNo: !!canonical },
  });

  return Response.json({ ok: true, bizRegistrationNo: canonical });
}
