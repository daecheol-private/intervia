/**
 * 이력서 원문에서 정규식·라벨로 직접 식별자 추출.
 *
 * 추출 대상: name (라벨 있을 때만), phone, email, age (라벨 또는 DOB → 만 나이 계산).
 * 라벨 없는 케이스에서 이름은 추출하지 않음 — false positive 위험 + LLM 도 마스킹본 받아서 어차피 추출 불가.
 * career_summary / career_years 는 추론 필요 → LLM 영역.
 */

export type ExtractedPII = {
  name: string | null;
  phone: string | null;
  email: string | null;
  age: number | null;
  dobYear: number | null;
  companies: string[];
};

// 헤더에 단독으로 등장하는 한글 2~4자 이름은 후보자명일 가능성이 높음.
// 다만 동명의 헤더 단어(이력서, 자기소개 등)는 제외해야 false positive 방지.
// 표 양식·ATS 파싱 PDF 에서 자주 등장하는 섹션 라벨·상태값까지 포함.
const HEADER_BLACKLIST = new Set([
  // 문서 상위 라벨
  "이력서", "자기소개", "자기소개서", "소개서", "경력서", "경력기술서",
  "인적사항", "기본정보", "개인정보", "신상정보", "프로필",
  // 학력 관련
  "학력", "학력사항", "학력정보", "학력증명", "학력증명서",
  "학교", "학교명", "학과", "전공", "학년", "학위",
  "졸업", "졸업예정", "재학", "재학중", "휴학", "수료", "중퇴",
  "학사", "석사", "박사", "전문학사", "고졸", "대졸", "초대졸",
  // 경력 관련
  "경력", "경력사항", "경력정보", "경력기간", "경력기술", "직장경력",
  "회사", "회사명", "직장", "근무처", "재직", "재직중", "퇴사", "입사",
  "근무기간", "근무지", "직위", "직책", "직급", "부서",
  // 자격·어학·기술
  "자격", "자격증", "자격사항", "자격정보", "자격취득", "자격증명",
  "어학", "어학능력", "어학점수", "외국어", "외국어능력", "어학시험",
  "기술", "기술스택", "보유기술", "사용기술", "전문기술",
  "스킬", "스킬셋", "보유능력", "컴퓨터", "컴퓨터활용",
  // 활동·수상·기타
  "활동", "활동내역", "대외활동", "봉사활동", "동아리",
  "수상", "수상내역", "수상경력", "교육", "교육이수", "교육사항",
  "프로젝트", "포트폴리오", "취미", "특기", "병역", "사진",
  // 연락처·기타
  "연락처", "이메일", "전화", "전화번호", "휴대폰", "주소",
  "성명", "이름", "생년월일", "성별", "나이",
  "가족", "가족관계", "결혼", "혼인", "종교", "정치",
  // 짧은 단답 노이즈
  "남", "여", "남자", "여자", "한국", "대한민국", "재택", "출근", "원격",
  "유", "무", "있음", "없음", "해당", "선택", "기타",
]);

// 한국에서 인구 0.5% 이상 차지하는 주요 성씨 — 이름 추정 가드용 화이트리스트.
// (희귀 성씨는 라벨 매칭에 의존)
const COMMON_SURNAMES = new Set(
  "김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허유남심노하곽성차주우구민도소석위길연명봉추표어옥육변천진지엄채원라마방계계공왕피".split("")
);

// 회사/소속 라벨 — 마스킹 보강용으로 회사명 후보 수집
const RE_COMPANY_LABEL =
  /(?:회\s*사|회사명|직\s*장|직장명|근\s*무\s*처|소\s*속|재직회사|Company|Employer)\s*[:：·▶▷-]\s*([^\n,/]{2,40})/g;

