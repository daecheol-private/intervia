/**
 * 법인 정보 수정 — sysadmin 전용.
 * 수정 가능 필드: name / emailDomain / bizRegistrationNo
 * uniqueness 가드: emailDomain, bizRegistrationNo (자기 자신 제외)
 */
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { organizations } from "@/lib/schema";
import { and, eq, ne } from "drizzle-orm";
import { normalizeBizNo, formatBizNo } from "@/lib/business-registry";
import { isPublicDomain } from "@/lib/email-domain";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role !== "system_admin")
    return new Response("권한 없음 (시스템 관리자 전용)", { status: 403 });

  const { id } = await params;
  const orgId = Number(id);
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    emailDomain?: string | null;
    bizRegistrationNo?: string | null;
  };

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, orgId));
  if (!org) return new Response("법인 없음", { status: 404 });

  const changes: Record<string, { from: unknown; to: unknown }> = {};

  // name
  let name: string | undefined;
  if (body.name !== undefined) {
    name = body.name.trim();
    if (!name) return new Response("법인명은 비울 수 없습니다.", { status: 400 });
    if (name !== org.name) changes.name = { from: org.name, to: name };
  }

  // emailDomain (null 가능)
  let emailDomain: string | null | undefined;
  if (body.emailDomain !== undefined) {
    emailDomain =
      body.emailDomain === null
        ? null
        : body.emailDomain.toLowerCase().trim() || null;
    if (emailDomain && isPublicDomain(emailDomain)) {
      return new Response(
        "공용 도메인(gmail.com 등)은 법인 도메인으로 등록할 수 없습니다.",
        { status: 400 }
      );
    }
    if (emailDomain && emailDomain !== org.emailDomain) {
      const [conflict] = await db
        .select({ id: organizations.id, name: organizations.name })
        .from(organizations)
        .where(
          and(
            eq(organizations.emailDomain, emailDomain),
            ne(organizations.id, orgId)
          )
        );
      if (conflict)
        return new Response(
          `${emailDomain} 도메인은 '${conflict.name}' 법인이 이미 사용 중입니다.`,
          { status: 409 }
        );
    }
    if (emailDomain !== org.emailDomain)
      changes.emailDomain = { from: org.emailDomain, to: emailDomain };
  }

  // bizRegistrationNo (null 가능, 형식 정규화)
  let bizRegistrationNo: string | null | undefined;
  if (body.bizRegistrationNo !== undefined) {
    if (body.bizRegistrationNo === null || body.bizRegistrationNo === "") {
      bizRegistrationNo = null;
    } else {
      const norm = normalizeBizNo(body.bizRegistrationNo);
      if (!norm)
        return new Response("사업자번호는 10자리 숫자여야 합니다.", {
          status: 400,
        });
      bizRegistrationNo = formatBizNo(norm);
    }
    if (bizRegistrationNo && bizRegistrationNo !== org.bizRegistrationNo) {
      const [conflict] = await db
        .select({ id: organizations.id, name: organizations.name })
        .from(organizations)
        .where(
          and(
            eq(organizations.bizRegistrationNo, bizRegistrationNo),
            ne(organizations.id, orgId)
          )
        );
      if (conflict)
        return new Response(
          `사업자번호 ${bizRegistrationNo} 는 '${conflict.name}' 법인이 이미 사용 중입니다.`,
          { status: 409 }
        );
    }
    if (bizRegistrationNo !== org.bizRegistrationNo)
      changes.bizRegistrationNo = {
        from: org.bizRegistrationNo,
        to: bizRegistrationNo,
      };
  }

  if (Object.keys(changes).length === 0) {
    return Response.json({ ok: true, changed: false });
  }

  await db
    .update(organizations)
    .set({
      ...(name !== undefined ? { name } : {}),
      ...(emailDomain !== undefined ? { emailDomain } : {}),
      ...(bizRegistrationNo !== undefined ? { bizRegistrationNo } : {}),
    })
    .where(eq(organizations.id, orgId));

  logAudit(req, {
    actor: me,
    action: "org.update",
    resourceType: "organization",
    resourceId: orgId,
    orgId,
    metadata: { changes, orgName: name ?? org.name },
  });

  return Response.json({ ok: true, changed: true, changes });
}
