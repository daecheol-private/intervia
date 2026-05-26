/**
 * DART 상장·외감법인 회사명 → 사업자번호 자동완성용 인메모리 검색.
 *
 * 데이터 출처: `lib/dart-corps.json` (scripts/fetch-dart-corps.mjs 로 생성).
 * 파일이 없거나 비어있으면 검색은 빈 배열 반환 — UI 가 graceful 하게 처리.
 */

import fs from "node:fs";
import path from "node:path";

export type DartCorp = {
  name: string;
  eng: string;
  stock: string;
  bizno: string | null;
};

let CACHE: DartCorp[] | null = null;

function loadCorps(): DartCorp[] {
  if (CACHE) return CACHE;
  try {
    const p = path.join(process.cwd(), "lib", "dart-corps.json");
    if (!fs.existsSync(p)) {
      CACHE = [];
      return CACHE;
    }
    const raw = fs.readFileSync(p, "utf-8");
    CACHE = JSON.parse(raw) as DartCorp[];
    return CACHE;
  } catch {
    CACHE = [];
    return CACHE;
  }
}

/** 입력 문자열 정규화 — 공백·괄호·(주)·㈜·,·. 제거 + 소문자 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(주\)|㈜|주식회사/g, "")
    .replace(/[\s,.()'"-]+/g, "")
    .trim();
}

export function searchDartCorps(query: string, limit = 8): DartCorp[] {
  const q = normalize(query);
  if (q.length < 2) return [];
  const corps = loadCorps();
  if (corps.length === 0) return [];

  // prefix 매칭 우선, includes 매칭 다음
  const prefix: DartCorp[] = [];
  const includes: DartCorp[] = [];
  for (const c of corps) {
    const n = normalize(c.name);
    const e = normalize(c.eng);
    if (n.startsWith(q) || e.startsWith(q)) {
      prefix.push(c);
    } else if (n.includes(q) || e.includes(q)) {
      includes.push(c);
    }
    if (prefix.length >= limit) break;
  }
  return [...prefix, ...includes].slice(0, limit);
}

/** 데이터 로딩 가능 여부 (UI 의 안내 분기에 사용 가능). */
export function dartCorpsAvailable(): boolean {
  return loadCorps().length > 0;
}

/**
 * 사업자번호로 DART 등록 법인 찾기 (정규화 후 일치).
 * DART 에 매칭되면 → 상장·외감법인 → "검증된 법인" 으로 간주.
 * 매칭 안 되면 → 비상장사/신생법인 → 운영자 수동 검토 게이트로 진입.
 */
export function findDartCorpByBizno(bizno: string): DartCorp | null {
  const digits = bizno.replace(/\D/g, "");
  if (digits.length !== 10) return null;
  const corps = loadCorps();
  for (const c of corps) {
    if (!c.bizno) continue;
    const cb = c.bizno.replace(/\D/g, "");
    if (cb === digits) return c;
  }
  return null;
}
