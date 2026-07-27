/**
 * 감사 로그 조회 필터 — 화면(/api/admin/audit)과 CSV export 가 공유한다.
 * 두 라우트가 각자 조건을 만들면 "화면에 보이는 것과 다운로드가 다른" 사고가 난다.
 */
import { auditLogs, users, organizations } from "./schema";
import { and, eq, gte, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { sqliteTimestamp } from "./utils";
import { actionsMatchingLabel } from "./audit-labels";

/** LIKE 메타문자 이스케이프 — 검색어의 % _ 를 리터럴로 취급 (ESCAPE '\' 와 함께 사용). */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * 'YYYY-MM-DD'(KST 기준 날짜) → SQLite createdAt 비교용 UTC 문자열.
 * createdAt 은 CURRENT_TIMESTAMP(UTC, 'YYYY-MM-DD HH:MM:SS')로 저장되므로 같은 포맷으로
 * 맞춰야 한다 — ISO(T) 와 섞으면 경계일이 통째로 빠진다(GOTCHAS §0-0).
 * @param endOfDay true 면 그 날의 끝(=다음날 00:00 KST) — lt 비교용.
 */
export function kstDateToDbTs(day: string, endOfDay = false): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const t = Date.parse(`${day}T00:00:00+09:00`);
  if (Number.isNaN(t)) return null;
  return sqliteTimestamp(new Date(t + (endOfDay ? 86_400_000 : 0)));
}

export type AuditFilter = {
  /** 통합 검색어 — 액터(이름·이메일·역할)/액션(원문·한글 라벨)/대상/법인/IP/메타 전체. */
  q?: string | null;
  /** 'YYYY-MM-DD' KST. 없으면 days 로 폴백. */
  start?: string | null;
  end?: string | null;
  /** start 미지정 시 "최근 N일". */
  days?: number;
  orgId?: number | null;
};

/**
 * WHERE 조건 조립. users·organizations 를 leftJoin 한 쿼리에서만 쓸 것
 * (검색이 액터 이름·법인명을 참조한다).
 */
export function buildAuditWhere(f: AuditFilter): SQL | undefined {
  const conditions: SQL[] = [];

  const startTs = f.start ? kstDateToDbTs(f.start) : null;
  const endTs = f.end ? kstDateToDbTs(f.end, true) : null;
  if (startTs) {
    conditions.push(gte(auditLogs.createdAt, startTs));
  } else if (!endTs) {
    // 날짜 지정이 전혀 없을 때만 "최근 N일" 폴백 — end 만 준 경우는 그 이전 전체를 본다.
    const days = f.days && f.days > 0 ? f.days : 7;
    conditions.push(
      gte(
        auditLogs.createdAt,
        sqliteTimestamp(new Date(Date.now() - days * 86_400_000))
      )
    );
  }
  if (endTs) conditions.push(lt(auditLogs.createdAt, endTs));

  if (f.orgId != null) conditions.push(eq(auditLogs.orgId, f.orgId));

  const q = f.q?.trim();
  if (q) {
    const pat = `%${escapeLike(q)}%`;
    const ors: SQL[] = [
      sql`${auditLogs.action} LIKE ${pat} ESCAPE '\\'`,
      sql`COALESCE(${users.name}, '') LIKE ${pat} ESCAPE '\\'`,
      sql`COALESCE(${users.email}, '') LIKE ${pat} ESCAPE '\\'`,
      sql`COALESCE(${auditLogs.actorRole}, '') LIKE ${pat} ESCAPE '\\'`,
      sql`COALESCE(${auditLogs.ip}, '') LIKE ${pat} ESCAPE '\\'`,
      sql`COALESCE(${organizations.name}, '') LIKE ${pat} ESCAPE '\\'`,
      // 대상 — 화면 표기(candidate#123)와 같은 형태로 검색되게.
      sql`COALESCE(${auditLogs.resourceType}, '') || '#' || COALESCE(${auditLogs.resourceId}, '') LIKE ${pat} ESCAPE '\\'`,
      // 메타 — JSON 을 텍스트로 훑는다(키·값 모두 매칭).
      sql`COALESCE(CAST(${auditLogs.metadata} AS TEXT), '') LIKE ${pat} ESCAPE '\\'`,
    ];
    // 화면에 한글 라벨이 보이므로 라벨로도 찾을 수 있어야 한다 ("공고 종결" → job.close).
    const labelActions = actionsMatchingLabel(q);
    if (labelActions.length > 0) ors.push(inArray(auditLogs.action, labelActions));
    const combined = or(...ors);
    if (combined) conditions.push(combined);
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}
