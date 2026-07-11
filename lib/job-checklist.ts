import { generateJSON } from "./gemini";

/**
 * JD 요건 체크리스트 — 공고 단위 1회 생성.
 *
 * 왜: requirement_coverage 를 이력서 평가마다 LLM 이 즉석에서 "JD 를 4~8개로 쪼개기" 하면
 * 후보자마다 항목 개수·문구가 달라진다. "항목을 정하는 일"(공고 의존)과 "이 후보가 충족했나"
 * (후보 의존)를 분리해, 항목은 공고 저장 시 한 번만 확정·저장하고 평가 때는 그 고정 목록으로
 * status/evidence 만 판정하게 한다. → 같은 공고면 항상 동일한 JD 항목.
 */

const CHECKLIST_PROMPT = (responsibilities: string, requirements: string) => `너는 채용 JD 를 평가 항목으로 구조화하는 분석가다.
아래 "주요 업무"와 "자격 요건"을 읽고, 지원자를 평가할 **핵심 요건 항목**을 추려라.

## 주요 업무
${responsibilities}

## 자격 요건
${requirements}

## 규칙
- 항목 수는 **4~8개**. 가장 핵심적인 평가 포인트만. 사소·중복은 합쳐라.
- 각 항목은 **짧은 명사구**(40자 이내). 예: "Python 기반 백엔드 개발 경험", "SIEM/SOAR 솔루션 구축·운영 경험".
- **원문에 명시된 요건만** 사용. 없는 항목을 창작하지 말 것. 광고·복리후생·회사 소개는 제외.
- 중복·유사 항목은 하나로 병합 (예: "REST API 개발"과 "API 설계"는 한 항목으로).
- **학력·전공 요건은 체크리스트에 포함하지 말 것** (블라인드 채용 — 채용절차 공정화법). 최종학력(고졸/대졸/석박사 등)·관련 전공 조건은 항목으로 만들지 않는다. 나이·성별·출신지역 등 차별 금지 항목도 제외.
- 중요도·원문 순서대로 정렬.
- 한국어.

## 출력 형식 (반드시 아래 JSON 만. 마크다운/설명 금지)
{ "checklist": ["요건 항목1", "요건 항목2", ...] }`;

/**
 * 주요업무+자격요건에서 고정 요건 체크리스트를 생성한다.
 * 실패 시 빈 배열 반환 (호출측은 "" 로 저장 → 평가는 기존 즉석 분해로 폴백).
 */
export async function generateRequirementChecklist(input: {
  responsibilities: string;
  requirements: string;
}): Promise<string[]> {
  const responsibilities = (input.responsibilities ?? "").trim();
  const requirements = (input.requirements ?? "").trim();
  if (responsibilities.length + requirements.length < 10) return [];

  try {
    // JD 텍스트만 투입 (후보자 PII 없음) — 서울 장애 시 도쿄 폴백 허용
    const res = await generateJSON<{ checklist?: unknown }>(
      CHECKLIST_PROMPT(responsibilities, requirements),
      { task: "screening", allowFallback: true }
    );
    if (!res || !Array.isArray(res.checklist)) return [];
    const items = res.checklist
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.trim())
      .filter((x) => x.length > 0 && x.length <= 60)
      .slice(0, 8);
    return items;
  } catch {
    // LLM 실패는 치명적이지 않음 — 공고 저장은 진행, 평가는 폴백.
    return [];
  }
}

/** DB 저장용: string[] → JSON 문자열 ("" = 미생성) */
export function serializeChecklist(items: string[]): string {
  return items.length > 0 ? JSON.stringify(items) : "";
}

/** DB 읽기용: JSON 문자열 → string[] (파싱 실패·빈값이면 []) */
export function parseChecklist(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}
