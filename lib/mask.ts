/**
 * 이력서 텍스트 PII 마스킹 (Node, TypeScript).
 *
 * Python `parser/mask.py` 의 정규식/라벨/사전 로직을 이식.
 * 사전 파일은 `parser/data/` 의 것을 공유 (단일 출처).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = join(process.cwd(), "parser", "data");

export type MaskLevel = "basic" | "standard";

export type KnownPII = {
  name?: string | null;
  phones?: (string | null | undefined)[];
  emails?: (string | null | undefined)[];
  address?: string | null;
  companies?: (string | null | undefined)[];
  extras?: (string | null | undefined)[];
};

// ---------- 정규식 ----------

const RE_RRN = /\b\d{6}\s?[-]\s?[1-8]\d{6}\b/g;
const RE_PHONE =
  /(?<!\d)(?:\+?82[-.\s]?)?0?1[016-9][-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)|(?<!\d)0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/g;
// TLD 화이트리스트 — PDF 표 셀 사이 공백 손실로 "gmail.comEmail" 처럼 라벨이 붙어 추출되는 사고 방지.
// lib/pii-extract.ts 와 동일 정책.
const EMAIL_TLDS = [
  "co\\.kr", "ac\\.kr", "go\\.kr", "or\\.kr", "ne\\.kr", "pe\\.kr", "re\\.kr", "hs\\.kr", "ms\\.kr", "es\\.kr", "sc\\.kr",
  "info", "name", "tech", "xyz", "online", "site", "store", "design",
  "com", "net", "org", "edu", "gov", "mil", "biz", "app", "dev", "pro",
  "kr", "jp", "cn", "us", "uk", "de", "fr", "ca", "au", "nz", "in", "io", "me", "tv", "cc", "co",
].join("|");
const RE_EMAIL = new RegExp(
  `\\b[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.(?:${EMAIL_TLDS})`,
  "gi"
);
const RE_URL = /https?:\/\/\S+|www\.\S+/g;
const RE_ZIP = /(?<!\d)\d{5}(?!\d)(?=\s*(?:\(\s*우\s*\)|우편|$))|\(\s*\d{5}\s*\)/g;

// 생년월일 — 같은 구분자를 한 번 더 써야만 매칭 (YYYY.MM.DD).
// "2015.01 - 2020.02" 같은 경력 기간은 dash 가 month-day 구분자로 잘못 잡히지 않게 backref.
const RE_DOB = new RegExp(
  // 1990.5.15 / 1990-5-15 / 1990/5/15 — 첫 구분자와 두 번째 구분자 동일
  String.raw`(?:\b(?:19|20)\d{2}\s*([.\-/])\s*(?:1[0-2]|0?[1-9])\s*\1\s*(?:3[01]|[12]\d|0?[1-9])(?:\s*[일日])?` +
    // 1990년 5월 15일 / 1990년 5월
    String.raw`|\b(?:19|20)\d{2}\s*년\s*(?:1[0-2]|0?[1-9])\s*월(?:\s*(?:3[01]|[12]\d|0?[1-9])\s*일)?` +
    // 1990年5月15日 / 1990年5月
    String.raw`|\b(?:19|20)\d{2}\s*年\s*(?:1[0-2]|0?[1-9])\s*月(?:\s*(?:3[01]|[12]\d|0?[1-9])\s*日)?)` +
    // 끝의 (생) / 출생 / 出生
    String.raw`(?:\s*\(?[생出]\)?|\s*출생|\s*出生)?`,
  "g"
);

const RE_ROAD_ADDR =
  /[가-힣A-Za-z0-9·]+(?:로|길)\s?\d+(?:[-]\d+)?(?:번지?)?(?:\s*,?\s*\d+(?:동|호|층))*/g;
const RE_JIBUN = /[가-힣]+동\s?\d+(?:[-]\d+)?(?:번지)?/g;

// 회사명 — 접미사로 회사 식별
// "엑스퍼넷(주)", "(주)엑스퍼넷", "엑스퍼넷 주식회사", "엑스퍼넷 부설연구소" 등
const RE_COMPANY_SUFFIX =
  /[가-힣A-Za-z0-9·\-&]{2,30}\s*(?:주식회사|㈜|\(주\)|부설연구소|연구소|컴퍼니|그룹|코퍼레이션|Corporation|Corp\.?|Inc\.?|LLC|Ltd\.?|Co\.?\s*,?\s*Ltd\.?)/g;
const RE_COMPANY_PREFIX =
  /(?:㈜|\(주\)|株式会社)\s*[가-힣A-Za-z0-9·\-&]{2,30}/g;

