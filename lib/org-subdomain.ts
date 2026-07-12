/**
 * 법인 서브도메인 lazy 발급 — DB 접근이 있어 순수 함수 모듈(lib/subdomain.ts)과 분리한다.
 * (subdomain.ts 는 proxy 번들이 import 하므로 DB import 금지.)
 *
 * 지원 링크(/apply)와 면접 링크(/interview) 양쪽이 공유한다 — 한 법인은 하나의
 * 서브도메인만 가지며, 어느 경로에서 처음 발급되든 같은 라벨을 재사용한다.
 */
import { db } from "@/lib/db";
import { organizations } from "@/lib/schema";
import { and, eq, isNull } from "drizzle-orm";
import { deriveSubdomain } from "@/lib/subdomain";

/**
 * 법인 서브도메인 lazy 발급 — email_domain 첫 라벨에서 유도해 최초 1회 저장.
 * 유도 불가(공용 도메인·예약어)면 null 유지. 라벨 충돌(타 법인 선점) 시 "{라벨}-{orgId}".
 */
export async function ensureOrgSubdomain(orgId: number | null): Promise<string | null> {
  if (!orgId) return null;
  const [org] = await db
    .select({ subdomain: organizations.subdomain, emailDomain: organizations.emailDomain })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  if (!org) return null;
  if (org.subdomain) return org.subdomain;

  const base = deriveSubdomain(org.emailDomain);
  if (!base) return null;

  for (const candidate of [base, `${base}-${orgId}`]) {
    try {
      // subdomain IS NULL 조건으로 동시 발급 레이스에도 1회만 기록
      await db
        .update(organizations)
        .set({ subdomain: candidate })
        .where(and(eq(organizations.id, orgId), isNull(organizations.subdomain)));
      const [after] = await db
        .select({ subdomain: organizations.subdomain })
        .from(organizations)
        .where(eq(organizations.id, orgId));
      return after?.subdomain ?? null;
    } catch {
      // unique 충돌 — 다음 후보로
    }
  }
  return null;
}
