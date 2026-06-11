import { getCurrentUser } from "@/lib/auth";
import { requireUser, requirePasswordChanged } from "@/lib/tenant";
import { requireStepUp } from "@/lib/step-up";
import { adjustTokens } from "@/lib/tokens";
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
    return new Response("권한 없음", { status: 403 });
  const pwGuard = requirePasswordChanged(me);
  if (pwGuard) return pwGuard;

  const stepUpGuard = await requireStepUp();
  if (stepUpGuard) return stepUpGuard;

  const { id } = await params;
  const orgId = Number(id);
  const body = (await req.json().catch(() => ({}))) as {
    delta?: number;
    memo?: string;
  };
  // 상한 — 거대값 적립/회수로 잔액을 오버플로시켜 balance<=0 가드를 무력화하는 입력 차단.
  const MAX_GRANT = 1_000_000;
  if (
    !Number.isSafeInteger(body.delta) ||
    body.delta === 0 ||
    Math.abs(body.delta!) > MAX_GRANT
  )
    return new Response(
      `delta(0이 아닌 정수, 절대값 ${MAX_GRANT.toLocaleString()} 이하) 필요`,
      { status: 400 }
    );

  const [org] = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  if (!org) return new Response("법인 없음", { status: 404 });

  const { balance } = await adjustTokens({
    orgId,
    delta: body.delta!,
    userId: me!.id,
    memo: body.memo ?? null,
  });

  logAudit(req, {
    actor: me,
    action: "tokens.adjust",
    resourceType: "organization",
    resourceId: orgId,
    orgId,
    metadata: {
      delta: body.delta,
      memo: body.memo ?? null,
      balanceAfter: balance,
      orgName: org.name,
    },
  });

  return Response.json({ balance });
}