// 직책/직위 — 한국 회사 일반 직책. JS \b 는 한글 경계 못 잡아서 lookaround 로 처리.
const RE_POSITION =
  /(?<![가-힣A-Za-z])(?:사원|주임|대리|과장|차장|부장|팀장|실장|본부장|대표이사|부사장|사장|이사|상무|전무|CEO|CTO|CFO|COO|CIO|시니어매니저|매니저|디렉터)(?![가-힣A-Za-z])/g;

// 부서/팀 — "연구 2팀", "개발팀", "마케팅사업부", "R&D팀" 등
// 주의: "실" / "부서" / "본부" 단독 키워드는 너무 광범위 (입실/퇴실/연구실/사무실/접수실/전부서 등 부분 매칭).
// → "팀/센터/사업부/그룹/랩/Lab/Team/Division" 만 사용. 다중 의미 키워드는 제외.
const RE_DEPARTMENT =
  /(?<![가-힣A-Za-z])[가-힣A-Za-z0-9&]{1,15}(?:\s+\d+)?\s*(?:팀|센터|사업부|그룹|랩|Lab|Team|Division)(?![가-힣A-Za-z])/g;

// ---------- 라벨 ----------

type LabelRule = { re: RegExp; token: string };
const LABELS: LabelRule[] = [
  {
    re: /(이\s*름|성\s*명|성명|성\s*함|성함|작\s*성\s*자|작성자|지\s*원\s*자|지원자|응\s*시\s*자|응시자|신\s*청\s*자|신청자|본\s*인|Name|Applicant|Author|Signed\s*by|Signature|姓\s*名)\s*[:：·▶▷\-=]?\s*([^\n,/]{1,30})/g,
    token: "[이름]",
  },
  {
    re: /(주\s*소|거주지|현주소|Address|地\s*址|住\s*址)\s*[:：·▶▷-]?\s*([^\n]{2,80})/g,
    token: "[주소]",
  },
  {
    re: /(생년월일|출생|생일|DOB|Birth|出\s*生(?:\s*日期)?|生\s*日)\s*[:：·▶▷-]?\s*([^\n,]{4,30})/g,
    token: "[생년월일]",
  },
  {
    re: /(연락처|전화|휴대폰|핸드폰|Mobile|Phone|Tel|電\s*話|电\s*话|手\s*[機机])\s*[:：·▶▷-]?\s*([^\n,]{6,30})/g,
    token: "[전화]",
  },
  {
    re: /(이메일|메일|E[-]?mail|Email|電\s*郵|电\s*邮|邮\s*箱|郵\s*箱)\s*[:：·▶▷-]?\s*([^\n\s,]{4,80})/g,
    token: "[이메일]",
  },
  {
    re: /(회\s*사|회사명|직\s*장|직장명|근\s*무\s*처|소\s*속|재직회사|Company|Employer)\s*[:：·▶▷-]?\s*([^\n,/]{2,40})/g,
    token: "[회사]",
  },
  {
    re: /(부\s*서|부서명|팀\s*명|소속팀|Department|Dept\.?|Division)\s*[:：·▶▷-]?\s*([^\n,/]{2,40})/g,
    token: "[부서]",
  },
  {
    re: /(직\s*책|직\s*위|직\s*급|Position|Title|Job\s*Title|Role)\s*[:：·▶▷-]?\s*([^\n,/]{2,40})/g,
    token: "[직책]",
  },
];

// ---------- 사전 ----------

function loadDict(filename: string): string[] {
  try {
    const raw = readFileSync(join(DATA_DIR, filename), "utf-8");
    const list = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    return Array.from(new Set(list)).sort((a, b) => b.length - a.length);
  } catch {
    return [];
  }
}

let _universities: string[] | null = null;
let _regions: string[] | null = null;
let _companies: string[] | null = null;

function ensureDicts(): void {
  if (!_universities) {
    _universities = [
      ...loadDict("universities.txt"),
      ...loadDict("universities_intl.txt"),
    ];
    _universities = Array.from(new Set(_universities)).sort(
      (a, b) => b.length - a.length
    );
  }
  if (!_regions) _regions = loadDict("regions.txt");
  if (!_companies) {
    _companies = [...loadDict("companies.txt"), ...loadDict("companies-extra.txt")];
    _companies = Array.from(new Set(_companies)).sort(
      (a, b) => b.length - a.length
    );
  }
}

