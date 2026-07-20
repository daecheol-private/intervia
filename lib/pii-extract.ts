/**
 * 이력서 원문에서 정규식·라벨로 직접 식별자 추출.
 *
 * 추출 대상: name (라벨 있을 때만), phone, email, age (라벨 또는 DOB → 만 나이 계산),
 * careerYears ("총 경력 N년" 명시 표기만).
 * 라벨 없는 케이스에서 이름은 추출하지 않음 — false positive 위험 + LLM 도 마스킹본 받아서 어차피 추출 불가.
 * career_summary 와 "표기 없는 경력 추정"은 여전히 LLM 영역 — 여기서는 이력서에 적힌 총 경력만
 * 읽는다. AI 평가를 끄고 업로드해도 경력이 보이게 하는 게 목적이고, 평가를 돌리면 LLM 값이 덮는다.
 */

export type ExtractedPII = {
  name: string | null;
  phone: string | null;
  email: string | null;
  age: number | null;
  dobYear: number | null;
  /** 이력서에 "총 경력 N년" 으로 적힌 값만. 표기가 없으면 null (추정하지 않음). */
  careerYears: number | null;
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
  "성명", "이름", "생년월일",
  // 외국인 이력서의 어학·도구 섹션 (한글 이름이 없는 문서에서 오탐)
  "언어", "한국어", "영어", "중국어", "일본어", "도구", "초급", "중급", "고급", "능력", "성별", "나이",
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
// "(만 30세)" 뿐 아니라 "(30세)" 도 — 채용포털 export 는 "남, 1998 (28세)" 처럼 만 없이 쓴다.
// 14~90 범위 검사가 뒤따르므로 "만" 을 옵션으로 둬도 오탐이 늘지 않는다.
const RE_AGE_INLINE = /\(\s*(?:만\s*)?(\d{1,2})\s*[세歳]\s*\)/;
// 괄호가 나이로 시작하지 않는 경우 — "(1973년 01월생 / 만53세)". "세" 가 필수라 금액("1만")과 안 겹친다.
const RE_AGE_MAN = /만\s*(\d{1,2})\s*[세歳]/;

// 생년월일 — 연도만 추출하면 나이 계산 가능. 첫/두 번째 구분자가 일치해야 함 (경력 기간 오매칭 방지).
const RE_DOB_YEAR =
  /\b(19\d{2}|20\d{2})(?:\s*([.\-/])\s*(?:1[0-2]|0?[1-9])\s*\2\s*(?:3[01]|[12]\d|0?[1-9])|\s*년\s*(?:1[0-2]|0?[1-9])\s*월\s*(?:3[01]|[12]\d|0?[1-9])\s*일|\s*年\s*(?:1[0-2]|0?[1-9])\s*月\s*(?:3[01]|[12]\d|0?[1-9])\s*日)/;

/**
 * 총 경력 연수 — "총 경력 24년 4개월" / "경력 총 27년" / 줄 첫머리의 "총 30년".
 *
 * **"총" 을 요구한다.** 이게 없으면 자기소개 문장의 "…풀스택 개발자입니다. (경력1년반)" 같은
 * 표기까지 잡아 실제와 다른 값이 들어간다(실측 84건: "총" 없이는 6건 더 맞히지만 1건 오답).
 * 개월은 버린다 — 표기 규칙이 "11년 10개월 → 11년"(내림).
 */
const RE_CAREER_YEARS =
  /총\s*경\s*력\s*[:：]?\s*(\d{1,2})\s*년|경\s*력\s*총\s*(\d{1,2})\s*년|(?:^|\n)\s*총\s*(\d{1,2})\s*년/;

// "1993년생" / "93년생" / "1981년 生"(한자) — 월·일 없이 생년만 적는 표기.
// RE_DOB_YEAR(완전한 날짜)가 못 잡는 폴백. lib/mask.ts RE_BIRTH_YEAR 와 같은 표기를 대상으로 함.
const RE_BIRTH_YEAR = /(?<!\d)(19\d{2}|20\d{2}|\d{2})\s*년\s*[생生]/;

// 생년월일 라벨 — lib/mask.ts 의 dob 라벨 세트와 정렬(같은 표기를 대상으로 한다).
const RE_DOB_LABEL =
  /(?:생\s*년\s*월\s*일|생\s*년|생\s*일|출\s*생|Date\s*of\s*Birth|D\.?O\.?B\.?|Birth\s*(?:day|date)?|出\s*生|生\s*日)\s*[:：·▶▷-]?/i;

// 라벨 근처 전용 — 2자리 연도("83.01.24")까지 인정한다. 라벨이 맥락을 보증하므로
// 전체 스캔용 RE_DOB_YEAR 보다 느슨해도 되고, 구분자 일치도 요구하지 않는다.
const RE_DOB_LOOSE =
  /(?<!\d)(\d{4}|\d{2})\s*(?:[.\-/]\s*(?:1[0-2]|0?[1-9])\s*[.\-/]\s*(?:3[01]|[12]\d|0?[1-9])|년\s*(?:1[0-2]|0?[1-9])\s*월\s*(?:3[01]|[12]\d|0?[1-9])\s*일?)/;

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

// 라벨(휴대폰/연락처 등) 주변 전화 매치. "긴급/회사" 등 수식어 붙은 라벨은 건너뜀.
//
// 앞뒤를 모두 보고 **라벨에 더 가까운 쪽**을 택한다 — 표 양식 이력서는 값이 라벨보다 먼저 온다
// ("010-7333-4819휴대폰 / 02-967-4819전화번호", candidate 111). 뒤만 보면 "휴대폰" 라벨이
// 이메일을 건너뛰어 다음 셀의 일반전화를 집어와 본인 휴대폰이 유선번호로 덮인다.
// 라벨이 없거나 주변에 번호가 없으면 null → 호출부가 본문 첫 매치로 폴백(기존 동작 유지).
function phoneNearLabel(text: string, labelRe: RegExp): string | null {
  labelRe.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = labelRe.exec(text)) !== null) {
    const before = text.slice(Math.max(0, m.index - 8), m.index);
    if (RE_PHONE_LABEL_EXCLUDE.test(before)) continue;

    const start = m.index + m[0].length;
    RE_PHONE.lastIndex = 0;
    const fwd = RE_PHONE.exec(text.slice(start, start + 40));

    // 라벨 직전 창의 **마지막** 매치 = 라벨에 가장 붙어 있는 번호
    const prevWin = text.slice(Math.max(0, m.index - 20), m.index);
    RE_PHONE.lastIndex = 0;
    let back: RegExpExecArray | null = null;
    for (let e = RE_PHONE.exec(prevWin); e !== null; e = RE_PHONE.exec(prevWin)) back = e;

    if (!fwd && !back) continue;
    if (!back) return fwd![0];
    if (!fwd) return back[0];
    const backGap = prevWin.length - (back.index + back[0].length);
    return backGap <= fwd.index ? back[0] : fwd[0];
  }
  return null;
}

