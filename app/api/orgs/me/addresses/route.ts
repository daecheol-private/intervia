/**
 * 본인 법인의 오프라인 면접 장소 주소 목록.
 * 조회는 멤버 전원(일정 제시 화면에서 선택), 추가는 org_admin / system_admin 만.
 */
import { db } from "@/lib/db";
import { orgAddresses } from "@/lib/schema";
import { eq, asc } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { MAX_ORG_ADDRESSES } from "@/lib/org-address";

export const runtime = "nodejs";

export async function GET() {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (!me!.orgId) return Response.json({ addresses: [] });

  const rows = await db
    .select({
      id: orgAddresses.id,
      address: orgAddresses.address,
      addressDetail: orgAddresses.addressDetail,
    })
    .from(orgAddresses)
    .where(eq(orgAddresses.orgId, me!.orgId))
    .orderBy(asc(orgAddresses.id));

  return Response.json({ addresses: rows });
}

export async function POST(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (!me!.orgId) return new Response("법인 없음", { status: 400 });
  if (me!.role !== "org_admin" && me!.role !== "system_admin")
    return new Response("권한 없음 — 법인 관리자만 주소를 등록할 수 있습니다.", {
      status: 403,
    });

  const body = (await req.json().catch(() => null)) as {
    address?: string;
    addressDetail?: string | null;
  } | null;
  if (!body) return new Response("바디 필요", { status: 400 });

  const address =
    typeof body.address === "string" ? body.address.trim().slice(0, 300) : "";
  const detail =
    typeof body.addressDetail === "string"
      ? body.addressDetail.trim().slice(0, 200) || null
      : null;
  if (!address) return new Response("주소를 입력하세요.", { status: 400 });

  const existing = await db
    .select({
      id: orgAddresses.id,
      address: orgAddresses.address,
      addressDetail: orgAddresses.addressDetail,
    })
    .from(orgAddresses)
    .where(eq(orgAddresses.orgId, me!.orgId));

  // 같은 주소를 다시 등록하면 새 행 대신 기존 행을 돌려준다 — 목록이 중복으로 불어나지 않게.
  const dup = existing.find(
    (r) => r.address === address && (r.addressDetail ?? null) === detail
  );
  if (dup) return Response.json({ address: dup, duplicated: true });

  if (existing.length >= MAX_ORG_ADDRESSES)
    return new Response(
      `주소는 최대 ${MAX_ORG_ADDRESSES}개까지 저장할 수 있습니다. 쓰지 않는 주소를 삭제한 뒤 다시 시도해 주세요.`,
      { status: 400 }
    );

  const [row] = await db
    .insert(orgAddresses)
    .values({ orgId: me!.orgId, address, addressDetail: detail })
    .returning({
      id: orgAddresses.id,
      address: orgAddresses.address,
      addressDetail: orgAddresses.addressDetail,
    });

  logAudit(req, {
    actor: me!,
    action: "org.update" as const,
    resourceType: "org" as const,
    resourceId: me!.orgId,
    orgId: me!.orgId,
    metadata: { kind: "office_address_add", addressId: row.id },
  });

  return Response.json({ address: row });
}