// ---------- 적용 ----------

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyKnown(text: string, known: KnownPII | undefined): string {
  if (!known) return text;
  if (known.name) text = text.split(known.name).join("[이름]");
  for (const p of known.phones ?? [])
    if (p) text = text.split(p).join("[전화]");
  for (const e of known.emails ?? [])
    if (e) text = text.split(e).join("[이메일]");
  if (known.address) text = text.split(known.address).join("[주소]");
  // 회사명은 긴 것부터 + 단어 경계 매칭 (부분문자열 false positive 방지)
  const companies = (known.companies ?? [])
    .filter((c): c is string => !!c && c.length >= 2)
    .sort((a, b) => b.length - a.length);
  for (const c of companies) text = maskByDict(text, c, "[회사]");
  for (const ex of known.extras ?? [])
    if (ex) text = text.split(ex).join("[기타]");
  return text;
}

function applyLabels(text: string): string {
  for (const { re, token } of LABELS) {
    text = text.replace(re, (_m, label) => `${label}: ${token}`);
  }
  return text;
}

function applyBasic(text: string): string {
  return text
    .replace(RE_RRN, "[주민번호]")
    .replace(RE_DOB, "[생년월일]")
    .replace(RE_PHONE, "[전화]")
    .replace(RE_EMAIL, "[이메일]")
    .replace(RE_URL, "[URL]")
    .replace(RE_ROAD_ADDR, "[주소]")
    .replace(RE_JIBUN, "[주소]")
    .replace(RE_ZIP, "[우편번호]")
    .replace(RE_COMPANY_PREFIX, "[회사]")
    .replace(RE_COMPANY_SUFFIX, "[회사]")
    .replace(RE_DEPARTMENT, "[부서]")
    .replace(RE_POSITION, "[직책]");
}

/**
 * 사전 항목을 단어 경계 안에서만 매칭.
 *
 * `split`/`join` 방식은 부분문자열도 잡아버림 — "라인" → "온라인" 의 "라인" 도 치환.
 * regex + lookaround 로 앞뒤가 한글/영문/숫자 아닐 때만 치환.
 *
 * 한국어는 단어 사이 공백이 일반적이라 lookahead `(?![가-힣A-Za-z0-9])` 가 충분히 견고.
 * 예외: "삼성전자" 같은 합성어는 dict 에 별도로 등재되어야 함 (이미 그렇게 되어 있음).
 */
function maskByDict(text: string, word: string, token: string): string {
  if (!text.includes(word)) return text;
  const re = new RegExp(
    `(?<![가-힣A-Za-z0-9])${escapeRe(word)}(?![가-힣A-Za-z0-9])`,
    "g"
  );
  return text.replace(re, token);
}

function applyDicts(text: string): string {
  ensureDicts();
  // 회사 사전을 학교/지역보다 먼저 — 회사명에 지역명이 들어있는 케이스 (예: "서울반도체")
  for (const c of _companies ?? []) {
    // 2글자 미만 회사명은 너무 짧아 false positive 위험 (예: "K", "L") — skip
    if (c.length < 2) continue;
    text = maskByDict(text, c, "[회사]");
  }
  for (const u of _universities ?? []) {
    if (u.length < 2) continue;
    text = maskByDict(text, u, "[학교]");
  }
  for (const r of _regions ?? []) {
    if (r.length < 2) continue;
    text = maskByDict(text, r, "[지역]");
  }
  return text;
}

// ---------- 엔트리 ----------

export function maskText(
  text: string,
  opts: { level?: MaskLevel; known?: KnownPII } = {}
): string {
  const level = opts.level ?? "standard";
  let out = text;
  // 1) 라벨 먼저 — known/regex 가 만든 토큰 ([이름] 등) 을 라벨이 재해석하는 사고 방지
  if (level === "standard") out = applyLabels(out);
  // 2) known PII (가장 정확) — 라벨이 못 잡은 본문 내 PII 대응
  out = applyKnown(out, opts.known);
  // 3) 정규식 (전 레벨)
  out = applyBasic(out);
  // 4) 사전 (standard 이상)
  if (level === "standard") out = applyDicts(out);
  return out;
}

// 디버그용 — 어떤 패턴이 매칭됐는지 통계
export function maskStats(text: string): Record<string, number> {
  const counts: Record<string, number> = {};
  const add = (k: string, n: number) => {
    if (n > 0) counts[k] = (counts[k] ?? 0) + n;
  };
  add("rrn", (text.match(RE_RRN) ?? []).length);
  add("phone", (text.match(RE_PHONE) ?? []).length);
  add("email", (text.match(RE_EMAIL) ?? []).length);
  add("url", (text.match(RE_URL) ?? []).length);
  add("dob", (text.match(RE_DOB) ?? []).length);
  add("zip", (text.match(RE_ZIP) ?? []).length);
  add("road", (text.match(RE_ROAD_ADDR) ?? []).length);
  add("jibun", (text.match(RE_JIBUN) ?? []).length);
  return counts;
}

// escapeRe 는 maskByDict 에서 사용됨
