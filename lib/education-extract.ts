/**
 * 이력서 원문에서 최종학력(수준 + 학교명) 결정적 추출.
 *
 * 업로드 시점에 1회 실행 — 원문(resumeText)은 저장하지 않으므로(프라이버시) 여기서만 추출 가능.
 * LLM 호출 없음(토큰 비용 0). 학력 "수준" 은 매우 안정적, 학교명은 best-effort.
 *
 * 수준 등급: 고졸(1) < 전문학사(2) < 학사(3) < 석사(4) < 박사(5).
 * 줄 단위로 등급을 잡고 전체 최고 등급을 최종학력으로 채택.
 * 학교명은 최종학력이 적힌 줄(±2줄)에서 대학 사전(lib/mask.ts) 매칭으로 식별.
 */
import { findUniversitiesInText } from "./mask";

export type Education = {
  level: string | null; // "박사" / "석사 수료" / "학사 졸업" / "전문학사" / "고졸" 등
  school: string | null; // 최종 학교명
  major: string | null; // 전공/학과 (예: "컴퓨터공학과", "경영학")
};

// 표 양식 이력서는 셀 하나가 한 줄씩 분해되고 사이에 빈 줄이 낀다 — 실측한 이력서의
// 학력 표는 "구분/입학/졸업/학교명/전공/졸업구분/소재지" 7칸이 14줄로 펼쳐졌다.
const ROW_SPAN = 14;

// 미기입 표시 — 양식 템플릿을 지우지 않고 낸 이력서의 빈 칸.
const RE_PLACEHOLDER = /YYYY|yyyy|NNNN|____|＿＿/;
// 실제로 기입된 연월 — "2015.09" / "1998-02" / "1992년".
const RE_REAL_PERIOD = /(?:19|20)\d{2}\s*[.\-/년]/;

