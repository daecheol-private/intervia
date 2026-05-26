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

export const db = drizzle(client, { schema });
export { schema };
