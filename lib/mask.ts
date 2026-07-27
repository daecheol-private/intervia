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
  /** 본문에서 추출한 이름 등 — DB 이름(파일명 유래)과 다를 수 있어 둘 다 가린다. */
  extraNames?: (string | null | undefined)[];
  phones?: (string | null | undefined)[];
  emails?: (string | null | undefined)[];
  address?: string | null;
  companies?: (string | null | undefined)[];
  extras?: (string | null | undefined)[];
};

// ---------- 정규식 ----------

const RE_RRN = /\b\d{6}\s?[-]\s?[1-8]\d{6}\b/g;
// 끝 경계 (?!\d) 없음 — 표 PDF 에서 인접 셀 번호가 "010-...010-..." 로 붙는 케이스를 잡기 위함.
// 마스킹은 과검출이 안전한 방향이라 끝 가드 제거의 부작용도 없다. lib/pii-extract.ts RE_PHONE 와 동일 정책.
const RE_PHONE =
  /(?<!\d)(?:\+?82[-.\s]?)?0?1[016-9][-.\s]?\d{3,4}[-.\s]?\d{4}|(?<!\d)0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/g;
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

// "1993년생" / "93년생" — 월·일 없이 생년만 적는 표기. RE_DOB(완전한 날짜)가 못 잡는다.
// lib/pii-extract.ts RE_BIRTH_YEAR 와 같은 표기를 대상으로 함.
const RE_BIRTH_YEAR = /(?<!\d)(?:19\d{2}|20\d{2}|\d{2})\s*년\s*[생生]/g;

// 이벤트 날짜 예외 — YYYY.MM.DD 가 전부 생년월일인 것은 아니다.
// 프로젝트 수행 기간·수상일·자격증 취득일까지 [생년월일] 로 삼키면 평가 근거(시점·기간)가
// 통째로 사라진다. 실측(2026-07-27): 이력서 한 건에서 24곳, 첨부 포트폴리오에서 36곳이
// 먹혀 수행 기간 7건 중 6건과 수상 3건 전부의 시점이 소실됐고, 서류평가 타임라인에서 해당
// 항목이 누락되거나 LLM 이 없는 날짜를 지어냈다.
// 아래 두 컨텍스트에서만 예외로 두고 나머지는 종전대로 가린다 — 기본값은 여전히 "가린다".
//   ① 날짜 범위의 일부 ("2021.09.01~2021.12.03")
//   ② 기간·이벤트 라벨이 날짜 바로 앞(같은 줄 40자 이내)에 있음 ("수행 기간 : …", "수상 내역 : …(2022.09.30)")
// 단, 같은 줄에 생년월일 라벨이 있으면 예외를 적용하지 않는다(생년월일 판정이 항상 우선).
// 범위 구분자는 `~`/dash 뿐 아니라 *공백만* 인 경우도 받는다 — 표 PDF 는 시작·종료를
// "2003.11.01  2005.03.31" 처럼 구분자 없이 나란히 뱉는다(실측 #83, 한 파일에서 47건).
// 개행은 제외(다음 줄의 무관한 날짜까지 기간으로 오인하지 않도록).
// 개행 1개(빈 줄 제외)도 구분자로 인정한다 — 표 PDF 는 시작·종료 셀을 줄바꿈으로 떨군다
// (실측 #87). 대신 아래 maskDobDates 가 생년월일 라벨을 *앞 2줄* 까지 확인해, 라벨과 값이
// 줄바꿈으로 떨어진 인적사항이 이 예외로 새지 않게 막는다.
const RE_RANGE_SEP = String.raw`(?:\s*[~∼〜–—-]\s*|[ \t]{1,6}|[ \t]*\n[ \t]*)`;
const RE_RANGE_AFTER = new RegExp(
  `^${RE_RANGE_SEP}(?:(?:19|20)\\d{2}|현\\s*재|재\\s*직)`
);
// 앞 날짜는 "2015.03(.01)" 과 "2015년 3월( 1일)" 두 표기를 모두 받는다 — 한쪽만 받으면
// "2018년 06월 ~ 2019년 05월" 의 *종료일* 만 생년월일로 오인된다(실측 #116).
const RE_RANGE_BEFORE = new RegExp(
  String.raw`(?:19|20)\d{2}\s*(?:[.\-/]\s*\d{1,2}(?:\s*[.\-/]\s*\d{1,2})?` +
    String.raw`|[년年]\s*\d{1,2}\s*[월月](?:\s*\d{1,2}\s*[일日])?)` +
    `${RE_RANGE_SEP}$`
);
const RE_EVENT_LABEL =
  /기\s*간|수\s*행|재\s*직|근\s*무|활\s*동|프로젝트|수\s*상|취\s*득|발\s*급|입\s*사|퇴\s*사|입\s*학|졸\s*업|수\s*료|참\s*여|경\s*력|이\s*력|일\s*자/;
