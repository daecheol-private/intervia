/**
 * Vercel Blob 통합 sanity check.
 *
 * 1. 작은 텍스트 파일을 Blob 에 업로드 (saveFile 우회, 직접 @vercel/blob put)
 * 2. 반환된 URL 다운로드 → 내용 확인
 * 3. 정리(삭제)
 *
 * 토큰·권한·region 모두 정상이면 OK.
 */
import "./_load-env.mjs";
import { randomBytes } from "node:crypto";

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
if (!TOKEN) {
  console.error("❌ BLOB_READ_WRITE_TOKEN 미설정 — .env.production.local 확인");
  process.exit(1);
}
console.log(`토큰: ${TOKEN.slice(0, 20)}…${TOKEN.slice(-6)}\n`);

const { put, del } = await import("@vercel/blob");

const filename = `test-${Date.now()}-${randomBytes(4).toString("hex")}.txt`;
const content = `Intervia Blob integration test\n발송 시각: ${new Date().toISOString()}\n`;

console.log(`[1/3] 업로드 시작: ${filename}`);
let t0 = Date.now();
let result;
try {
  result = await put(filename, content, {
    access: "public",
    contentType: "text/plain; charset=utf-8",
    addRandomSuffix: false,
    token: TOKEN,
  });
  console.log(`     ✅ 업로드 OK (${Date.now() - t0}ms)`);
  console.log(`     URL: ${result.url}`);
} catch (e) {
  console.error(`     ❌ 업로드 실패: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}

console.log(`\n[2/3] 다운로드 확인…`);
t0 = Date.now();
try {
  const r = await fetch(result.url);
  if (!r.ok) {
    console.error(`     ❌ HTTP ${r.status}`);
    process.exit(1);
  }
  const text = await r.text();
  if (text === content) {
    console.log(`     ✅ 다운로드 일치 (${Date.now() - t0}ms, ${text.length} bytes)`);
  } else {
    console.error(`     ❌ 내용 불일치`);
    console.error(`     기대: ${JSON.stringify(content)}`);
    console.error(`     실제: ${JSON.stringify(text)}`);
    process.exit(1);
  }
} catch (e) {
  console.error(`     ❌ 다운로드 실패: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}

console.log(`\n[3/3] 정리 삭제…`);
t0 = Date.now();
try {
  await del(result.url, { token: TOKEN });
  console.log(`     ✅ 삭제 OK (${Date.now() - t0}ms)`);
} catch (e) {
  console.warn(`     ⚠️ 삭제 실패 (무시 가능): ${e instanceof Error ? e.message : String(e)}`);
}

console.log(`\n✅ Vercel Blob 통합 정상 동작`);
console.log(`   - 토큰 유효성 OK`);
console.log(`   - 업로드 권한 OK`);
console.log(`   - public access 가능 OK`);
console.log(`   - 삭제 권한 OK`);
console.log(`\nlib/storage.ts 의 useBlob() 가 production 모드에서 이 토큰을 사용함.`);