// TLD 화이트리스트 — PDF 표 셀 사이 공백 손실로 "gmail.comEmail" 처럼 라벨이 붙어 추출되는 사고 방지.
// 다단계 TLD (co.kr 등) 를 단일 TLD (kr) 보다 먼저 두어 정확히 매칭.
const EMAIL_TLDS = [
  // 한국 다단계
  "co\\.kr", "ac\\.kr", "go\\.kr", "or\\.kr", "ne\\.kr", "pe\\.kr", "re\\.kr", "hs\\.kr", "ms\\.kr", "es\\.kr", "sc\\.kr",
  // gTLD 일반
  "info", "name", "tech", "xyz", "online", "site", "store", "design",
  "com", "net", "org", "edu", "gov", "mil", "biz", "app", "dev", "pro",
  // ccTLD 짧은
  "kr", "jp", "cn", "us", "uk", "de", "fr", "ca", "au", "nz", "in", "io", "me", "tv", "cc", "co",
].join("|");
const RE_EMAIL = new RegExp(
  `\\b[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.(?:${EMAIL_TLDS})`,
  "gi"
);
// 끝 경계 (?!\d) 를 두지 않는다 — 표 양식 PDF 에서 인접 셀(본인 휴대폰 + 긴급연락처)이 구분자
// 없이 "010-5145-7472010-5299-7472" 로 붙어 추출되는 케이스(candidate 374)에서, 끝 가드가 있으면
// 첫 번호 뒤에 둘째 번호 숫자가 붙어 매칭이 통째로 실패했다(앞 가드 때문에 둘째 번호도 못 잡음 → phone=null).
// 시작 경계 (?<!\d) 는 유지(긴 숫자열 중간 오매칭 방지) + 자릿수(3~4 + 4)로 길이가 고정이라,
// 끝 가드 없이도 g 플래그가 첫 11자리(=본인 번호)만 정확히 끊어 읽는다. lib/mask.ts RE_PHONE 와 동일 정책.
const RE_PHONE =
  /(?<!\d)(?:\+?82[-.\s]?)?0?1[016-9][-.\s]?\d{3,4}[-.\s]?\d{4}|(?<!\d)0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/g;

// 라벨 우선 추출용 — "휴대폰/연락처" 라벨 바로 뒤 번호를 본문 첫 매치보다 우선해 본인 번호 정확도를 높인다.
// (카카오톡/이메일 알림이 엉뚱한 번호로 가지 않도록.) PRIMARY(본인 휴대폰 강신호) > SECONDARY(일반 연락처) > 본문 첫 매치 순.
const RE_PHONE_PRIMARY_LABEL =
  /휴\s*대\s*폰|핸\s*드\s*폰|휴대전화|\bMobile\b|\bCell(?:\s*Phone)?\b|\bH\.?\s*P\b|\bM\.?\s*P\b/gi;
const RE_PHONE_SECONDARY_LABEL = /연락처|전화번호|전화|\bTel\b|\bPhone\b/gi;
// 라벨 바로 앞에 이런 수식어가 있으면 타인/비개인 번호(긴급연락처·보호자·회사대표·팩스) → 라벨 매칭에서 제외.
const RE_PHONE_LABEL_EXCLUDE = /(?:긴\s*급|비\s*상|보\s*호\s*자|가\s*족|회\s*사|대\s*표|팩\s*스|fax)\s*$/i;
// 이메일 라벨 — "이메일/전자우편/E-mail" 뒤 주소 우선.
const RE_EMAIL_LABEL = /이\s*메\s*일|전자우편|E-?\s*mail/gi;

// "이름: 홍길동" / "Name: John Doe" / "姓名: 王力宏"
const RE_NAME_LABEL =
  /(?:이\s*름|성\s*명|성명|Name|姓\s*名)\s*[:：·▶▷-]\s*([^\n,/]{1,30})/;

// "나이: 30세" / "30 세" / "Age: 30" / "만 30세"
// 끝 가드 (?!\d) 필수 — [세歳] 가 옵션이라, 없으면 "나이 1993년생"(나이 칸에 생년을 적는 흔한 표기)에서
// "19" 만 떼어 19세로 확정해버린다(candidate 29 실사고). 뒤에 숫자가 더 붙으면 나이가 아니라 연도다.
const RE_AGE_LABEL =
  /(?:나\s*이|만\s*나이|Age)\s*[:：·▶▷-]?\s*(\d{1,2})(?!\d)\s*[세歳]?/;
const RE_AGE_INLINE = /\(\s*만\s*(\d{1,2})\s*[세歳]\s*\)/;

// 생년월일 — 연도만 추출하면 나이 계산 가능. 첫/두 번째 구분자가 일치해야 함 (경력 기간 오매칭 방지).
const RE_DOB_YEAR =
  /\b(19\d{2}|20\d{2})(?:\s*([.\-/])\s*(?:1[0-2]|0?[1-9])\s*\2\s*(?:3[01]|[12]\d|0?[1-9])|\s*년\s*(?:1[0-2]|0?[1-9])\s*월\s*(?:3[01]|[12]\d|0?[1-9])\s*일|\s*年\s*(?:1[0-2]|0?[1-9])\s*月\s*(?:3[01]|[12]\d|0?[1-9])\s*日)/;

// "1993년생" / "93년생" — 월·일 없이 생년만 적는 표기. RE_DOB_YEAR(완전한 날짜)가 못 잡는 폴백.
const RE_BIRTH_YEAR = /(?<!\d)(19\d{2}|20\d{2}|\d{2})\s*년\s*생/;

