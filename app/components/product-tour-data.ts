/**
 * 제품 투어 데모 데이터 — candidate 392(샘플)의 *실제* 평가·면접 문제를 박제(스냅샷).
 *
 * - PII(이름·이메일·전화·나이·사진)는 더미로 교체.
 * - 식별 가능한 구체 회사명(현대기아차·엑스퍼넷 등)은 일반화([대형 고객사]·저희 회사).
 * - 평가 점수·6축·강점/우려·키워드·면접 문항은 392 실제 그대로.
 *
 * 공개 랜딩이 특정 후보 DB row 에 런타임 의존하지 않도록 상수로 고정한다
 * (그 후보가 삭제·PII 정리되어도 랜딩은 안전).
 */
import type { Candidate } from "@/app/candidates/[id]/types";

export type Breakdown = NonNullable<
  NonNullable<Candidate["screeningReport"]>["breakdown"]
>;

// ── 더미 신원 (실제 강대철 → 가명·더미) ───────────────────────────────
export const DEMO_NAME = "정현우";
export const DEMO_ROLE = "SOAR · 보안 자동화 개발자";
export const DEMO_EMAIL = "hyunwoo.j@example.com";
export const DEMO_META = "경력 15년 · 학사";

// ── 종합 평가 (392 실제) ─────────────────────────────────────────────
export const DEMO_SCORE = 95;
export const DEMO_REC = "강력추천";
export const DEMO_SUMMARY =
  "15년 이상의 경력 중 최근 5년 이상 SOAR 시스템 구축·개발에 집중한 **최고 수준의 전문가**입니다. JD 의 핵심 요구(Python, SOAR Playbook/Connector 개발, API 통합, 성능 최적화)를 **정량적 성과**와 함께 완벽히 충족합니다. 다만 JD 요구(3~5년차) 대비 **과도한 경력**은 면접에서 지원 동기·기대 수준 확인이 필요합니다.";

export const DEMO_BREAKDOWN: Breakdown = {
  tech_fit: {
    score: 95,
    reason:
      "Python, 웹 개발, REST API, 자동화 스크립트, SOAR/SIEM, 네트워크, 보안 지식을 모두 직접적이고 광범위하게 다루었음.",
    confidence: "high",
  },
  experience_depth: {
    score: 95,
    reason:
      "15년 이상의 경력 중 최근 5년 이상 SOAR/보안 자동화에 집중했으며, 대규모 프로젝트 리딩 및 아키텍처 설계 경험이 풍부함.",
    confidence: "high",
  },
  role_match: {
    score: 95,
    reason:
      "Python 기반 Playbook/Workbook 개발, Connector 개발, API 통합, SOAR 성능 최적화·장애 대응 경험이 JD 주요 업무와 완벽히 일치함.",
    confidence: "high",
  },
  achievement: {
    score: 95,
    reason:
      '"4전 4승" PoC 수주, 이벤트 처리량 개선, 초기 대응 시간 75% 단축, SLA 20% 감소 등 정량적 성과가 명확하며 수상 경력도 있음.',
    confidence: "high",
  },
  stability: {
    score: 100,
    reason: "단일 회사에서 15년 9개월간 장기 근속하여 매우 높은 안정성을 보임.",
    confidence: "high",
  },
  growth_attitude: {
    score: 90,
    reason:
      "학부 시절부터 자기 주도 학습, 대학원 진학, 다양한 기술 스택(MDM, NFVO, SOAR)으로의 확장 및 리더십 경험을 통해 지속적인 성장을 보여줌.",
    confidence: "high",
  },
};

export const DEMO_STRENGTHS = [
  "**SOAR 시스템 구축·개발 전문성**: FortiSOAR/Splunk Phantom 마이그레이션, Playbook/Workbook/Connector 개발 경험이 매우 풍부함.",
  "**정량적 성과**: PoC 4전 4승, 이벤트 처리 성능 개선, 초기 대응 시간 75% 단축 등 명확한 성과 지표 보유.",
  "**Python 기반 자동화·웹 개발 역량**: Python, Django, REST API 를 활용한 자동화 스크립트·웹 시스템 개발 경험이 깊음.",
  "**장기 근속·폭넓은 경험**: 단일 회사 15년 이상 근속하며 보안·네트워크·시스템 통합 등 폭넓은 개발 경험을 보유.",
];

