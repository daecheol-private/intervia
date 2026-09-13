/**
 * 법인 관리자가 멤버의 면접 일정 알림톡 번호를 대신 등록·삭제.
 *
 * 면접관은 서비스에 잘 들어오지 않아 본인 등록을 기다리기 어렵다 — 관리자가 대신 입력하되,
 * 알림은 그 번호의 주인이 카카오톡에서 "번호 확인"을 눌러야 켜진다(동의 기록 + 오타 방지).
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import {
  getPhoneStatus,
  removePhone,
  requestPhoneVerification,
} from "@/lib/notify-phone";

export const runtime = "nodejs";

async function loadTarget(idParam: string) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return { error: guard } as const;
  if (me!.role === "member")
    return { error: new Response("권한 없음", { status: 403 }) } as const;
  const id = Number(idParam);
  if (!Number.isInteger(id))
    return { error: new Response("잘못된 사용자 id", { status: 400 }) } as const;
  const [target] = await db
    .select({ id: users.id, name: users.name, orgId: users.orgId, status: users.status })
    .from(users)
    .where(eq(users.id, id));
  if (!target || target.orgId == null || !ownsOrg(me!, target.orgId))
    return { error: new Response("Not found", { status: 404 }) } as const;
  return { me: me!, target: { ...target, orgId: target.orgId } } as const;
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const t = await loadTarget(id);
  if ("error" in t) return t.error;

  const limited = await rateLimit(
    req,
    "notify-phone-admin",
    { limit: 20, windowSec: 600 },
    t.me.id
  );
  if (limited) return limited;
  if (t.target.status === "disabled")
    return new Response("비활성 멤버에게는 등록할 수 없습니다.", { status: 409 });

  const body = (await req.json().catch(() => null)) as { phone?: unknown } | null;
  if (typeof body?.phone !== "string")
    return new Response("휴대폰 번호를 입력해 주세요.", { status: 400 });

  const r = await requestPhoneVerification({
    owner: { userId: t.target.id },
    orgId: t.target.orgId,
    name: t.target.name,
    phone: body.phone,
    requestedByUserId: t.me.id,
    force: true,
  });
  if (!r.ok) return new Response(r.error, { status: 400 });

  logAudit(req, {
    actor: t.me,
    action: "notify_phone.set_by_admin",
    resourceType: "user",
    resourceId: t.target.id,
    orgId: t.target.orgId,
    metadata: { status: r.status, sent: r.sent },
  });
  return Response.json({
    ok: true,
    sent: r.sent,
    reason: r.reason ?? null,
    notifyPhone: await getPhoneStatus({ userId: t.target.id }),
  });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const t = await loadTarget(id);
  if ("error" in t) return t.error;
  await removePhone({ userId: t.target.id });
  logAudit(req, {
    actor: t.me,
    action: "notify_phone.remove_by_admin",
    resourceType: "user",
    resourceId: t.target.id,
    orgId: t.target.orgId,
  });
  return Response.json({ ok: true });
}
