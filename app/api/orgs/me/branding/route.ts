/**
 * 본인 법인의 브랜딩(포인트 컬러) 수정 — 지원 페이지·AI 면접 화면 공통. org_admin / system_admin 만 가능.
 * 로고 업로드/삭제는 ./logo/route.ts.
 */
import { db } from "@/lib/db";
import { organizations } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { isValidBrandColor } from "@/lib/brand-color";

export const runtime = "nodejs";

export async function PUT(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (!me!.orgId) return new Response("법인 없음", { status: 400 });
  if (me!.role !== "org_admin" && me!.role !== "system_admin")
    return new Response("권한 없음 — 법인 관리자만 브랜딩을 수정할 수 있습니다.", {
      status: 403,
    });

  const body = (await req.json().catch(() => null)) as {
    brandColor?: string | null;
  } | null;
  if (!body) return new Response("바디 필요", { status: 400 });

  let color: string | null = null;
  if (typeof body.brandColor === "string" && body.brandColor.trim()) {
    color = body.brandColor.trim().toLowerCase();
    if (!isValidBrandColor(color))
      return new Response("색상은 #rrggbb 형식이어야 합니다.", { status: 400 });
  }

  await db
    .update(organizations)
    .set({ brandColor: color })
    .where(eq(organizations.id, me!.orgId));

  logAudit(req, {
    actor: me!,
    action: "org.update" as const,
    resourceType: "org" as const,
    resourceId: me!.orgId,
    orgId: me!.orgId,
    metadata: { kind: "branding_color", color },
  });

  return Response.json({ ok: true, brandColor: color });
}
