/**
 * Node 스크립트용 env 로더. Next.js 와 동일한 우선순위로 로드.
 *
 * 우선순위 (위가 우선):
 *   1. process.env (PowerShell $env: 로 set 한 값)
 *   2. .env.$(NODE_ENV).local  ← .env.production.local / .env.development.local
 *   3. .env.local              ← 모든 환경
 *   4. .env.$(NODE_ENV)        ← .env.production / .env.development
 *   5. .env
 *
 * 사용:
 *   import "./_load-env.mjs";   // 최상단 import 한 줄
 *   const url = process.env.TURSO_DATABASE_URL; // OK
 *
 * Turso 작업할 때:
 *   - .env.production.local 에 TURSO_DATABASE_URL/TURSO_AUTH_TOKEN 작성
 *   - NODE_ENV=production node scripts/setup-fresh-db.mjs
 * 또는 PowerShell session env 그대로 사용해도 됨 (1순위라 file 보다 우선).
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// @next/env 는 CJS — node 와 tsx 둘 다 호환되도록 createRequire 사용.
const { loadEnvConfig } = require("@next/env");

// 로컬 DB 강제 사용 (운영 마이그레이션이 끝난 후 로컬에 동기화할 때):
//   LOCAL_DB=1 node scripts/x.mjs
if (process.env.LOCAL_DB === "1") {
  // .env.local 만 로드 (dev=true). .env.production.local 무시.
  loadEnvConfig(process.cwd(), /* dev */ true);
  // Turso 변수가 .env.local 에도 있을 수 있으니 강제로 비움.
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.TURSO_AUTH_TOKEN;
} else {
  // 기본: production 모드 — .env.production.local 우선 로드.
  // PowerShell $env: 로 set 한 값은 항상 1순위라 file 보다 우선.
  loadEnvConfig(process.cwd(), /* dev */ false);
}
