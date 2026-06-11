import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

function resolveUrl(): { url: string; authToken?: string } {
  const hasTurso = !!process.env.TURSO_DATABASE_URL;
  const isDev = process.env.NODE_ENV !== "production";

  // 안전 가드: dev 모드 (`npm run dev`) 에서 Turso 연결 시 경고만 (TURSO_URL 이 .env.local 에
  // 실수로 들어가지 않도록). 명시적 ALLOW_PROD_DB_IN_DEV=1 이면 우회.
  if (hasTurso && isDev && process.env.ALLOW_PROD_DB_IN_DEV !== "1") {
    console.warn(
      "\n⚠️  [db] dev 모드에서 TURSO_DATABASE_URL 이 감지됨.\n" +
        "   로컬 dev 가 운영 DB 를 건드리면 위험합니다.\n" +
        "   .env.local 에서 TURSO_* 줄을 제거하거나, 의도적인 경우 ALLOW_PROD_DB_IN_DEV=1 set.\n" +
        "   → 일단 file:./data.db 로 fallback 합니다.\n"
    );
    return { url: "file:./data.db" };
  }

  if (hasTurso) {
    return {
      url: process.env.TURSO_DATABASE_URL!,
      authToken: process.env.TURSO_AUTH_TOKEN,
    };
  }
  if (process.env.DATABASE_URL) {
    return { url: process.env.DATABASE_URL };
  }
  return { url: "file:./data.db" };
}

const cfg = resolveUrl();
const client = createClient(cfg);

// 로컬 file 백엔드는 WAL 모드로 — 기본(delete 저널)에선 동시 쓰기 트랜잭션이 락을 오래 잡고
// 깨끗이 풀지 않아, busy_timeout 이 없는 @libsql/client 에서 재시도해도 SQLITE_BUSY 가 거의
// 항상 누락된다(QA 재현: delete=1/N 성공, WAL+재시도=N/N). WAL 은 writer↔reader 비차단 +
// 빠른 락 해제라 lib/tokens.ts 의 트랜잭션 재시도가 정상 동작한다. WAL 은 DB 파일 헤더에
// 영속 저장되므로 lazy 생성되는 트랜잭션 연결까지 모두 적용된다 (연결별 PRAGMA 와 달리).
// Turso(원격)는 서버가 쓰기를 직렬화하므로 미적용 — file: URL 일 때만.
if (cfg.url.startsWith("file:")) {
  void client
    .execute("PRAGMA journal_mode=WAL")
    .catch((e) => console.warn("[db] WAL 설정 실패(무시):", String(e)));
  // 동시 쓰기 시 즉시 SQLITE_BUSY 로 실패하지 않고 최대 5초 대기 — lib/tokens.ts 재시도의
  // 보조 안전망. (연결별 PRAGMA 라 트랜잭션용 별도 연결엔 미적용될 수 있음 — WAL+재시도가 주 방어)
  void client
    .execute("PRAGMA busy_timeout=5000")
    .catch((e) => console.warn("[db] busy_timeout 설정 실패(무시):", String(e)));
}

export const db = drizzle(client, { schema });
export { schema };
