/**
 * 법인 검색 — 표기 변동에 강건한 정규화 매칭.
 *
 * 정규화 규칙 (양쪽에 동일 적용):
 *   - lowercase
 *   - 공백·괄호·점·하이픈·따옴표 제거
 *   - 법인 형태 접미·접두 제거: (주), ㈜, 주식회사, (유), 유한회사, (재), 재단법인 등
 *
 * 매칭 우선순위 (정렬):
 *   1) 정규화된 이름 완전 일치
 *   2) 사업자번호 prefix 일치
 *   3) 정규화된 이름 substring
 *   4) 일반 LIKE
 */
import { db } from "@/lib/db";
import { organizations } from "@/lib/schema";
import { sql } from "drizzle-orm";
import { rateLimit } from "@/lib/rate-limit";
import { maskBizNo } from "@/lib/email-domain";

export const runtime = "nodejs";

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[().,'"`·\-_/\\]/g, "")
    .replace(/㈜/g, "")
    .replace(/주식회사/g, "")
    .replace(/유한회사/g, "")
    .replace(/유한책임회사/g, "")
    .replace(/재단법인/g, "")
    .replace(/사단법인/g, "")
    .replace(/inc\.?$/i, "")
    .replace(/co\.?,?\s*ltd\.?$/i, "")
    .replace(/corp\.?$/i, "")
    .replace(/ltd\.?$/i, "");
}

export async function GET(req: Request) {
  // 인증 없이 노출되는 법인 디렉토리 — 대량 스크래핑(고객사·사업자번호 수집) 차단.
  const limited = await rateLimit(req, "org-search", { limit: 20, windowSec: 60 });
  if (limited) return limited;

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (q.length < 2) return Response.json([]);

  const normalizedQ = normalize(q);
  if (!normalizedQ) return Response.json([]);

  // SQLite LIKE 는 case-insensitive 기본. 모든 row 가져와서 후처리 매칭 (법인 수 적을 때 OK)
  // 추후 row 수 증가 시 normalized 컬럼 추가 + 인덱스 권장.
  const all = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      bizRegistrationNo: organizations.bizRegistrationNo,
      emailDomain: organizations.emailDomain,
    })
    .from(organizations)
    .where(sql`${organizations.name} IS NOT NULL`)
    .limit(500);

  type Row = (typeof all)[number];
  const bizDigits = q.replace(/\D/g, "");
  const scored = all
    .map((o: Row) => {
      const nn = normalize(o.name);
      let score = 0;
      if (nn === normalizedQ) score = 100;
      else if (
        bizDigits.length >= 4 &&
        o.bizRegistrationNo &&
        o.bizRegistrationNo.replace(/\D/g, "").startsWith(bizDigits)
      )
        score = 90;
      else if (nn.includes(normalizedQ)) score = 70;
      else if (normalizedQ.includes(nn) && nn.length >= 2) score = 50;
      else if (
        (o.emailDomain ?? "").toLowerCase().includes(normalizedQ)
      )
        score = 40;
      return { ...o, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    // 전체 사업자번호는 노출하지 않음 — 식별용 마스킹본만. (매칭 점수 계산엔 원본 사용)
    .map(({ score: _s, bizRegistrationNo, ...rest }) => ({
      ...rest,
      bizRegistrationNo: maskBizNo(bizRegistrationNo),
    }));

  return Response.json(scored);
}