// 재학 "기간" 표기 — "2020.03 ~ 2024.02" / "‘20.03 ~ 26.02’"(따옴표 축약형).
// 학력 행이 기간만 쓰고 "졸업" 을 생략하는 양식이 있다(실측 candidates/382).
const RE_SCHOOL_PERIOD = /(?:(?:19|20)\d{2}|['’‘]\d{2})\s*[.\-/]\s*\d{1,2}\s*[~\-–—]/;

type Rank = 1 | 2 | 3 | 4 | 5;
const LEVEL_LABEL: Record<Rank, string> = {
  5: "박사",
  4: "석사",
  3: "학사",
  2: "전문학사",
  1: "고졸",
};

/**
 * 한글 학위어("석사"·"박사"·"학사") 판정.
 *
 * 뒤에 다른 한글이 이어지면 학위가 아니다 — "분석 사례"·"박 사원"·"입학 사정" 이
 * `석\s*사` 류에 걸려 오탐하던 것을 막는다. 학위 접미사만 예외로 허용.
 * (앞쪽은 "공학석사"처럼 전공이 붙는 게 정상이라 막지 않는다.)
 */
function hasKoreanDegree(line: string, word: "박사" | "석사" | "학사"): boolean {
  const [a, b] = word;
  return new RegExp(
    `${a}\\s?${b}(?![가-힣])|${a}\\s?${b}(?=학위|과정|졸업|수료|재학|휴학|중퇴|취득)`
  ).test(line);
}

/** 한 줄에서 학력 등급 키워드 감지. 더 구체적인 패턴(전문학사)을 학사보다 먼저 검사. */
function detectLevel(line: string): Rank | null {
  const t = line.toLowerCase();
  if (hasKoreanDegree(line, "박사") || /\bph\.?\s*d\b/.test(t) || /doctora(?:l|te)/.test(t))
    return 5;
  if (
    hasKoreanDegree(line, "석사") ||
    // "Scrum Master"·"webmaster"·"master branch" 오탐 차단 — 소유격/학위 문맥만 인정.
    /\bmaster'?s\b/.test(t) ||
    /\bmaster\s+(?:of|degree)\b/.test(t) ||
    // 점 없는 "MS"/"MA" 는 MS워드·MS Office·MA(단독) 오탐이 많아 점 있는 형태만 인정.
    /\bm\.\s*(?:s|a|sc|ba|eng)\b/.test(t) ||
    /\b(?:msc|mba|m\.b\.a)\b/.test(t)
  )
    return 4;
  if (
    /전문\s*학사/.test(line) ||
    /전문\s*대학?/.test(line) ||
    /associate'?s?\b/.test(t) ||
    /[23]\s*년\s*제/.test(line) ||
    // 채용포털(사람인/잡코리아) 학력 표기: "대학(2,3년)" / "대학(2년)" / "대학 (2~3년)"
    /대학\s*\(\s*[23](?:\s*[,~\-]\s*3)?\s*년\s*\)?/.test(line)
  )
    return 2;
  if (
    hasKoreanDegree(line, "학사") ||
    /\bbachelor'?s?\b/.test(t) ||
    // 점 없는 "BA"/"BS" 는 Business Analyst 등 오탐이 많아 점 있는 형태만 인정.
    /\bb\.\s*(?:s|a|sc|ba|eng)\b/.test(t) ||
    /\b(?:bsc|beng)\b/.test(t) ||
    /4\s*년\s*제/.test(line) ||
    // 채용포털 학력 표기: "대학교(4년)" / "대학(4년)"
    /대학(?:교)?\s*\(\s*4\s*년\s*\)?/.test(line) ||
    /학\s*부/.test(line)
  )
    return 3;
  if (/고\s*졸/.test(line) || /고등\s*학교/.test(line) || /high\s*school/.test(t))
    return 1;
  return null;
}

/** 졸업 상태 — 표시에 덧붙임. */
function detectStatus(line: string): string | null {
  if (/졸업\s*예정/.test(line)) return "졸업예정";
  if (/졸업/.test(line)) return "졸업";
  if (/수료/.test(line)) return "수료";
  if (/재\s*학/.test(line)) return "재학";
  if (/휴\s*학/.test(line)) return "휴학";
  if (/중\s*퇴/.test(line)) return "중퇴";
  return null;
}

// 표 헤더 줄이 전공으로 잡히는 것 차단 — "재학기간학교명학과(전공)주야구분졸업여부" 처럼
// 공백 없이 추출되면 "재학기간학교명학과" 가 통째로 학과명 패턴에 걸린다.
const MAJOR_HEADER_WORDS = /재학기간|학교명|졸업여부|졸업구분|주야|입학년|졸업년|학년도|학력/;

// 고등학교 계열은 전공이 아니다 — "계열" 을 전공 접미사로 인정하면서 같이 걸려 들어온다.
const HIGHSCHOOL_TRACK = /^(?:인문|자연|문과|이과|예체능|실업|상업|공업|보통|일반)\s*계열$/;


// 전공 후보 정제 — 노이즈(학교/학위/상태 단어) 제거.
function cleanMajor(raw: string): string | null {
  let s = raw.trim().split(/[,/()|·•\t]|\s{2,}/)[0].trim();
  s = s.replace(/\s+/g, " ");
  // 선행 조사 제거 — 학과명 앞 공백 1개를 허용하면서 "○○대학교에서 컴퓨터과학과" 의
  // 학교 토큰 제거 후 남은 "에서" 가 전공에 붙는다(실측 #80). 학과명이 조사로 시작할 일은 없다.
  s = s.replace(/^(?:에서|에게|에|의|를|을|은|는|이|가|와|과|로|으로|및|와의)\s+/, "");
  if (s.length < 2 || s.length > 25) return null;
  if (MAJOR_HEADER_WORDS.test(s)) return null;
  if (HIGHSCHOOL_TRACK.test(s)) return null;
  // 학위/상태/학교 단어가 그대로면 전공 아님
  if (
    /(대학교|대학원|고등학교|학사|석사|박사|전문학사|졸업|재학|수료|중퇴|고졸)/.test(
      s
    ) &&
    !/(학과|학부|전공)/.test(s)
  )
    return null;
  return s;
}

/** 한 줄에서 전공/학과 추출. */
function detectMajor(line: string): string | null {
  // 1) "전공: 컴퓨터공학" 라벨 — 구분자를 필수로 둔다.
  //    옵션으로 두면 자기소개서의 동사 "전공하며"·"전공하였으며"·"전공 지식을 쌓았습니다" 에
  //    걸려 "하며"·"하였으며"·"지식을" 이 전공으로 잡힌다(실측 84건에서 3건).
  const lbl = line.match(/전\s*공\s*[:：·\-]\s*([가-힣A-Za-z·&]{2,25})/);
  if (lbl) {
    const c = cleanMajor(lbl[1]);
    if (c) return c;
  }
  // 2) "(주) 수학과 (부) 응용소프트웨어학과" — 괄호 주/부전공 마커. 주전공을 택한다.
  //    학과 접미사를 필수로 둔다 — "(주) 카카오" 같은 법인 표기를 전공으로 집지 않게.
  //    아래 3번 토큰 규칙은 "수" + "학과"(앞 토큰 1글자 < 최소 2글자)로 매칭에 실패해
  //    부전공인 "응용소프트웨어학과" 를 집는다. 주전공이 정답이라 여기서 먼저 가로챈다.
  const primary = line.match(/\(\s*주\s*\)\s*([가-힣A-Za-z·]{1,15}(?:학과|학부|전공|과))/);
  if (primary) {
    const c = cleanMajor(primary[1]);
    if (c) return c;
  }
  // 3) "경영/정보학 복수전공" — 복수/부/주전공은 전공명이 아니므로 그 앞의 실제 전공을 잡는다.
  //    (여러 전공이 나오면 cleanMajor 가 첫 번째만 남긴다 — 하나만 표기해도 무방)
  const multi = line.match(/([가-힣A-Za-z·/]{2,25}?)\s*(?:복수|부|주|심화)\s*전공/);
  if (multi) {
    const c = cleanMajor(multi[1]);
    if (c) return c;
  }
  // 3) "컴퓨터공학과" / "전자공학부" / "데이터사이언스전공" / "디지털콘텐츠계열" 토큰
  //    (대학교/대학원 은 stripSchoolTokens 로 미리 제거되어 여기 안 걸림)
  //    ⚠️ 공백 1개까지 허용 — "컴퓨터 공학과" 처럼 띄어 쓴 학과명이 공백에서 끊겨
  //    "공"+"학과"(앞 토큰 1글자 < 최소 2글자)로 매칭 실패하던 문제(실측 #76: 전공을 놓치고
  //    두 줄 아래 다른 학력 행의 "치위생학과" 를 집었다). 두 칸 이상 공백은 표의 칸 경계라
  //    붙이지 않는다(cleanMajor 가 `\s{2,}` 로 자름).
  const dept = line.match(
    /([가-힣A-Za-z·]{2,15}(?:\s[가-힣A-Za-z·]{1,10})?(?:학과|학부|전공|계열))/
  );
  if (dept) {
    const c = cleanMajor(dept[1]);
    if (c) return c;
  }
  // 3) 영문 "Major in Computer Science" / "in Computer Science"
  const eng = line.match(/(?:major(?:ed)?\s+in|in)\s+([A-Z][A-Za-z&\s]{2,30})/);
  if (eng) {
    const c = cleanMajor(eng[1]);
    if (c) return c;
  }
  // 4) 단독 학과명 — "디지털전자과" 처럼 학과/학부/전공 접미사 없이 "○○과" 로
  //    끝나는 전문대 학과명. 채용포털 양식은 학과를 학력 섹션 별도 줄로 분리한다.
  return detectStandaloneDept(line);
}

// "○○과" 로 끝나는 학과명이 줄 전체일 때만 인정 (산문의 결과/통과/성과 등 오탐 방지).
const DEPT_NON_MAJOR = new Set([
  "결과", "통과", "경과", "성과", "효과", "사과", "결과물", "과정", "과목",
]);
function detectStandaloneDept(line: string): string | null {
  const t = line.trim();
  const m = t.match(/^([가-힣]{2,10}과)$/); // 줄 전체가 한글 2~10자 + "과"
  if (!m) return null;
  if (DEPT_NON_MAJOR.has(m[1])) return null;
  return cleanMajor(m[1]);
}

/**
 * 학교명 뒤 캠퍼스 표기를 붙인다 — "고려대학교 (세종)" → "고려대학교(세종)".
 *
 * 같은 대학이라도 캠퍼스가 다르면 다른 학교로 취급되는 게 통례라 표기해 준다.
 * 학교명 뒤 괄호에는 캠퍼스 말고도 학제·학위·부서가 오므로(실측 93건에서 "(4년제)" "(2·3년제)"
 * "(석사과정)" "(편입)" "(학술정보팀)" 등) 아래를 캠퍼스가 **아닌** 것으로 걸러낸다.
 *
 * ⚠️ 캠퍼스명은 **최소 2글자**다(세종·안성·글로벌·ERICA…). 1글자를 허용했더니 주/부전공
 * 표기 "광운대학교 (주) 수학과 (부) 응용소프트웨어학과" 의 "(주)" 가 캠퍼스로 붙어
 * "광운대학교(주)" 가 됐다.
 */
const CAMPUS_NOT =
  /\d|학위|과정|편입|입학|졸업|재학|수료|년제|학사|석사|박사|전공|복수|[팀실소과부처원]$/;
function withCampus(text: string, school: string | null): string | null {
  if (!school) return school;
  const esc = school.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = text.match(
    new RegExp(`${esc}\\s*\\(\\s*([가-힣A-Za-z][가-힣A-Za-z ]{1,9})\\s*\\)`)
  );
  const campus = m?.[1].trim();
  if (!campus || CAMPUS_NOT.test(campus)) return school;
  return `${school}(${campus})`;
}

/** 사전 미등재 학교 fallback — "○○대학교/대학원" 일반 패턴. 공백 없이 전공이 붙어도 학교명만 잡음. */
function detectSchoolGeneric(line: string): string | null {
  // 학점은행제는 학교가 아니지만 이력서 학력란의 "학교명" 칸에 이렇게 적힌다 — 그대로 쓴다.
  if (/학점\s*은행\s*제?/.test(line)) return "학점은행제";
  const m = line.match(/([가-힣A-Za-z]{2,12}(?:대학교|대학원))/);
  if (!m) return null;
  // 표 셀이 공백 없이 붙어 라벨이 학교명에 흡수되는 경우 — "학력" + "대학교" → "학력대학교".
  const cut = m[1].replace(/^(?:최종)?학력|^졸업|^구분|^학교명?/, "");
  if (cut !== m[1]) return cut.length >= 4 ? cut : null;
  return m[1];
}

/** 전공 추출 전, 줄에서 학교 토큰을 제거 — 공백 소실로 학교명이 전공에 섞이는 것 방지. */
function stripSchoolTokens(line: string, school: string | null): string {
  let s = line;
  if (school) s = s.split(school).join(" ");
  // 사전 미등재 학교도 대응 — "○○대학교/대학원/대학" 토큰 제거.
  s = s.replace(/[가-힣A-Za-z]{2,12}(?:대학교|대학원|대학)/g, " ");
  return s;
}

function lineIndexOf(charIdx: number, lineStarts: number[]): number {
  let lo = 0,
    hi = lineStarts.length - 1,
    ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lineStarts[mid] <= charIdx) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

export function extractEducation(rawText: string): Education {
  if (!rawText || rawText.length < 5)
    return { level: null, school: null, major: null };

  const norm = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = norm.split("\n");

  // 줄 시작 오프셋 — 대학 매칭 위치(전역 인덱스)를 줄 번호로 환산
  const lineStarts: number[] = [];
  {
    let p = 0;
    for (const l of lines) {
      lineStarts.push(p);
      p += l.length + 1; // +1 = '\n'
    }
  }

  // 대학 등장 → 줄 번호 매핑 (줄당 첫 매칭만)
  const uniByLine = new Map<number, string>();
  for (const u of findUniversitiesInText(norm)) {
    const li = lineIndexOf(u.index, lineStarts);
    if (!uniByLine.has(li)) uniByLine.set(li, u.name);
  }

  // 등급이 잡힌 줄 전부 수집 — 뒤에서 "학교명이 따라오는지" 로 거른다
  const hits: { rank: Rank; status: string | null; lineIdx: number }[] = [];
  lines.forEach((line, idx) => {
    let rank = detectLevel(line);
    // "○○대학원" 행 — 대학원 과정은 석사가 기본이다("석사" 를 안 쓰고 "일반대학원" 으로만
    // 적는 이력서가 흔하다. 박사는 "박사" 표기를 detectLevel 이 별도로 잡는다).
    // 표 양식은 "숭실대학교 일반대학원" / "IT융합학과 졸업" 처럼 학교와 졸업 상태를 다른 셀
    // (=다른 줄)로 떨구므로 상태는 인접 ±2줄에서 확인한다.
    // ⚠️ 자기소개 산문("대학원을 진학하게 되었고")까지 인정하면 그 줄이 최종학력 행이 되어
    // 학교·전공을 놓친다 — 학력 행의 형태(학교명 동반 또는 짧은 표 셀)일 때만 잡는다.
    if (
      rank == null &&
      /대\s*학\s*원/.test(line) &&
      (uniByLine.has(idx) || detectSchoolGeneric(line) || line.trim().length <= 20) &&
      /(졸\s*업|수\s*료|재\s*학|휴\s*학|중\s*퇴)/.test(
        lines.slice(Math.max(0, idx - 2), idx + 3).join(" ")
      )
    ) {
      rank = 4;
    }
    // 키워드 없지만 4년제 대학명 + 졸업/재학 류가 있으면 학사로 추정
    // (전문대·대학원 줄은 제외 — 전문대=전문학사, 대학원=등급 모호)
    // detectSchoolGeneric 도 근거로 쓴다 — 표 셀이 붙어 추출된
    // "2020.03~2025.02남서울대학교멀티미디어공학과주간졸업" 은 사전 매칭이 안 되어
    // 고등학교 행(고졸)이 최종학력이 되던 케이스(#14).
    // 과거 "학력"+"대학교" 가 붙은 "학력대학교" 를 학교로 오인해 회귀를 냈으나(#28·#89),
    // detectSchoolGeneric 에 라벨 흡수 방어를 넣어 해소했다.
    if (
      rank == null &&
      (uniByLine.has(idx) || detectSchoolGeneric(line)) &&
      !/전문\s*대|대학원/.test(line) &&
      // 재학 기간도 근거로 인정 — "‘20.03 ~ 26.02’ 광운대학교 / (주) 수학과" 처럼
      // 기간을 적고 "졸업" 을 안 쓰는 양식은 학력 자체를 통째로 놓쳤다(실측 #382).
      (/(졸업|재\s*학|수료|입학|학번)/.test(line) || RE_SCHOOL_PERIOD.test(line))
    ) {
      rank = 3;
    }
    if (rank == null) return;
    hits.push({ rank, status: detectStatus(line), lineIdx: idx });
  });

  // 학위 줄이 속한 표 행의 끝 — 다음 학위 줄 직전까지, 최대 ROW_SPAN 줄.
  const rowEnd = (lineIdx: number): number => {
    const next = hits.find((h) => h.lineIdx > lineIdx)?.lineIdx;
    const cap = lineIdx + ROW_SPAN;
    return Math.min(lines.length - 1, next != null ? Math.min(next - 1, cap) : cap);
  };

  /**
   * 미기입 학위 행인가 — 양식의 "대학원(박사)" 빈 칸처럼 라벨만 남고 값이 `YYYY.MM`
   * 플레이스홀더뿐인 행. 플레이스홀더가 **있고** 실제 값(연월·학교명)이 **하나도 없을 때만**
   * 미기입으로 본다.
   *
   * ⚠️ 판정 근거를 "학교명이 따라오는가" 로 넓혔다가 회귀 51 건을 냈다(학사→고졸 강등,
   * 상태 suffix 소실, 엉뚱한 학교 매칭). 학교명 인식은 약칭("창원대")·표 붙음("학력대학교")에
   * 취약해 근거로 쓸 수 없다. 배제 조건은 이 좁은 형태로만 유지할 것.
   */
  const isBlankTemplateRow = (lineIdx: number): boolean => {
    let placeholder = false;
    let real = false;
    for (let i = lineIdx; i <= rowEnd(lineIdx); i++) {
      const t = (lines[i] ?? "").trim();
      if (!t) continue;
      if (RE_PLACEHOLDER.test(t)) {
        placeholder = true;
        continue;
      }
      if (RE_REAL_PERIOD.test(t) || detectSchoolGeneric(t)) real = true;
    }
    return placeholder && !real;
  };

  const usable = hits.filter((h) => !isBlankTemplateRow(h.lineIdx));
  const pool = usable.length ? usable : hits;
  let best: { rank: Rank; status: string | null; lineIdx: number } | null = null;
  for (const h of pool) {
    if (!best || h.rank > best.rank) best = h;
  }

  if (!best) {
    // 학력 등급 단서 없음 — 대학명만 있으면 학교만 채움(수준 미상)
    const anyUni = uniByLine.values().next();
    return {
      level: null,
      school: anyUni.done ? null : withCampus(norm, anyUni.value),
      major: null,
    };
  }

  // ⚠️ TS 가 forEach 콜백 이후 best 를 다시 null 로 좁히는 것 방지용 지역 복사
  const found: { rank: Rank; status: string | null; lineIdx: number } = best;
  const label = LEVEL_LABEL[found.rank];
  // "고졸 졸업" 은 중복 표현 — 고졸은 이미 졸업 의미. 그 외 등급은 상태 suffix 유지.
  const showStatus =
    found.status && !(found.rank === 1 && found.status === "졸업");
  const level = showStatus ? `${label} ${found.status}` : label;

  // 학교명 — 최종학력 줄, 없으면 ±2줄 인접에서 (사전 매칭 우선)
  // ⚠️ 탐색 범위를 행 전체(ROW_SPAN)로 넓혔다가 다른 행의 학교를 집는 회귀를 냈다. ±2 유지.
  let school: string | null = uniByLine.get(found.lineIdx) ?? null;
  if (!school) {
    for (let d = 1; d <= 2 && !school; d++) {
      school = uniByLine.get(found.lineIdx - d) ?? uniByLine.get(found.lineIdx + d) ?? null;
    }
  }
  // 사전에 없는 학교 fallback — "○○대학교/대학원" 일반 패턴 (최종학력 줄 ±2)
  if (!school) {
    school = detectSchoolGeneric(lines[found.lineIdx] ?? "");
    for (let d = 1; d <= 2 && !school; d++) {
      school =
        detectSchoolGeneric(lines[found.lineIdx - d] ?? "") ??
        detectSchoolGeneric(lines[found.lineIdx + d] ?? "");
    }
  }

  // 전공 — 최종학력 줄, 없으면 ±2줄 인접에서. 학교명이 붙어 섞이지 않게 학교 토큰 제거 후 추출.
  const majorAt = (li: number): string | null =>
    detectMajor(stripSchoolTokens(lines[li] ?? "", school));
  let major: string | null = majorAt(found.lineIdx);
  for (let d = 1; d <= 2 && !major; d++) {
    major = majorAt(found.lineIdx - d) ?? majorAt(found.lineIdx + d);
  }
  // 확정된 학교명이 등장하는 줄에서 — 이력서 앞 요약란("최종학력 : ○○대학교(4년) 졸업")이
  // 최종학력 줄로 잡히면 실제 학력 행("2011.03~2019.02 서경대학교 행정학과 졸업")이 ±2 밖이라
  // 전공을 놓친다. 학교명을 앵커로 쓰면 다른 행을 잘못 집을 위험 없이 그 행에 닿는다.
  if (!major && school) {
    for (let i = 0; i < lines.length && !major; i++) {
      if (!lines[i].includes(school)) continue;
      major = majorAt(i);
      // 채용포털 양식의 한 학력 행은 "전공 / 기간 / 졸업여부 / 학교 / 학점" 순이라
      // 전공 칸이 학교 칸보다 **위**에 온다. 아래를 보면 다음(하위 학위) 행을 집는다.
      for (let d = 1; d <= 4 && !major; d++) major = majorAt(i - d);
      // ⚠️ "학교 칸 3칸 위 = 전공 칸" 같은 **위치 규칙을 쓰지 말 것**. 한 양식(사람인 export)에는
      // 맞지만 다른 양식에서는 회사명("효성ITX")·이름("이민정")·"이력서" 를 전공으로 집는다
      // — 실측 84건에서 틀림이 8→24건으로 늘었다. 접미사 패턴만 근거로 쓴다.
      //
      // ⚠️ 접미사 없는 전공("인공지능"/"정보통신")을 여기서 "짧은 한글 명사구" 로 인정해봤다가
      // 학력 틀림이 7→38 로 폭증했다(2026-07-28, 샘플 91건). 학교 앵커 근처로 범위를 좁히고
      // 학위·상태·헤더 단어를 제외해도 마찬가지다 — 전공 칸과 구분되지 않는 짧은 명사가
      // 이력서에 너무 많다. **접미사 없는 전공은 포기한다**(#79 "정보통신", #106 "인공지능").
    }
  }
  // 인접·학교앵커에서 못 찾으면 — 채용포털 양식은 학과를 학력 섹션 내 별도 줄로 분리하므로
  // 전체에서 "단독 학과명 줄"(예: "디지털전자과")을 fallback 스캔.
  // ⚠️ 문서 전체를 훑으므로 **다른 학력 행의 전공**을 집을 수 있다(석사가 최종학력인데 학사
  // 행의 "물리학과" 를 주워오는 식). 학교명 앵커가 실패했을 때의 마지막 수단으로만 둔다.
  // ⚠️ 스캔 방향을 "최종학력 줄 아래" 로 제한해봤다가 더 나빠졌다(2026-07-28) — 학력 섹션을
  // 지나 본문까지 훑어 "및주요성과" 같은 산문 조각을 전공으로 집는다. 전체 스캔을 유지할 것.
  if (!major) {
    for (const l of lines) {
      const d = detectStandaloneDept(l.trim());
      if (d) {
        major = d;
        break;
      }
    }
  }

  // 캠퍼스 표기는 마지막에 붙인다 — 전공 추출이 stripSchoolTokens 로 원문의 학교 토큰을
  // 지우는데, 여기서 미리 붙이면 원문과 어긋나 제거가 실패한다.
  return { level, school: withCampus(norm, school), major };
}
