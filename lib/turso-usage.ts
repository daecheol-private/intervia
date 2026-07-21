/**
 * Turso Platform API 사용량 조회 — 무료 티어 쿼터(행 읽기/쓰기·저장용량) 모니터링.
 *
 *   GET https://api.turso.tech/v1/organizations/{slug}/usage
 *   Authorization: Bearer <platform token>
 *   → organization.usage.{rows_read, rows_written, storage_bytes, databases, ...}
 *
 * ⚠️ 이 API 는 사용량만 주고 **한도(limit)는 주지 않는다**. 무료 티어 한도는 벤더가 자주
 * 바꾸므로 env(TURSO_LIMIT_*)로 주입한다 — 대시보드에서 현재값 확인 후 설정. 미설정 지표는
 * % 계산을 생략(used 만 표시). 토큰/슬러그 미설정 시 null(모니터 graceful skip). 읽기 전용.
 */

const USAGE_TIMEOUT_MS = 10_000;

export type TursoUsageMetric = {
  key: "rows_read" | "rows_written" | "storage_bytes";
  label: string;
  used: number;
  /** env 로 주입된 플랜 한도. 미설정이면 null. */
  limit: number | null;
  /** used/limit 백분율(반올림). limit 미설정이면 null. */
  pct: number | null;
};

export type TursoUsage = {
  metrics: TursoUsageMetric[];
  raw: {
    rowsRead: number;
    rowsWritten: number;
    storageBytes: number;
    databases: number;
  };
};

function envLimit(key: string): number | null {
  const v = process.env[key];
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Turso 조직 사용량 조회. TURSO_PLATFORM_TOKEN + TURSO_ORG_SLUG 필요.
 * 미설정 시 null. 네트워크·비정상 응답은 throw (호출부가 graceful 처리).
 */
export async function fetchTursoUsage(): Promise<TursoUsage | null> {
  const token = process.env.TURSO_PLATFORM_TOKEN;
  const slug = process.env.TURSO_ORG_SLUG;
  if (!token || !slug) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), USAGE_TIMEOUT_MS);
  let json: unknown;
  try {
    const res = await fetch(
      `https://api.turso.tech/v1/organizations/${encodeURIComponent(slug)}/usage`,
      { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal }
    );
    if (!res.ok) throw new Error(`Turso usage API HTTP ${res.status}`);
    json = await res.json();
  } finally {
    clearTimeout(timer);
  }

  const usage =
    (json as { organization?: { usage?: Record<string, unknown> } })?.organization
      ?.usage ?? {};
  const num = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? v : 0;
  const rowsRead = num(usage.rows_read);
  const rowsWritten = num(usage.rows_written);
  const storageBytes = num(usage.storage_bytes);
  const databases = num(usage.databases);

  const pct = (used: number, limit: number | null): number | null =>
    limit == null ? null : Math.round((used / limit) * 100);
  const rr = envLimit("TURSO_LIMIT_ROWS_READ");
  const rw = envLimit("TURSO_LIMIT_ROWS_WRITTEN");
  const st = envLimit("TURSO_LIMIT_STORAGE_BYTES");

  return {
    metrics: [
      { key: "rows_read", label: "행 읽기", used: rowsRead, limit: rr, pct: pct(rowsRead, rr) },
      { key: "rows_written", label: "행 쓰기", used: rowsWritten, limit: rw, pct: pct(rowsWritten, rw) },
      { key: "storage_bytes", label: "저장용량", used: storageBytes, limit: st, pct: pct(storageBytes, st) },
    ],
    raw: { rowsRead, rowsWritten, storageBytes, databases },
  };
}