const RE_DOB_LABEL_SAMELINE =
  /생\s*년|출\s*생|생\s*일|Date\s*of\s*Birth|D\.?O\.?B|Birth/i;
// 날짜 *뒤*에 자격증명이 오는 목록형 — "자격증" 헤더 아래 `취득일 자격증명` 이 여러 줄 이어지면
// 라벨(앞 2줄) 규칙은 세 번째 항목부터 범위를 벗어난다(실측 #132: 취득일 4건이 전부 먹혔다).
// 자격증 이름 자체를 신호로 쓴다 — 생년월일 뒤에 이런 토큰이 붙는 경우는 없다.
const RE_CERT_AFTER =
  /기사|기술사|자격|[1-3]\s*급|SQLD|SQLP|ADsP|AICE|MOS|OPIc|TOEIC|TEPS|JLPT|HSK|정보처리|정보보안|리눅스|네트워크관리사|컴퓨터활용/i;

/** RE_DOB 매치가 생년월일이 아니라 기간·이벤트 날짜로 보이면 원문을 보존한다. */
function maskDobDates(text: string): string {
  return text.replace(RE_DOB, (m: string, _sep: string, offset: number) => {
    // "(생)" / "출생" 접미사를 함께 삼킨 매치는 생년월일 확정.
    if (/[생出]/.test(m)) return "[생년월일]";
    const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
    // 생년월일 라벨은 앞 2줄까지 본다 — 표 양식은 라벨과 값이 다른 셀(=다른 줄)로 떨어지고,
    // LABELS.dob 는 `[^\n]` 이라 줄을 넘지 못해 여기가 마지막 방어선이다.
    const prevLineStart = text.lastIndexOf("\n", lineStart - 2) + 1;
    const near = text.slice(prevLineStart, offset);
    if (RE_DOB_LABEL_SAMELINE.test(near)) return "[생년월일]";
    const after = text.slice(offset + m.length, offset + m.length + 20);
    // 범위 판정은 줄 경계를 넘어서 본다 — 표 PDF 는 "2022년 3월\n~ 2026년 2월" 처럼
    // 구분자를 다음 줄로 떨군다. 40자 창으로 거리를 제한해 무관한 날짜와 엮이지 않게 한다.
    if (
      RE_RANGE_AFTER.test(after) ||
      RE_RANGE_BEFORE.test(text.slice(Math.max(0, offset - 40), offset))
    )
      return m;
    // 이벤트 라벨은 앞 2줄(표 헤더가 윗줄인 "취득일 | 자격증명 | 발급기관" 양식) 또는
    // 바로 뒤("2005.03.02(시작일자)")에서 찾는다.
    if (RE_EVENT_LABEL.test(near) || RE_EVENT_LABEL.test(after)) return m;
    if (RE_CERT_AFTER.test(after)) return m;
    return "[생년월일]";
  });
}

// 생년월일 라벨 뒤 2자리 연도 날짜("생년월일 … 83.01.24").
// 표 양식은 라벨과 값이 다른 셀로 떨어져 같은 줄 전용 라벨 규칙(LABELS.dob)도,
// 4자리 전용 RE_DOB 도 못 잡는다. lib/pii-extract.ts 가 이 표기를 생년월일로 인식하므로
// 여기서도 반드시 가려야 한다 — 추출/마스킹 불일치가 곧 PII 유출이다(GOTCHAS §0-7).
// 라벨 근처로 한정해 경력 기간("15.01.01 ~ 20.12.31")이 삼켜지지 않게 한다.
const RE_DOB_LABELED_SHORT =
  /((?:생\s*년\s*월\s*일|생\s*년|생\s*일|출\s*생|Date\s*of\s*Birth|D\.?O\.?B\.?|Birth\s*(?:day|date)?)[\s\S]{0,50}?)((?<!\d)\d{2}\s*[.\-/]\s*(?:1[0-2]|0?[1-9])\s*[.\-/]\s*(?:3[01]|[12]\d|0?[1-9]))/gi;

const RE_ROAD_ADDR =
  /[가-힣A-Za-z0-9·]+(?:로|길)\s?\d+(?:[-]\d+)?(?:번지?)?(?:\s*,?\s*\d+(?:동|호|층))*/g;
const RE_JIBUN = /[가-힣]+동\s?\d+(?:[-]\d+)?(?:번지)?/g;

