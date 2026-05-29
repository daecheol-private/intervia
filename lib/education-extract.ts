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

type Rank = 1 | 2 | 3 | 4 | 5;
const LEVEL_LABEL: Record<Rank, string> = {
  5: "박사",
  4: "석사",
  3: "학사",
  2: "전문학사",
  1: "고졸",
};

/** 한 줄에서 학력 등급 키워드 감지. 더 구체적인 패턴(전문학사)을 학사보다 먼저 검사. */
function detectLevel(line: string): Rank | null {
  const t = line.toLowerCase();
  if (/박\s*사/.test(line) || /\bph\.?\s*d\b/.test(t) || /doctora(?:l|te)/.test(t))
    return 5;
  if (
    /석\s*사/.test(line) ||
    /master'?s?\b/.test(t) ||
    /\bm\.?\s*(?:s|a|sc|ba|eng)\b/.test(t)
  )
    return 4;
  if (
    /전문\s*학사/.test(line) ||
    /전문\s*대학?/.test(line) ||
    /associate'?s?\b/.test(t) ||
    /[23]\s*년\s*제/.test(line)
  )
    return 2;
  if (
    /학\s*사/.test(line) ||
    /bachelor'?s?\b/.test(t) ||
    /\bb\.?\s*(?:s|a|sc|ba|eng)\b/.test(t) ||
    /4\s*년\s*제/.test(line) ||
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

// 전공 후보 정제 — 노이즈(학교/학위/상태 단어) 제거.
function cleanMajor(raw: string): string | null {
  let s = raw.trim().split(/[,/()|·•\t]|\s{2,}/)[0].trim();
  s = s.replace(/\s+/g, " ");
  if (s.length < 2 || s.length > 25) return null;
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
  // 1) "전공: 컴퓨터공학" 라벨
  const lbl = line.match(/전\s*공\s*[:：·\-]?\s*([가-힣A-Za-z·&]{2,25})/);
  if (lbl) {
    const c = cleanMajor(lbl[1]);
    if (c) return c;
  }
  // 2) "컴퓨터공학과" / "전자공학부" / "데이터사이언스전공" 토큰
  //    (대학교/대학원 은 stripSchoolTokens 로 미리 제거되어 여기 안 걸림)
  const dept = line.match(/([가-힣A-Za-z·]{2,15}(?:학과|학부|전공))/);
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
  return null;
}

/** 사전 미등재 학교 fallback — "○○대학교/대학원" 일반 패턴. 공백 없이 전공이 붙어도 학교명만 잡음. */
function detectSchoolGeneric(line: string): string | null {
  const m = line.match(/([가-힣A-Za-z]{2,12}(?:대학교|대학원))/);
  return m ? m[1] : null;
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

  // 최고 등급 줄 찾기
  let best: { rank: Rank; status: string | null; lineIdx: number } | null = null;
  lines.forEach((line, idx) => {
    let rank = detectLevel(line);
    // 키워드 없지만 4년제 대학명 + 졸업/재학 류가 있으면 학사로 추정
    // (전문대·대학원 줄은 제외 — 전문대=전문학사, 대학원=등급 모호)
    if (
      rank == null &&
      uniByLine.has(idx) &&
      !/전문\s*대|대학원/.test(line) &&
      /(졸업|재\s*학|수료|입학|학번)/.test(line)
    ) {
      rank = 3;
    }
    if (rank == null) return;
    if (!best || rank > best.rank) {
      best = { rank, status: detectStatus(line), lineIdx: idx };
    }
  });

  if (!best) {
    // 학력 등급 단서 없음 — 대학명만 있으면 학교만 채움(수준 미상)
    const anyUni = uniByLine.values().next();
    return {
      level: null,
      school: anyUni.done ? null : anyUni.value,
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

  return { level, school, major };
}
