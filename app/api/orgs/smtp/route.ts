import { db } from "@/lib/db";
import { orgSmtpConfigs, organizations } from "@/lib/schema";
import { eq, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { verifySmtpConfig } from "@/lib/mailer";
import { encrypt, decrypt } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

function resolveOrgId(req: Request, meOrgId: number | null): number | null {
  const url = new URL(req.url);
  const param = url.searchParams.get("orgId");
  return param ? Number(param) : meOrgId;
}

function maskPass(p: string): string {
  if (!p) return "";
  // DB 값은 enc:v1: 형식. 평문 길이는 노출하지 않음 (정보 누출 최소화).
  return "************";
}

export async function GET(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role === "member") return new Response("권한 없음", { status: 403 });

  const orgId = resolveOrgId(req, me!.orgId);
  if (!orgId) return new Response("orgId 필요", { status: 400 });
  if (!ownsOrg(me!, orgId)) return new Response("권한 없음", { status: 403 });

  const [cfg] = await db
    .select()
    .from(orgSmtpConfigs)
    .where(eq(orgSmtpConfigs.orgId, orgId));
  if (!cfg) return Response.json(null);

  return Response.json({
    ...cfg,
    authPass: maskPass(cfg.authPass),
  });
}

export async function PUT(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role === "member") return new Response("권한 없음", { status: 403 });

  const orgId = resolveOrgId(req, me!.orgId);
  if (!orgId) return new Response("orgId 필요", { status: 400 });
  if (!ownsOrg(me!, orgId)) return new Response("권한 없음", { status: 403 });

  const body = (await req.json().catch(() => null)) as {
    host?: string;
    port?: number;
    secure?: boolean;
    authUser?: string;
    authPass?: string;
    fromEmail?: string;
    fromName?: string | null;
  } | null;
  if (!body) return new Response("잘못된 요청", { status: 400 });

  const host = body.host?.trim();
  const port = Number(body.port ?? 465);
  const secure = body.secure !== false;
  const authUser = body.authUser?.trim();
  const fromEmail = body.fromEmail?.trim();
  const fromName = body.fromName?.trim() || null;
  // Gmail 앱 비밀번호는 "abcd efgh ijkl mnop" 형태로 표시됨 — 공백 자동 제거
  const stripWs = (s: string) => s.replace(/\s+/g, "");

  if (!host || !authUser || !fromEmail)
    return new Response("host / authUser / fromEmail 필수", { status: 400 });
  if (!Number.isFinite(port) || port < 1 || port > 65535)
    return new Response("port 가 올바르지 않습니다", { status: 400 });

  // 발신 주소(fromEmail) 도메인 정합성 — 인증된 SMTP 계정 도메인 또는 가입 시 검증된
  // 회사 도메인과 일치해야 함. 타사(예: 유명 기업) 도메인을 사칭한 발신을 차단.
  // 허용 도메인을 하나도 특정할 수 없으면(둘 다 도메인 없음) best-effort 로 통과.
  const fromDomain = fromEmail.split("@")[1]?.toLowerCase() ?? "";
  if (!fromDomain)
    return new Response("fromEmail 형식이 올바르지 않습니다", { status: 400 });
  const authUserDomain = authUser.includes("@")
    ? authUser.split("@")[1]?.toLowerCase()
    : null;
  const [orgRow] = await db
    .select({ emailDomain: organizations.emailDomain })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  const allowedDomains = new Set(
    [authUserDomain, orgRow?.emailDomain?.toLowerCase()].filter(Boolean)
  );
  if (allowedDomains.size > 0 && !allowedDomains.has(fromDomain)) {
    return new Response(
      `발신 이메일 도메인(@${fromDomain})은 SMTP 계정 도메인 또는 검증된 회사 도메인과 일치해야 합니다. ` +
        `회사 도메인으로 발송하려면 가입 시 등록한 회사 도메인 이메일을 사용하거나 운영자에게 도메인 검증을 요청하세요.`,
      { status: 400 }
    );
  }

  // 기존 설정 가져와서 authPass 미지정 시 보존
  const [existing] = await db
    .select()
    .from(orgSmtpConfigs)
    .where(eq(orgSmtpConfigs.orgId, orgId));

  // 마스킹 문자(*)가 포함된 값은 변경 안 한 것으로 간주
  const incomingPass = body.authPass ?? "";
  const isMasked = incomingPass.includes("*");
  // plainPass: 헬스체크·verifySmtpConfig 에 사용할 평문. 기존 저장 값은 enc 일 수도 있어서 decrypt 처리.
  const plainPass =
    !incomingPass || isMasked
      ? existing?.authPass
        ? decrypt(existing.authPass)
        : ""
      : stripWs(incomingPass);
  if (!plainPass) return new Response("authPass 필수", { status: 400 });

  // 저장 전 헬스체크 (평문으로)
  const health = await verifySmtpConfig({
    host,
    port,
    secure,
    authUser,
    authPass: plainPass,
  });

  // DB 에는 항상 암호화 저장
  const storedPass = encrypt(plainPass);

  const row = {
    orgId,
    host,
    port,
    secure,
    authUser,
    authPass: storedPass,
    fromEmail,
    fromName,
    lastCheckedAt: new Date().toISOString(),
    lastCheckStatus: health.ok ? ("ok" as const) : ("fail" as const),
    lastCheckError: health.ok ? null : health.error,
    updatedByUserId: me!.id,
    updatedAt: sql`CURRENT_TIMESTAMP` as unknown as string,
  };

  if (existing) {
    await db
      .update(orgSmtpConfigs)
      .set(row)
      .where(eq(orgSmtpConfigs.orgId, orgId));
  } else {
    await db.insert(orgSmtpConfigs).values(row);
  }

  logAudit(req, {
    actor: me!,
    action: "org.smtp_update",
    resourceType: "org",
    resourceId: orgId,
    orgId,
    metadata: { host, port, secure, fromEmail, health_ok: health.ok },
  });

  return Response.json({
    ok: health.ok,
    error: health.ok ? null : health.error,
  });
}

export async function DELETE(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role === "member") return new Response("권한 없음", { status: 403 });

  const orgId = resolveOrgId(req, me!.orgId);
  if (!orgId) return new Response("orgId 필요", { status: 400 });
  if (!ownsOrg(me!, orgId)) return new Response("권한 없음", { status: 403 });

  await db.delete(orgSmtpConfigs).where(eq(orgSmtpConfigs.orgId, orgId));

  logAudit(req, {
    actor: me!,
    action: "org.smtp_delete",
    resourceType: "org",
    resourceId: orgId,
    orgId,
  });

  return new Response(null, { status: 204 });
}
