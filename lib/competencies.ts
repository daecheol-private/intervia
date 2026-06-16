/**
 * NCS 직업기초능력 10개 영역 — 법인 컬처핏 "핵심 역량" 어휘.
 *
 * 왜 NCS 인가: MBTI·DISC 같은 성격유형은 상표·라이선스 문제 + 채용 타당도 논란이 있는 반면,
 * NCS(국가직무능력표준) 직업기초능력은 공공·대기업 인사팀이 공유하는 **공신력 있는 표준 어휘**다.
 * 법인이 여기서 핵심 역량을 골라 두면 AI 면접 평가·리포트가 면접관에게 익숙한 표준어로 말한다.
 *
 * 이 모듈은 순수(react/서버 의존 없음) — 설정 화면(client), 리포트(client), 프롬프트(server)
 * 모두에서 안전하게 import 한다.
 */

export type CompetencyKey =
  | "communication"
  | "numeracy"
  | "problemSolving"
  | "selfDevelopment"
  | "resourceManagement"
  | "interpersonal"
  | "information"
  | "technical"
  | "organizationalUnderstanding"
  | "workEthics";

/** NCS 표준 순서 — 설정 화면·리포트의 표시 순서로도 사용 */
export const NCS_COMPETENCY_KEYS: CompetencyKey[] = [
  "communication",
  "numeracy",
  "problemSolving",
  "selfDevelopment",
  "resourceManagement",
  "interpersonal",
  "information",
  "technical",
  "organizationalUnderstanding",
  "workEthics",
];

export type CompetencyMeta = {
  /** NCS 공식 영역명 */
  label: string;
  /** 면접관용 한 줄 설명 (칩 hover·부제) */
  short: string;
};

export const NCS_COMPETENCY_LABELS: Record<CompetencyKey, CompetencyMeta> = {
  communication: { label: "의사소통능력", short: "명확한 전달·경청과 설득" },
  numeracy: { label: "수리능력", short: "데이터·수치 해석과 활용" },
  problemSolving: { label: "문제해결능력", short: "원인 분석과 대안 도출" },
  selfDevelopment: { label: "자기개발능력", short: "학습·성장과 자기관리" },
  resourceManagement: { label: "자원관리능력", short: "시간·예산·인력 운용" },
  interpersonal: { label: "대인관계능력", short: "협업·갈등 조정과 팀워크" },
  information: { label: "정보능력", short: "정보 수집·분석과 활용" },
  technical: { label: "기술능력", short: "직무 기술의 이해와 적용" },
  organizationalUnderstanding: {
    label: "조직이해능력",
    short: "조직 체계·비즈니스 이해",
  },
  workEthics: { label: "직업윤리", short: "성실성·책임감과 규범 준수" },
};

const KEY_SET = new Set<string>(NCS_COMPETENCY_KEYS);

/**
 * 외부 입력(폼·JSON)을 유효 역량 키 배열로 정규화 — 알 수 없는 키 제거, 중복 제거,
 * NCS 표준 순서로 정렬. 배열이 아니면 빈 배열.
 */
export function sanitizeCompetencies(input: unknown): CompetencyKey[] {
  if (!Array.isArray(input)) return [];
  const picked = new Set<CompetencyKey>();
  for (const v of input) {
    if (typeof v === "string" && KEY_SET.has(v)) picked.add(v as CompetencyKey);
  }
  return NCS_COMPETENCY_KEYS.filter((k) => picked.has(k));
}

/** 키 배열 → 라벨 배열 (프롬프트 문장용) */
export function competencyLabels(keys: readonly CompetencyKey[]): string[] {
  return keys.map((k) => NCS_COMPETENCY_LABELS[k].label);
}
