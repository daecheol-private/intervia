import { db } from "./db";
import { orgAddresses } from "./schema";
import { and, eq } from "drizzle-orm";

/** 법인당 저장 가능한 면접 장소 주소 개수 상한. */
export const MAX_ORG_ADDRESSES = 20;

/**
 * 목록에 없는 주소면 추가한다(있으면 그대로 둠).
 * 일정 제시에서 직접 입력한 주소를 법인 주소록에 남길 때 사용.
 * 상한을 넘으면 조용히 건너뛴다 — 일정 발송 자체를 막지 않기 위해서다.
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
    .select({ id: orgAddresses.id })
    .from(orgAddresses)
    .where(eq(orgAddresses.orgId, orgId));
  if (existing.length >= MAX_ORG_ADDRESSES) return;

  const dup = await db
    .select({ id: orgAddresses.id })
    .from(orgAddresses)
    .where(and(eq(orgAddresses.orgId, orgId), eq(orgAddresses.address, trimmed)));
  if (dup.length > 0) return;

  await db
    .insert(orgAddresses)
    .values({ orgId, address: trimmed, addressDetail: detail });
}