/**
 * 이메일 앞 글리프 간격 복원 — PDF 추출이 "wild_ jk@naver.com" 처럼 밑줄 뒤에 공백을 끼우면
 * 로컬파트 앞부분이 잘려 다른 주소("jk@naver.com")가 나온다. 뒤에 `@` 가 오는 경우로 한정해
 * 붙이므로 "홍길동 jk@..." 같은 정상 공백은 건드리지 않는다.
 */
function healEmailGaps(text: string): string {
  return text.replace(/([A-Za-z0-9._%+\-]*_)\s+(?=[A-Za-z0-9._%+\-]*@)/g, "$1");
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

/**
 * 생년월일 라벨 뒤에서 출생연도 추출 — 2자리 연도("생년월일: 83.01.24")를 인정한다.
 *
 * 라벨을 안 보고 문서 전체에서 첫 날짜를 취하면 경력 시작일·자격증 취득일이 생년월일이
 * 된다(실측: 후보 8명이 경력의 2026 년 날짜 때문에 dobYear=2026 → 나이 공백).
 * 라벨이 맥락을 보증할 때만 느슨한 패턴을 쓰므로 오탐을 늘리지 않는다.
 * 표 양식은 라벨과 값이 다른 셀로 떨어지므로 뒤 50자까지 본다.
 */
function dobYearNearLabel(text: string): number | null {
  const m = text.match(RE_DOB_LABEL);
  if (m?.index == null) return null;
  const start = m.index + m[0].length;
  const d = text.slice(start, start + 50).match(RE_DOB_LOOSE);
  return d ? resolveBirthYear(d[1]) : null;
}

// 이력서 첫 부분(~500자) 에서 한글 이름 추출. 보수적으로 — 잘못된 매칭이 빈 결과보다 나쁨.
//
// 통과 조건 (모두 충족):
//   1) 2~4자 순수 한글
//   2) 블랙리스트 미포함 (학력/경력 등 섹션 라벨 차단)
//   3) 첫 글자가 흔한 성씨 (false positive 큰 폭 감소)
//   4) "이력서" 라는 단어 등 노이즈가 같은 라인에 없음
function isPlausibleKoreanName(s: string): boolean {
  // 2~3자만 — 한국 이름은 대부분 2~3자다. 4자를 허용하면 "지원분야"·"주요강점"·"장애여부"·
  // "안세기술"(회사명) 같은 이력서 라벨이 성씨 조건을 통과해 이름으로 잡힌다(실측 84건).
  // 복성 4자 이름을 놓치지만, 틀린 이름은 빈 값보다 나쁘다는 원칙을 따른다.
  if (!/^[가-힣]{2,3}$/.test(s)) return false;
  // "유창함"·"가능함" 류 서술형 명사 — 이름 끝에 오지 않는 어미
  if (/[함됨음임]$/.test(s)) return false;
  if (HEADER_BLACKLIST.has(s)) return false;
  if (!COMMON_SURNAMES.has(s[0])) return false;
  return true;
}

/** 인적사항 블록 신호 — 이 근처의 단독 한글 토큰이라야 이름으로 인정한다. */
function hasPersonalInfoNear(chunk: string): boolean {
  RE_EMAIL.lastIndex = 0;
  RE_PHONE.lastIndex = 0;
  return (
    RE_EMAIL.test(chunk) ||
    RE_PHONE.test(chunk) ||
    /\(\s*(?:만\s*)?\d{1,2}\s*[세歳]\s*\)/.test(chunk) ||
    RE_DOB_LABEL.test(chunk)
  );
}

/**
 * 이력서 앞부분에서 이름 추출. **틀린 이름은 빈 값보다 나쁘다** — 최대한 보수적으로.
 *
 * 순서: ① "성명: 홍길동" 라벨(가장 확실) → ② 인적사항 블록 안의 단독 한글 2~4자.
 *
 * ⚠️ "라인 맨 앞 한글 2~4자 + 구분자" 규칙은 제거했다. 실측 84건에서 `지원분야  개발SM…`,
 * `육군 대위 출신으로…`, `오복전자`(회사명) 같은 걸 이름으로 잡아 정확도가 13% 였다.
 * ②에 연락처 근접 조건을 건 이유도 같다 — 채용포털 export 는 회사명·섹션 헤더가 문서
 * 맨 앞에 오고, 진짜 이름은 이메일·전화·나이와 같은 블록에 있다.
 */
function extractNameFromHeader(text: string): string | null {
  const head = text.slice(0, 1500); // 표 양식은 인적사항 블록이 문서 앞이 아닐 수 있다
  const lines = head.split(/\r?\n/).map((l) => l.trim());
  const scan = Math.min(lines.length, 60);

  // ① 라벨 — "성명 홍길동" / "이름: 홍길동" / "작성자 : 함세연" (라벨 세트는 lib/mask.ts 와 정렬)
  //    끝 경계는 (?![가-힣]) — `\b` 는 한글이 \w 가 아니라 "송명수 영문…" 에서 성립하지 않는다.
  for (let i = 0; i < scan; i++) {
    const line = lines[i];
    if (!line || line.length > 40) continue;
    const m = line.match(
      /(?:성\s*명|이\s*름|성\s*함|작\s*성\s*자|지\s*원\s*자|응\s*시\s*자|신\s*청\s*자)[\s:：]+([가-힣]{2,3})(?![가-힣])/
    );
    if (m && isPlausibleKoreanName(m[1])) return m[1];
  }
  // ⚠️ "라인 맨 앞 한글 2~3자 + 영문/한자" 로 병기 이름("김도현 Kim Do-hyun")을 잡으려다
  //    실측 84건에서 틀림이 0→11건 났다 — "고객 Center"·"서버 Linux"·"차세대 ERP" 처럼
  //    한글 단어 + 영문 기술용어가 이력서에 흔하고, 흔한 성씨(고·최·서·노·차·강·지)가
  //    필터 역할을 못 한다. 병기 이름을 잡으려면 로마자 **이름 형태**(2단어/하이픈) 검증이
  //    필요하고, 그것만으로도 부족하면 인적사항 블록 근접 조건까지 걸어야 한다.
  // ② 인적사항 블록 안의 단독 라인
  for (let i = 0; i < scan; i++) {
    const line = lines[i];
    if (!line || !isPlausibleKoreanName(line)) continue;
    if (hasPersonalInfoNear(lines.slice(Math.max(0, i - 3), i + 6).join("\n"))) return line;
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
    careerYears: null,
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
    const mailText = healEmailGaps(text);
    result.email = emailNearLabel(mailText) ?? mailText.match(RE_EMAIL)?.[0] ?? null;
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
  for (const re of [RE_AGE_INLINE, RE_AGE_MAN]) {
    if (result.age != null) break;
    const m = text.match(re);
    if (m) {
      const n = Number(m[1]);
      if (n >= 14 && n <= 90) result.age = n;
    }
  }
  // 생년월일 — 라벨 근처 우선(2자리 연도 허용), 라벨이 없을 때만 문서 전체 스캔으로 폴백
  const dobLabeled = dobYearNearLabel(text);
  if (dobLabeled != null) {
    result.dobYear = dobLabeled;
    if (result.age == null) result.age = calcAgeFromDOBYear(dobLabeled);
  }
  if (result.dobYear == null) {
    const dobMatch = text.match(RE_DOB_YEAR);
    if (dobMatch) {
      const y = Number(dobMatch[1]);
      result.dobYear = y;
      if (result.age == null) result.age = calcAgeFromDOBYear(y);
    }
  }
  if (result.dobYear == null) {
    const birthMatch = text.match(RE_BIRTH_YEAR);
    const y = birthMatch ? resolveBirthYear(birthMatch[1]) : null;
    if (y != null) {
      result.dobYear = y;
      if (result.age == null) result.age = calcAgeFromDOBYear(y);
    }
  }

  // 총 경력 — 명시 표기만. 없으면 null 로 두고 LLM(career_info.career_years)에 맡긴다.
  const career = text.match(RE_CAREER_YEARS);
  if (career) {
    const y = Number(career[1] ?? career[2] ?? career[3]);
    if (Number.isFinite(y) && y >= 0 && y <= 60) result.careerYears = y;
  }

  return result;
}