export const DEMO_CONCERNS = [
  "**과도한 경력(15년)**: JD 요구 연차(3~5년) 대비 높아 연봉 기대치 미스매치·조직 적응 우려 — 면접에서 확인 필요.",
  "**자기 인식 확인**: 자기소개서의 '정보 보안 능력이 부족하다'는 언급이 겸손함인지 특정 영역 자신감 부족인지 확인 필요.",
];

export const DEMO_KEYWORDS = [
  "Python",
  "SOAR",
  "Playbook",
  "Connector",
  "API",
  "보안솔루션",
  "REST API",
  "자동화",
];

// ── 면접 문제 생성 (392 1차 실제 · 회사명 일반화 · 발췌) ───────────────
export type DemoQuestion = {
  question: string;
  intent: string;
  followups: string[];
  basis: string;
};
export type DemoSection = {
  title: string;
  focus: string;
  questions: DemoQuestion[];
};

export const DEMO_QUESTIONS: {
  strategy: string;
  sections: DemoSection[];
  redFlags: string[];
} = {
  strategy:
    "후보자는 JD 핵심 요구를 **압도적으로 충족**하는 최고 수준의 전문가입니다. 1차 면접에서는 **연차 불일치**로 인한 지원 동기·기대 수준·조직 적응 우려를 최우선 해소하고, '보안 역량 부족' 언급의 진의를 파악합니다. 기술 역량은 이미 검증되었으므로 **가장 도전적인 문제 해결 과정**과 **주도적 역할**에 초점을 맞춥니다.",
  sections: [
    {
      title: "지원 동기 및 경력 미스매치 해소",
      focus:
        "JD 요구 연차 대비 **과도한 경력**의 지원자가 본 포지션에 지원한 동기와 기대 수준을 파악합니다.",
      questions: [
        {
          question:
            "15년 이상의 개발 경력, 특히 SOAR 분야에서 탁월한 성과를 보여주셨습니다. 본 직무는 3~5년차를 대상으로 하는데, 지원하시게 된 **구체적인 동기**가 궁금합니다.",
          intent:
            "진정한 지원 동기와 기대치를 파악해 연봉·역할·조직 적응 가능성을 가늠합니다.",
          followups: [
            "저희가 생각하는 3~5년차의 역할과 후보자님이 기대하는 역할 사이에 차이가 있다면 어떤 부분일까요?",
            "현재 경력 수준에서 저희 회사에 기대하는 성장 기회나 기여 방식은 무엇인가요?",
          ],
          basis: "서류평가 우려: JD 요구 연차(3~5년) 대비 과도한 경력(15년)",
        },
      ],
    },
    {
      title: "SOAR/Python 기술 역량 심층 검증",
      focus:
        "이력서에 명시된 SOAR·Python 개발 경험의 **깊이와 문제 해결 능력**을 구체적 사례로 확인합니다.",
      questions: [
        {
          question:
            "[대형 고객사] SOAR 구축 프로젝트에서 'Endpoint 이벤트 위주의 SOAR 신규 구축'을 진행하셨는데, **가장 기술적으로 도전적이었던 부분**은 무엇이었고 어떻게 해결하셨는지 구체적 사례를 들어 설명해 주십시오.",
          intent:
            "SOAR 구축 시 복잡한 기술 문제 해결 능력과 주도적 의사결정 과정을 평가합니다.",
          followups: [
            "Endpoint 이벤트 처리 시 발생할 수 있는 대용량 데이터·성능 이슈는 어떻게 고려·대응하셨나요?",
            "신규 구축 시 기존 시스템과의 연동은 어떻게 설계·구현하셨나요?",
          ],
          basis: "이력서: 대형 고객사 SOAR 구축 / 면접 중점: 도전적 기술 문제 해결",
        },
        {
          question:
            "180개 계열사, 일 10만 건 이상의 이벤트를 병합·중복제거해 티켓 처리 성능을 개선하셨습니다. **성능 최적화를 위해 적용한 구체적 기술 접근**과 그 효과를 설명해 주십시오.",
          intent:
            "SOAR 시스템 성능 최적화 역량과 대규모 데이터 처리 경험을 심층 확인합니다.",
          followups: [
            "이벤트 병합·중복제거 로직을 설계할 때 고려한 주요 사항은 무엇이었나요?",
            "성능 개선 전후의 지표 변화와, 그 과정에서 발생한 예상치 못한 문제·해결 방안은?",
          ],
          basis: "이력서: SOAR 마이그레이션(성능 개선) / JD: SOAR 시스템 성능 최적화",
        },
      ],
    },
    {
      title: "우려 사항 및 성장 잠재력",
      focus:
        "이력서의 '정보 보안 능력 부족' 언급의 **진의를 파악**하고 자기 인식·성장 목표를 확인합니다.",
      questions: [
        {
          question:
            "입사 후 포부에서 '정보 보안에 대한 능력과 경력이 부족하다'고 언급하셨습니다. 화려한 경력과 수상 이력을 보면 다소 의외인데, **어떤 맥락에서 이러한 생각**을 하시게 되었는지 구체적으로 설명해 주십시오.",
          intent:
            "자기 인식을 확인하고 겸손함인지 특정 보안 영역에 대한 자신감 부족인지 파악합니다.",
          followups: [
            "구체적으로 어떤 보안 영역에서 부족함을 느끼시고, 그 부분을 어떻게 보완해 나가고 싶으신가요?",
          ],
          basis: "서류평가 우려: '정보 보안 능력 부족' 언급",
        },
      ],
    },
  ],
  redFlags: [
    "JD 요구 연차 대비 과도한 경력으로 인한 **연봉 기대치 미스매치** 및 **조직 적응** 우려가 해소되지 않을 경우",
    "'정보 보안 능력이 부족하다'는 언급이 단순 겸손이 아닌 **특정 핵심 보안 영역 자신감 부족**으로 판단될 경우",
    "본 포지션의 역할·책임에 대한 **기대 수준이 회사와 현저히 다를 경우**(예: 시니어 리더 역할만 기대)",
  ],
};