function cleanName(raw: string): string {
  // 라벨 뒤 첫 토큰만 — 공백/괄호/쉼표 전까지
  const trimmed = raw.trim();
  const m = trimmed.match(/^([A-Za-z가-힣一-鿿][A-Za-z가-힣一-鿿·\s]{0,20})/);
  if (!m) return "";
  const cleaned = m[1].trim().replace(/\s+/g, " ");
  // 라벨 매칭 결과가 또 다른 섹션명이면 무효 — "성명: 학력사항" 같은 케이스
  if (HEADER_BLACKLIST.has(cleaned)) return "";
  // 한글 2~4자인데 성씨 화이트리스트에 없으면 의심 — false positive 차단
  if (/^[가-힣]{2,4}$/.test(cleaned) && !COMMON_SURNAMES.has(cleaned[0]))
    return "";
  return cleaned;
}

function normalizePhone(raw: string): string {
  // 1) +82/82 국가코드 → 0 로 환원 (010-1234-5678 형태로 통일)
  // 2) 숫자만 추출 후 010-XXXX-XXXX / 0XX-XXX(X)-XXXX 형태로 재포맷
  // 3) 매칭 안 되면 공백/점만 하이픈으로 변환한 최소 정규화
  const trimmed = raw.trim();
  const digits = trimmed
    .replace(/^\+?82[-.\s]?/, "0") // +82-10-... → 010-...
    .replace(/\D/g, "");
  if (/^01[016-9]\d{7,8}$/.test(digits)) {
    // 휴대폰 — 10자리(01X-XXX-XXXX) 또는 11자리(010-XXXX-XXXX)
    const mid = digits.length === 11 ? 7 : 6;
    return `${digits.slice(0, 3)}-${digits.slice(3, mid)}-${digits.slice(mid)}`;
  }
  if (/^0(2|[3-6]\d)\d{6,8}$/.test(digits)) {
    // 지역번호 — 02 / 0XX
    const head = digits.startsWith("02") ? 2 : 3;
    const rest = digits.slice(head);
    const mid = rest.length === 8 ? 4 : 3;
    return `${digits.slice(0, head)}-${rest.slice(0, mid)}-${rest.slice(mid)}`;
  }
  return trimmed.replace(/[.\s]+/g, "-").replace(/-+/g, "-");
}

// 라벨(휴대폰/연락처 등) 바로 뒤 40자 윈도우에서 첫 전화 매치. "긴급/회사" 등 수식어 붙은 라벨은 건너뜀.
// 라벨이 없거나 뒤에 번호가 없으면 null → 호출부가 본문 첫 매치로 폴백(기존 동작 유지, 회귀 없음).
function phoneNearLabel(text: string, labelRe: RegExp): string | null {
  labelRe.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = labelRe.exec(text)) !== null) {
    const before = text.slice(Math.max(0, m.index - 8), m.index);
    if (RE_PHONE_LABEL_EXCLUDE.test(before)) continue;
    const start = m.index + m[0].length;
    const found = text.slice(start, start + 40).match(RE_PHONE);
    if (found) return found[0];
  }
  return null;
}

// 이메일 라벨 바로 뒤 60자 윈도우에서 첫 이메일 매치.
function emailNearLabel(text: string): string | null {
  RE_EMAIL_LABEL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_EMAIL_LABEL.exec(text)) !== null) {
    const start = m.index + m[0].length;
    const found = text.slice(start, start + 60).match(RE_EMAIL);
    if (found) return found[0];
  }
  return null;
}

function calcAgeFromDOBYear(year: number): number | null {
  const now = new Date();
  const age = now.getFullYear() - year;
  if (age < 14 || age > 90) return null; // 비현실적 값 거절
  return age;
}

// "93년생" 의 2자리 연도 → 세기 보정. 19xx/20xx 두 후보는 100년 차이라
// 유효 범위(14~90세, 77년 폭)에 동시에 들 수 없어 모호하지 않다.
function resolveBirthYear(raw: string): number | null {
  if (raw.length === 4) return Number(raw);
  const yy = Number(raw);
  return (
    [1900 + yy, 2000 + yy].find((y) => calcAgeFromDOBYear(y) != null) ?? null
  );
}

// 이력서 첫 부분(~500자) 에서 한글 이름 추출. 보수적으로 — 잘못된 매칭이 빈 결과보다 나쁨.
//
// 통과 조건 (모두 충족):
//   1) 2~4자 순수 한글
//   2) 블랙리스트 미포함 (학력/경력 등 섹션 라벨 차단)
//   3) 첫 글자가 흔한 성씨 (false positive 큰 폭 감소)
//   4) "이력서" 라는 단어 등 노이즈가 같은 라인에 없음
function isPlausibleKoreanName(s: string): boolean {
  if (!/^[가-힣]{2,4}$/.test(s)) return false;
  if (HEADER_BLACKLIST.has(s)) return false;
  if (!COMMON_SURNAMES.has(s[0])) return false;
  return true;
}

