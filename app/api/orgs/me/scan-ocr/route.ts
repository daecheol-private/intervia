/**
 * 본인 법인의 "스캔 PDF AI OCR 허용" 토글. org_admin / system_admin 만 가능.
 *
 * ⚠️ 이 토글을 켜면 텍스트 레이어가 없는 스캔 이력서를 평가할 때 *마스킹 전 원본*
 * 이력서가 AI 수탁자(Vertex AI 서울 리전)로 전송된다. 정상 PDF 의 "로컬 마스킹 후
 * 전송" 원칙과 달라지므로, 켜기 전 처리방침·후보자 동의 범위 정비가 선행되어야 한다.
 * 변경은 감사 로그에 남는다.
 */
import { db } from "@/lib/db";
import { organizations } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function PUT(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (!me!.orgId) return new Response("법인 없음", { status: 400 });
  if (me!.role !== "org_admin" && me!.role !== "system_admin")
    return new Response("권한 없음 — 법인 관리자만 변경할 수 있습니다.", {
      status: 403,
    });

  const body = (await req.json().catch(() => null)) as {
    allowScanOcr?: boolean;
  } | null;
  if (!body || typeof body.allowScanOcr !== "boolean")
    return new Response("allowScanOcr(boolean) 필요", { status: 400 });

  await db
    .update(organizations)
    .set({ allowScanOcr: body.allowScanOcr })
    .where(eq(organizations.id, me!.orgId));

  logAudit(req, {
    actor: me!,
    action: "org.update",
    resourceType: "org",
    resourceId: me!.orgId,
    orgId: me!.orgId,
    metadata: { kind: "scan_ocr_toggle", allowScanOcr: body.allowScanOcr },
  });

  return Response.json({ ok: true, allowScanOcr: body.allowScanOcr });
}