// ── AI 면접(심층면접) — mock 대화 (392 직무 맥락, 내용은 임의) ─────────
export const DEMO_CHAT: { role: "ai" | "user"; text: string }[] = [
  {
    role: "ai",
    text: "대규모 SOAR 운영에서 이벤트 처리 병목을 겪으신 적이 있을 텐데, 어떻게 진단하고 해결하셨나요?",
  },
  {
    role: "user",
    text: "일 10만 건 규모에서 중복 이벤트가 병목이었습니다. 병합·중복제거 전처리 단계를 도입해 티켓 처리량을 크게 개선했습니다.",
  },
  {
    role: "ai",
    text: "중복제거 과정에서 서로 다른 이벤트가 잘못 병합될 위험은 어떻게 방지하셨나요?",
  },
  {
    role: "user",
    text: "이벤트 키를 다단계로 정의하고, 시간 윈도우와 출처를 함께 비교해 오병합을 막았습니다.",
  },
];

// ── 라이브 녹음 — mock 전사 + 추천 질문(392 실제 문항 일부) ────────────
export const DEMO_LIVE: { role: "interviewer" | "candidate"; text: string }[] = [
  {
    role: "interviewer",
    text: "가장 도전적이었던 SOAR 프로젝트는 무엇이었나요?",
  },
  {
    role: "candidate",
    text: "Endpoint 이벤트 위주의 SOAR 를 신규 구축한 프로젝트가 가장 기억에 남습니다.",
  },
  {
    role: "interviewer",
    text: "그때 대용량 이벤트 처리 성능은 어떻게 확보하셨나요?",
  },
  {
    role: "candidate",
    text: "이벤트를 병합·중복제거하는 전처리 단계를 두어 처리량을 끌어올렸습니다.",
  },
];

export const DEMO_SUGGESTIONS = [
  "180개 계열사 이벤트 병합 로직 설계 시 고려한 주요 사항은?",
  "PM 부재 상황에서 프로젝트를 어떻게 이끄셨는지 구체적으로?",
  "'정보 보안 능력이 부족하다'고 느낀 구체적 영역은?",
];