function extractNameFromHeader(text: string): string | null {
  const head = text.slice(0, 500);
  const lines = head
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines.slice(0, 30)) {
    // 1) 단독 라인의 2~4자 한글
    if (isPlausibleKoreanName(line)) return line;
    // 2) "성명 홍길동" 식 인라인 라벨 — 짧은 라인에서만
    if (line.length <= 40) {
      const m = line.match(/(?:성\s*명|이\s*름)[\s:：]+([가-힣]{2,4})(?:\b|$)/);
      if (m && isPlausibleKoreanName(m[1])) return m[1];
    }
    // 3) "홍길동 (만 30세)" / "홍길동 010-..." 같이 다른 정보와 같은 라인
    if (line.length <= 60) {
      const m = line.match(/^([가-힣]{2,4})(?:\s+|\(|\[|·|—|-)/);
      if (m && isPlausibleKoreanName(m[1])) return m[1];
    }
  }
  return null;
}

function cleanCompanyValue(raw: string): string | null {
  const t = raw.trim().split(/[\s,/]/)[0]; // 공백/콤마/슬래시 앞만
  if (!t || t.length < 2 || t.length > 30) return null;
  // 토큰화 노이즈 거르기
  if (/^[\d.\-]+$/.test(t)) return null;
  return t;
}

export function extractPII(
  text: string,
  hints?: {
    providedName?: string | null;
    providedEmail?: string | null;
  }
): ExtractedPII {
  const result: ExtractedPII = {
    name: null,
    phone: null,
    email: null,
    age: null,
    dobYear: null,
    companies: [],
  };

  // 이름 — hints (업로더가 폼에 입력한 값) > 라벨 매칭 > 헤더 휴리스틱
  if (hints?.providedName?.trim()) {
    result.name = hints.providedName.trim();
  } else {
    const m = text.match(RE_NAME_LABEL);
    if (m) {
      const cleaned = cleanName(m[1]);
      if (cleaned.length >= 2) result.name = cleaned;
    }
    if (!result.name) {
      // 라벨 없는 케이스 — 이력서 헤더 첫 줄 패턴
      result.name = extractNameFromHeader(text);
    }
  }

  // 회사/소속 — 라벨 매칭으로 회사명 후보 수집 (마스킹 보강용)
  const seenCompanies = new Set<string>();
  let cm: RegExpExecArray | null;
  RE_COMPANY_LABEL.lastIndex = 0;
  while ((cm = RE_COMPANY_LABEL.exec(text)) !== null) {
    const v = cleanCompanyValue(cm[1]);
    if (v && !seenCompanies.has(v)) {
      seenCompanies.add(v);
      result.companies.push(v);
    }
  }

  // 이메일 — hints(폼 입력) > 라벨 뒤 주소 > 본문 첫 매치
  if (hints?.providedEmail?.trim()) {
    result.email = hints.providedEmail.trim();
  } else {
    result.email = emailNearLabel(text) ?? text.match(RE_EMAIL)?.[0] ?? null;
  }

  // 전화 — 라벨(휴대폰 > 연락처) 우선, 없으면 본문 첫 매치. 라벨 우선으로 본인 번호 정확도↑.
  const phoneRaw =
    phoneNearLabel(text, RE_PHONE_PRIMARY_LABEL) ??
    phoneNearLabel(text, RE_PHONE_SECONDARY_LABEL) ??
    text.match(RE_PHONE)?.[0] ??
    null;
  if (phoneRaw) result.phone = normalizePhone(phoneRaw);

  // 나이 — 라벨 우선, 그 다음 (만 XX세) 표기, 마지막으로 DOB 계산
  const ageLabel = text.match(RE_AGE_LABEL);
  if (ageLabel) {
    const n = Number(ageLabel[1]);
    if (n >= 14 && n <= 90) result.age = n;
  }
  if (result.age == null) {
    const ageInline = text.match(RE_AGE_INLINE);
    if (ageInline) {
      const n = Number(ageInline[1]);
      if (n >= 14 && n <= 90) result.age = n;
    }
  }
  const dobMatch = text.match(RE_DOB_YEAR);
  if (dobMatch) {
    const y = Number(dobMatch[1]);
    result.dobYear = y;
    if (result.age == null) result.age = calcAgeFromDOBYear(y);
  }
  if (result.dobYear == null) {
    const birthMatch = text.match(RE_BIRTH_YEAR);
    const y = birthMatch ? resolveBirthYear(birthMatch[1]) : null;
    if (y != null) {
      result.dobYear = y;
      if (result.age == null) result.age = calcAgeFromDOBYear(y);
    }
  }

  return result;
}