// 나이 인라인 — "(만 35세)" / "(35세)" / "만 35세". lib/pii-extract.ts RE_AGE_INLINE·RE_AGE_MAN 대응.
// 괄호형의 "만" 은 옵션 — 채용포털 export 는 "남, 1998 (28세)" 로 쓴다(닫는 괄호가 경계라 안전).
// "3만 5세"/"35세대" 같은 부분 매칭은 lookaround 로 차단.
const RE_AGE_INLINE =
  /\(\s*(?:만\s*)?\d{1,2}\s*[세歳]\s*\)|(?<![가-힣A-Za-z0-9])만\s*\d{1,2}\s*[세歳](?![가-힣A-Za-z0-9])/g;

// 회사명 — 접미사로 회사 식별
// "회사명(주)", "(주)회사명", "회사명 주식회사", "회사명 부설연구소" 등
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
  // 채용절차법 §4의3 평가 금지 항목 — 라벨형(콜론/공백 구분)만. 본문 문장 오탐 방지 위해 값을 제한.
  {
    // 끝 가드 (?!\d) — 없으면 "나이 1993년생" 에서 "나이 19" 만 가려 "[나이]93년생" 으로
    // 생년이 남는다. 숫자가 더 붙으면 나이가 아니라 연도 → 아래 RE_BIRTH_YEAR/RE_DOB 가 처리.
    re: /(나\s*이|만\s*나이|연\s*령|Age)\s*[:：·▶▷-]?\s*(만\s*)?\d{1,2}(?!\d)\s*[세歳]?/g,
    token: "[나이]",
  },
  {
    re: /(성\s*별|Gender)\s*[:：·▶▷-]?\s*(남성|여성|남자|여자|[Mm]ale|[Ff]emale|남|여|M|F)(?![가-힣A-Za-z])/g,
    token: "[성별]",
  },
  {
    re: /(결\s*혼\s*여\s*부|혼\s*인\s*여\s*부|혼\s*인\s*상\s*태|결\s*혼\s*상\s*태)\s*[:：·▶▷-]?\s*(기혼|미혼|이혼|사별|별거|유|무)(?![가-힣A-Za-z])/g,
    token: "[혼인]",
  },
  {
    re: /(종\s*교)\s*[:：·▶▷-]?\s*(무교|없음|무|기독교|개신교|천주교|가톨릭|불교|원불교|이슬람교?|힌두교|유대교|천도교|기타)(?![가-힣A-Za-z])/g,
    token: "[종교]",
  },
  {
    re: /(가\s*족\s*관\s*계(?!\s*증명서)|가\s*족\s*사\s*항)\s*[:：·▶▷-]?\s*([^\n]{2,60})/g,
    token: "[가족]",
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
  // B-1 — 1글자 이름(파일명 stem 폴백 등)은 split/join 치환 시 본문 내 모든 해당 글자를
  // [이름] 으로 바꿔 텍스트를 파괴한다(예: 이름 "a" → "N[이름]me"). 2글자 미만은
  // 실제 사람 이름이 아닐 가능성이 높고(한글 이름 2~3자, 영문은 더 김) 부작용만 크므로
  // 치환을 건너뛴다. 실제 PII 는 라벨/정규식/사전 패스가 별도로 처리한다.
  // 긴 이름부터 — 짧은 이름이 먼저 치환되면 긴 이름의 일부를 삼킨다.
  const names = [known.name, ...(known.extraNames ?? [])]
    .map((n) => n?.trim())
    .filter((n): n is string => !!n && n.length >= 2 && n !== "(이름 미상)")
    .sort((a, b) => b.length - a.length);
  for (const n of names) text = maskName(text, n);
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
  return maskDobDates(text.replace(RE_RRN, "[주민번호]"))
    .replace(RE_BIRTH_YEAR, "[생년월일]")
    .replace(RE_AGE_INLINE, "[나이]")
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
/**
 * 이름 마스킹 — **앞 경계만** 엄격하게 걸고 뒤는 열어 둔다.
 *
 * 한국어 이름 뒤에는 조사·호칭이 붙는다("홍길동은", "홍길동님"). maskByDict 처럼 뒤에도
 * 경계를 걸면 이런 형태를 통째로 놓친다. 반대로 앞 경계가 없으면(구 `split/join`) known 이
 * 부정확할 때 본문이 파괴된다 — 실측: 이름 "개발" → "웹[이름]팀에서 백엔드 [이름]자로",
 * 이름 "김민" → "[이름]수 대리와 협업. [이름]정 과장". 마스킹은 과검출이 안전한 방향이라
 * 앞만 막고 뒤는 허용한다.
 */
function maskName(text: string, name: string): string {
  if (!text.includes(name)) return text;
  return text.replace(
    new RegExp(`(?<![가-힣A-Za-z0-9])${escapeRe(name)}`, "g"),
    "[이름]"
  );
}

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

// M5 — 마스크 토큰 역주입 방지: 입력에 우리 마스크 토큰과 동일한 리터럴이 들어 있으면
// 마스킹 결과와 구분 불가 → 후속 재마스킹·LLM 처리에서 가짜 마스크로 오인 위험.
// 입력 단계에서 ZWSP(zero-width space) 삽입하여 시각적으론 동일하나 패턴 매칭 차단.
const MASK_TOKEN_LITERALS = [
  "[이름]","[전화]","[이메일]","[주민번호]","[URL]","[생년월일]",
  "[우편번호]","[주소]","[학교]","[회사]","[지역]","[내선번호]","[나이]",
  "[성별]","[혼인]","[종교]","[가족]",
];
function neutralizeMaskTokens(text: string): string {
  let out = text;
  for (const t of MASK_TOKEN_LITERALS) {
    if (!out.includes(t)) continue;
    out = out.split(t).join("[​" + t.slice(1));
  }
  return out;
}

export function maskText(
  text: string,
  opts: { level?: MaskLevel; known?: KnownPII } = {}
): string {
  const level = opts.level ?? "standard";
  // 0) 입력 내 우리 마스크 토큰 리터럴 무력화 (역주입 방지)
  let out = neutralizeMaskTokens(text);
  // 0.5) 이메일·전화 선(先)마스킹 (B-2) — 경계가 명확한 연락처 PII 를 라벨 패스 전에 원자적으로
  //   마스킹한다. 라벨 값 매칭(예: "전화 ...{6,30}")이 뒤따르는 이메일을 일부만 삼켜 ".com" 같은
  //   TLD 조각을 남기던 사고 방지(라벨이 보는 건 이미 [이메일]/[전화] 토큰). 주소/회사 등 다른
  //   정규식은 순서를 바꾸지 않는다(이름이 지번 패턴에 먼저 걸리는 부작용 회피) — 그건 3) 에서.
  out = out.replace(RE_EMAIL, "[이메일]").replace(RE_PHONE, "[전화]");
  // 0.6) 라벨 뒤 2자리 생년월일도 선(先)마스킹 — 같은 이유. 표 양식("성명 \n 생년월일 \n …")에서는
  //   앞선 라벨의 값 매칭(`\s*` 가 줄바꿈을 넘는다)이 "생년월일" 라벨 자체를 삼켜버려,
  //   라벨 패스 뒤에는 근거가 사라진 채 날짜만 남는다.
  out = out.replace(RE_DOB_LABELED_SHORT, "$1[생년월일]");
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

/**
 * 이메일·전화만 마스킹 — 채용공고 본문처럼 회사명·주소·URL 은 보존해야 하고
 * 개인 연락처(채용 담당자 등)만 걷어내면 되는 텍스트용.
 */
export function maskContacts(text: string): string {
  return text.replace(RE_EMAIL, "[이메일]").replace(RE_PHONE, "[전화]");
}

/**
 * 텍스트에 등장하는 대학(사전 등재) 목록을 등장 위치 순으로 반환.
 * 학력 추출(lib/education-extract.ts) 에서 학교명 식별에 재활용 — 마스킹 사전과 단일 출처 유지.
 * 긴 이름이 먼저 매칭되도록 정렬되어 있어 "서울대학교" 가 "서울" 보다 우선.
 */
export function findUniversitiesInText(
  text: string
): { name: string; index: number }[] {
  ensureDicts();
  const found: { name: string; index: number }[] = [];
  const taken: Array<[number, number]> = []; // 이미 잡힌 구간 (겹침 방지)
  for (const u of _universities ?? []) {
    if (u.length < 2) continue;
    // trailing 경계는 두지 않음 — PDF 추출이 공백을 잃어 "서울대학교IT융합학과" 처럼
    // 학교명 뒤에 전공이 붙어도 학교를 식별해야 함. leading 경계 + 긴이름 우선 +
    // taken 구간으로 부분/중복 매칭(예: "동서울대학교" 속 "서울대학교")은 차단된다.
    const re = new RegExp(
      `(?<![가-힣A-Za-z0-9])${escapeRe(u)}`,
      "g"
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      const end = start + u.length;
      // 더 긴 이름이 이미 차지한 구간이면 skip (예: "서울대학교" 잡힌 자리에 "서울" 재매칭 방지)
      if (taken.some(([s, e]) => start >= s && end <= e)) continue;
      taken.push([start, end]);
      found.push({ name: u, index: start });
    }
  }
  return found.sort((a, b) => a.index - b.index);
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
