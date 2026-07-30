import { db } from "./db";
import { orgAddresses } from "./schema";
import { eq } from "drizzle-orm";

/** 법인당 저장 가능한 면접 장소 주소 개수 상한. */
export const MAX_ORG_ADDRESSES = 20;

/**
 * 목록에 없는 주소면 추가한다(있으면 그대로 둠).
 * 일정 제시·직접 확정에서 입력한 면접 장소를 법인 주소록에 남길 때 사용.
 * 상한을 넘으면 조용히 건너뛴다 — 일정 발송 자체를 막지 않기 위해서다.
 *
 * 같은 주소라도 상세(층·호수)가 다르면 다른 장소로 본다 — POST /api/orgs/me/addresses
 * 의 중복 판정과 같은 기준. 3층 회의실과 5층 회의실이 한 항목으로 뭉치지 않게.
 */
export async function ensureOrgAddress(
  orgId: number,
  address: string,
  addressDetail: string | null
): Promise<void> {
  const trimmed = address.trim().slice(0, 300);
  if (!trimmed) return;
  const detail = addressDetail?.trim().slice(0, 200) || null;

  const existing = await db
    .select({
      id: orgAddresses.id,
      address: orgAddresses.address,
      addressDetail: orgAddresses.addressDetail,
    })
    .from(orgAddresses)
    .where(eq(orgAddresses.orgId, orgId));

  if (
    existing.some(
      (r) => r.address === trimmed && (r.addressDetail ?? null) === detail
    )
  )
    return;
  if (existing.length >= MAX_ORG_ADDRESSES) return;

  await db
    .insert(orgAddresses)
    .values({ orgId, address: trimmed, addressDetail: detail });
}
