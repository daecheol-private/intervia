import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { adminUnlock } from "@/lib/auth-attempts";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role !== "system_admin")
    return new Response("권한 없음", { status: 403 });

  const { email, ip } = (await req.json().catch(() => ({}))) as {
    email?: string;
    ip?: string;
  };
  if (!email && !ip)
    return new Response("email 또는 ip 중 하나 필수", { status: 400 });

  const deleted = await adminUnlock({ email, ip });
  logAudit(req, {
    actor: me!,
    action: "account.unlock",
    resourceType: "auth_attempts",
    metadata: { email: email ?? null, ip: ip ?? null, deleted },
  });
  return Response.json({ ok: true, deleted });
}
