import { getCurrentUser } from "@/lib/auth";
import { requireUser, requirePasswordChanged } from "@/lib/tenant";
import { refundTokens } from "@/lib/tokens";
import { logAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { organizations } from "@/lib/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role !== "system_admin")
    return new Response("권한 없음 (시스템 관리자 전용)", { status: 403 });
  const pwGuard = requirePasswordChanged(me);
  if (pwGuard) return pwGuard;

  const { id } = await params;
  const orgId = Number(id);
  const body = (await req.json().catch(() => ({}))) as {
    delta?: number;
    reason?: string;
    sourceLedgerId?: number | null;
  };

  if (!Number.isInteger(body.delta) || body.delta === 0)
    return new Response("환불 수량(0이 아닌 정수) 필요", { status: 400 });
  const reason = (body.reason ?? "").trim();
  if (reason.length < 5)
    return new Response("환불 사유는 5자 이상 입력하세요.", { status: 400 });

  const [org] = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  if (!org) return new Response("법인 없음", { status: 404 });

  let result;
  try {
    result = await refundTokens({
      orgId,
      delta: body.delta!,
      reason,
      userId: me!.id,
      sourceLedgerId: body.sourceLedgerId ?? null,
    });
  } catch (e) {
    return new Response((e as Error).message, { status: 400 });
  }

  logAudit(req, {
    actor: me,
    action: "tokens.refund",
    resourceType: "organization",
    resourceId: orgId,
    orgId,
    metadata: {
      delta: body.delta,
      reason,
      sourceLedgerId: body.sourceLedgerId ?? null,
      ledgerId: result.ledgerId,
      balanceAfter: result.balance,
      orgName: org.name,
    },
  });

  return Response.json({ balance: result.balance, ledgerId: result.ledgerId });
}
