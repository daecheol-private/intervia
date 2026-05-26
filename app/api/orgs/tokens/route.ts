import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { getBalance, listLedger, getAllPricing } from "@/lib/tokens";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const url = new URL(req.url);
  const orgIdParam = url.searchParams.get("orgId");
  let targetOrgId: number | null = null;
  if (orgIdParam) {
    targetOrgId = Number(orgIdParam);
    if (!ownsOrg(me!, targetOrgId))
      return new Response("권한 없음", { status: 403 });
  } else {
    targetOrgId = me!.orgId;
  }
  if (!targetOrgId) return new Response("orgId 필요", { status: 400 });

  const [balance, ledger, pricing] = await Promise.all([
    getBalance(targetOrgId),
    listLedger(targetOrgId, 100),
    getAllPricing(),
  ]);

  return Response.json({
    orgId: targetOrgId,
    balance,
    lowBalance: balance <= 0,
    pricing,
    ledger,
  });
}
