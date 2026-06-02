/**
 * 법인 정보 수정 — sysadmin 전용.
 * 수정 가능 필드: name / emailDomain / bizRegistrationNo
 * uniqueness 가드: emailDomain, bizRegistrationNo (자기 자신 제외)
 */
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { requireStepUp } from "@/lib/step-up";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { organizations, users, sessions, candidates } from "@/lib/schema";
import { and, eq, ne, inArray } from "drizzle-orm";
import { normalizeBizNo, formatBizNo } from "@/lib/business-registry";
import { isPublicDomain } from "@/lib/email-domain";
import { deleteCandidateFiles } from "@/lib/candidate-files";

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

/**
 * 법인 영구 삭제 — sysadmin 전용. 매우 파괴적.
 *
 * 전제: 법인이 **정지(suspended)** 상태여야 함 (실수 방지 2단계).
 * 가드: step-up 인증 + 사유 5자+ + confirm 에 법인명 정확히.
 *
 * 삭제 범위:
 *   - 소속 멤버 계정 (system_admin 멤버는 보호 — 법인에서 분리만)
 *   - 후보자 파일(이력서/첨부)은 storage 에서 best-effort 삭제 후 DB 삭제
 *   - 공고·후보자·지갑·원장·SMTP/Zoom 설정 등은 FK ON DELETE CASCADE 로 정리
 *   - 감사 로그는 보존 (orgId 컬럼만 — FK 없음, 컴플라이언스).
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role !== "system_admin")
    return new Response("권한 없음 (시스템 관리자 전용)", { status: 403 });

  const stepUpGuard = await requireStepUp();
  if (stepUpGuard) return stepUpGuard;

  const { id } = await params;
  const orgId = Number(id);
  const body = (await req.json().catch(() => ({}))) as {
    reason?: string;
    confirm?: string;
  };
  const reason = (body.reason ?? "").trim();
  if (reason.length < 5)
    return new Response("삭제 사유는 5자 이상 입력하세요.", { status: 400 });

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, orgId));
  if (!org) return new Response("법인 없음", { status: 404 });

  // 전제조건: 정지된 법인만 삭제 가능 (실수 방지)
  if (!org.suspendedAt)
    return new Response(
      "정지된 법인만 삭제할 수 있습니다. 먼저 법인을 정지한 뒤 삭제하세요.",
      { status: 400 }
    );

  // 실수 방지: 법인명 정확히 입력
  const got = (body.confirm ?? "").trim();
  if (got !== org.name.trim())
    return new Response(
      `실수 방지: 법인명(${org.name}) 을 confirm 필드에 정확히 입력하세요.`,
      { status: 400 }
    );

  // 소속 멤버 분류 — system_admin 은 보호(분리만), 그 외는 계정 삭제 대상.
  const members = await db
    .select({ id: users.id, role: users.role, email: users.email })
    .from(users)
    .where(eq(users.orgId, orgId));
  const protectedIds = members
    .filter((m) => m.role === "system_admin" || m.id === me!.id)
    .map((m) => m.id);
  const deletableMemberIds = members
    .filter((m) => m.role !== "system_admin" && m.id !== me!.id)
    .map((m) => m.id);

  // 후보자 파일 폐기 — DB 삭제 전에 storage 정리 (cascade 는 파일을 지우지 않음).
  const candidateRows = await db
    .select({ id: candidates.id })
    .from(candidates)
    .where(eq(candidates.orgId, orgId));
  const fileResult = await deleteCandidateFiles(candidateRows.map((c) => c.id));

  // 멤버 세션 강제 만료 (본인 세션 보호).
  const allMemberIds = members.map((m) => m.id).filter((uid) => uid !== me!.id);
  if (allMemberIds.length > 0)
    await db.delete(sessions).where(inArray(sessions.userId, allMemberIds));

  // 삭제 대상 멤버 계정 제거 (cascade 로 해당 사용자의 메모·알림·즐겨찾기 등 정리).
  if (deletableMemberIds.length > 0)
    await db.delete(users).where(inArray(users.id, deletableMemberIds));

  // 보호 멤버(system_admin)는 법인에서 분리 — org 삭제 시 FK set null 이지만 명시적으로 처리.
  if (protectedIds.length > 0)
    await db
      .update(users)
      .set({ orgId: null })
      .where(inArray(users.id, protectedIds));

  // 법인 삭제 — 공고/후보자/지갑/원장/설정 등 FK CASCADE 로 정리.
  await db.delete(organizations).where(eq(organizations.id, orgId));

  logAudit(req, {
    actor: me,
    action: "org.delete",
    resourceType: "organization",
    resourceId: orgId,
    orgId,
    metadata: {
      reason,
      orgName: org.name,
      deletedMembers: deletableMemberIds.length,
      protectedMembers: protectedIds.length,
      deletedCandidates: candidateRows.length,
      deletedFiles: fileResult.deletedFiles,
      fileErrors: fileResult.errors,
    },
  });

  return new Response(null, { status: 204 });
}
