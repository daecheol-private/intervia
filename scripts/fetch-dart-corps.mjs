/**
 * DART OpenAPI 상장사 corpCode 다운로드 → 법인명/사업자번호 매핑 JSON 생성.
 *
 * 특징:
 *   - 캐시: corpCode.zip 과 CORPCODE.xml 을 .tmp-dart/ 에 유지 (재실행 시 다운로드 스킵)
 *   - Resume: 기존 lib/dart-corps.json 의 corp_code 는 다시 호출 안 함
 *   - 증분 저장: 100개마다 디스크 flush (중단되어도 진행분 보존)
 *   - Conservative rate: 1초/1요청 (DART rate-limit 회피)
 *   - Retry: 3회 (exp backoff)
 *
 * 사용:
 *   1. .env.local 에 DART_API_KEY=... 추가
 *   2. npm run dart:fetch  (중단되면 다시 실행하면 이어서 함)
 *
 * 1회 풀 빌드 ~70분. 보통 한 번이면 끝. 분기별 재실행 시 신규 상장만 더해짐.
 */
import "./_load-env.mjs";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const key = process.env.DART_API_KEY;
if (!key) {
  console.error("❌ DART_API_KEY 환경변수가 없습니다. .env.local 에 추가 후 재실행.");
  process.exit(1);
}

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\//, ""), "..");
const TMP = path.join(ROOT, ".tmp-dart");
const ZIP = path.join(TMP, "corpCode.zip");
const XML = path.join(TMP, "CORPCODE.xml");
const OUT = path.join(ROOT, "lib", "dart-corps.json");

fs.mkdirSync(TMP, { recursive: true });

// 1) Download (캐시되어 있으면 스킵, 실패 시 retry)
if (fs.existsSync(XML)) {
  console.log("▶ [1/5] 캐시된 CORPCODE.xml 사용");
} else {
  console.log("▶ [1/5] corpCode.xml 압축파일 다운로드 (5회 retry)...");
  let zipBuf = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(
        `https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${key}`,
        { signal: AbortSignal.timeout(30_000) }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      zipBuf = Buffer.from(await res.arrayBuffer());
      break;
    } catch (e) {
      const waitMs = 5000 * attempt; // 5s, 10s, 15s, 20s, 25s
      console.warn(
        `  ⚠ 시도 ${attempt}/5 실패 (${e.message}). ${waitMs / 1000}초 대기 후 재시도...`
      );
      if (attempt === 5) {
        console.error(
          "\n❌ DART가 IP를 일시 차단했을 가능성이 높습니다. 10-30분 후 다시 시도하세요.\n   (이전 호출 폭주로 인한 임시 차단 — 자동 해제됨)"
        );
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  fs.writeFileSync(ZIP, zipBuf);
  console.log(`  ✓ ${(zipBuf.length / 1024).toFixed(1)} KB 다운로드`);

  console.log("▶ [2/5] 압축 해제...");
  execSync(
    `powershell -NoProfile -Command "Expand-Archive -Path '${ZIP}' -DestinationPath '${TMP}' -Force"`,
    { stdio: "inherit" }
  );
}

// 3) Parse XML
console.log("▶ [3/5] XML 파싱 → 상장사 추출...");
const xml = fs.readFileSync(XML, "utf-8");
const listed = [];
const rx = /<list>([\s\S]*?)<\/list>/g;
for (const m of xml.matchAll(rx)) {
  const block = m[1];
  const get = (tag) => {
    const mm = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(block);
    return mm ? mm[1].trim() : "";
  };
  const stock = get("stock_code");
  if (!stock) continue;
  listed.push({
    corp_code: get("corp_code"),
    name: get("corp_name"),
    eng: get("corp_eng_name"),
    stock,
  });
}
console.log(`  ✓ 상장사 ${listed.length}개`);

// 4) Resume: 기존 결과 로드
let results = [];
if (fs.existsSync(OUT)) {
  try {
    results = JSON.parse(fs.readFileSync(OUT, "utf-8"));
    if (!Array.isArray(results)) results = [];
  } catch {
    results = [];
  }
}
// 이전 결과는 corp_code 가 없을 수 있음 (구버전 스키마). 이름 기준으로 비교 fallback.
const doneNames = new Set(results.map((r) => r.name));
const doneCodes = new Set(results.filter((r) => r.corp_code).map((r) => r.corp_code));
const todo = listed.filter(
  (c) => !doneCodes.has(c.corp_code) && !doneNames.has(c.name)
);
console.log(
  `  ✓ 이미 수집 ${results.length}개 / 남은 작업 ${todo.length}개`
);

// 5) Fetch with 1 RPS + retry + incremental save
const DELAY_MS = 500; // 2 RPS — DART 안전선
console.log("▶ [4/5] 회사별 사업자번호 수집 (2 RPS, ~" + Math.ceil((todo.length * DELAY_MS / 1000) / 60) + "분)...");
const MAX_RETRY = 3;
let done = 0;
let failed = 0;
let saveCounter = 0;

async function fetchOne(corpCode) {
  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    try {
      const r = await fetch(
        `https://opendart.fss.or.kr/api/company.json?crtfc_key=${key}&corp_code=${corpCode}`,
        { signal: AbortSignal.timeout(15_000) }
      );
      return await r.json();
    } catch (e) {
      if (attempt === MAX_RETRY) throw e;
      await new Promise((r) => setTimeout(r, 2000 * attempt)); // 2s, 4s
    }
  }
}

function flush() {
  fs.writeFileSync(OUT, JSON.stringify(results));
}

for (const c of todo) {
  try {
    const d = await fetchOne(c.corp_code);
    if (d.status === "000") {
      results.push({
        corp_code: c.corp_code,
        name: c.name,
        eng: c.eng,
        stock: c.stock,
        bizno: d.bizr_no ? d.bizr_no.replace(/\D/g, "") : null,
      });
    }
    // status !== 000: 자료없음 — 스킵 (재호출 안 하도록 marker 저장)
    else {
      results.push({
        corp_code: c.corp_code,
        name: c.name,
        eng: c.eng,
        stock: c.stock,
        bizno: null,
      });
    }
  } catch (e) {
    failed++;
    if (failed <= 5) console.warn(`  ⚠ ${c.name}: ${e.message}`);
    // 실패는 results 에 넣지 않음 — 다음 실행 때 재시도
  }
  done++;
  saveCounter++;
  if (saveCounter >= 100) {
    flush();
    saveCounter = 0;
    console.log(`  ${done}/${todo.length} (전체 수집 ${results.length} / 실패 ${failed})`);
  }
  await new Promise((r) => setTimeout(r, DELAY_MS));
}
flush();

console.log(`\n  ✓ 이번 세션 ${done}개 처리 (실패 ${failed}개)`);
console.log(`  ✓ 총 수집 ${results.length}개`);

const sizeKB = (fs.statSync(OUT).size / 1024).toFixed(1);
console.log(`\n▶ [5/5] ${OUT} (${sizeKB} KB)`);

if (failed > 0) {
  console.log(`\n⚠ ${failed}개 실패. 다시 실행하면 실패분만 재시도합니다: npm run dart:fetch`);
} else {
  console.log("\n✅ 완료. signup 페이지에서 법인명 입력 시 자동완성 동작합니다.");
  // 성공 시 캐시 정리
  // fs.rmSync(TMP, { recursive: true, force: true });
}
