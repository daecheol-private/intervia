/**
 * 제품 투어 데모 데이터 — 가상의 샘플 지원자(홍길동) 평가·면접 스냅샷.
 *
 * - 실존 후보자 DB row 가 아닌 *가상 데이터*다(공개 랜딩 데모 전용).
 * - "Java 백엔드 개발자" 공고에 지원한 경력 5년차 지원자를 가정한 단순 샘플.
 * - PII(이름·이메일·메타)는 더미, 평가·면접 내용도 모두 임의 작성.
 *
 * 공개 랜딩이 특정 후보 DB row 에 런타임 의존하지 않도록 상수로 고정한다.
 */
import type { Candidate } from "@/app/candidates/[id]/types";

export type Breakdown = NonNullable<
  NonNullable<Candidate["screeningReport"]>["breakdown"]
>;

// ── 가상 신원 (데모용 더미) ──────────────────────────────────────────
export const DEMO_NAME = "홍길동";
export const DEMO_ROLE = "Java 백엔드 개발자";
export const DEMO_EMAIL = "gildong.hong@example.com";
export const DEMO_META = "경력 5년 · 학사";

// ── 종합 평가 (가상 샘플) ────────────────────────────────────────────
export const DEMO_SCORE = 82;
export const DEMO_REC = "추천";
export const DEMO_SUMMARY =
  "Spring Boot 기반 백엔드 개발에 집중해 온 **5년차 Java 개발자**입니다. JD 핵심 요구(Java, Spring Boot, JPA, REST API, MySQL)를 **실무 경험으로 충실히 충족**하며, 주문·회원 도메인 API 개발과 쿼리 최적화 경험이 직무와 잘 맞습니다. 다만 대용량 트래픽·MSA 환경 경험은 제한적이어서 면접에서 **확장성 설계 역량**을 확인할 필요가 있습니다.";

export const DEMO_BREAKDOWN: Breakdown = {
  tech_fit: {
    score: 85,
    reason:
      "Java, Spring Boot, JPA, REST API, MySQL 등 JD 요구 기술 스택을 실무에서 직접 사용한 경험이 명확함.",
    confidence: "high",
  },
  experience_depth: {
    score: 80,
    reason:
      "5년간 일관되게 백엔드 개발에 종사하며 주문·회원 등 핵심 도메인 API 를 설계·개발한 경험을 보유함.",
    confidence: "high",
  },
  role_match: {
    score: 86,
    reason:
      "JD 주요 업무(REST API 개발, DB 설계·튜닝, 서비스 운영)와 후보자의 실제 경험이 정확히 일치함.",
    confidence: "high",
  },
  achievement: {
    score: 74,
    reason:
      "쿼리 최적화로 응답 속도를 개선한 사례가 있으나, 정량적 성과 지표가 다소 제한적으로 제시됨.",
    confidence: "medium",
  },
  stability: {
    score: 80,
    reason: "약 5년간 2개 회사에서 근무하며 평균 재직 기간이 안정적임.",
    confidence: "high",
  },
  growth_attitude: {
    score: 82,
    reason:
      "개인 사이드 프로젝트와 기술 블로그 운영 등 자기 주도적 학습 태도가 드러남.",
    confidence: "medium",
  },
};

export const DEMO_STRENGTHS = [
  "**Spring Boot 실무 역량**: Spring Boot·JPA 기반 REST API 개발 경험이 5년간 꾸준히 축적됨.",
  "**핵심 도메인 개발 경험**: 주문·회원 등 서비스 핵심 도메인의 API 를 직접 설계·개발함.",
  "**DB 최적화 경험**: MySQL 인덱스·쿼리 튜닝으로 조회 응답 속도를 개선한 경험 보유.",
  "**자기 주도 학습**: 사이드 프로젝트와 기술 블로그로 지속적으로 학습하는 태도.",
];

export const DEMO_CONCERNS = [
  "**대용량 트래픽 경험 제한**: MSA·대규모 트래픽 처리 경험이 적어 확장성 설계 역량 확인 필요.",
  "**리딩 경험 부족**: 프로젝트 주도·기술 의사결정 경험이 제한적 — 성장 잠재력 확인 필요.",
];

export const DEMO_KEYWORDS = [
  "Java",
  "Spring Boot",
  "JPA",
  "REST API",
  "MySQL",
  "백엔드",
  "JUnit",
  "Git",
];

// ── 면접 문제 생성 (가상 샘플 · 1차 대면용) ──────────────────────────
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
    "후보자는 JD 핵심 요구(Java·Spring Boot·REST API·MySQL)를 **5년 실무 경험으로 충실히 충족**합니다. 1차 면접에서는 이력서에 기재된 기술 경험의 **깊이를 구체적 사례로 검증**하고, 대용량 트래픽·확장성 설계 등 **상대적으로 약한 영역**의 잠재력을 확인합니다. 협업 방식과 성장 의지도 함께 살핍니다.",
  sections: [
    {
      title: "Java · Spring 기술 역량 심층 검증",
      focus:
        "이력서에 기재된 Spring Boot·JPA 기반 개발 경험의 **깊이와 이해도**를 구체적 사례로 확인합니다.",
      questions: [
        {
          question:
            "Spring Boot 로 REST API 를 개발하시면서 JPA 사용 중 **N+1 문제**나 성능 이슈를 겪은 경험이 있다면, 어떻게 진단하고 해결하셨는지 구체적으로 설명해 주십시오.",
          intent:
            "JPA/ORM 에 대한 실질적 이해도와 성능 문제 해결 능력을 평가합니다.",
          followups: [
            "지연 로딩과 즉시 로딩을 어떤 기준으로 선택하셨나요?",
            "조회 성능 개선을 위해 쿼리 자체를 튜닝한 경험이 있다면 설명해 주세요.",
          ],
          basis: "이력서: Spring Boot·JPA 기반 API 개발 / JD: REST API 개발",
        },
        {
          question:
            "MySQL 쿼리 최적화로 응답 속도를 개선하셨다고 하셨는데, **어떤 방식으로 병목을 찾아내고** 어떤 최적화를 적용하셨는지 사례를 들어 설명해 주십시오.",
          intent:
            "DB 설계·튜닝에 대한 실무 역량과 문제 접근 방식을 확인합니다.",
          followups: [
            "인덱스를 설계할 때 고려한 기준은 무엇이었나요?",
            "실행 계획(EXPLAIN)을 분석해 본 경험이 있다면 설명해 주세요.",
          ],
          basis: "이력서: MySQL 쿼리 최적화 / JD: DB 설계·튜닝",
        },
      ],
    },
    {
      title: "문제 해결 및 확장성 경험",
      focus:
        "JD 가 요구하는 **트래픽 처리·확장성** 측면에서 후보자의 경험 수준과 학습 잠재력을 파악합니다.",
      questions: [
        {
          question:
            "지금까지 다루신 서비스의 트래픽 규모는 어느 정도였고, **부하가 늘었을 때** 이를 어떻게 대응하거나 대비하셨는지 설명해 주십시오.",
          intent:
            "대용량 트래픽 대응 경험과 확장성에 대한 이해도를 확인합니다.",
          followups: [
            "캐시(예: Redis)나 비동기 처리를 도입한 경험이 있다면 설명해 주세요.",
            "만약 트래픽이 10배로 늘어난다면 어떤 부분부터 개선하시겠습니까?",
          ],
          basis: "서류평가 우려: 대용량 트래픽 경험 제한 / JD: 서비스 확장성",
        },
      ],
    },
    {
      title: "협업 방식 및 성장 잠재력",
      focus:
        "팀 내 **협업 방식과 코드 품질에 대한 태도**, 그리고 성장 의지를 확인합니다.",
      questions: [
        {
          question:
            "최근 진행하신 프로젝트에서 **코드 리뷰나 협업 과정**에서 의견이 충돌했던 경험이 있다면, 어떻게 조율하고 결론을 내리셨는지 설명해 주십시오.",
          intent:
            "협업 태도와 커뮤니케이션 능력, 코드 품질에 대한 기준을 평가합니다.",
          followups: [
            "테스트 코드(JUnit 등)를 작성하는 본인만의 기준이 있다면 무엇인가요?",
          ],
          basis: "면접 중점: 협업 방식·코드 품질에 대한 태도",
        },
      ],
    },
  ],
  redFlags: [
    "Spring/JPA 의 동작 원리에 대한 이해 없이 **프레임워크 사용법만 암기**한 수준에 머무를 경우",
    "트래픽·확장성 관련 질문에 **개념적 이해조차 부족**해 성장 잠재력이 낮다고 판단될 경우",
    "협업·코드 리뷰 과정에서 **소통이나 유연성 부족** 신호가 드러날 경우",
  ],
};

// ── AI 면접(심층면접) — mock 대화 (가상 샘플) ────────────────────────
export const DEMO_CHAT: { role: "ai" | "user"; text: string }[] = [
  {
    role: "ai",
    text: "Spring Boot 로 REST API 를 개발하실 때 JPA 의 N+1 문제를 겪어보신 적이 있나요? 어떻게 해결하셨는지 궁금합니다.",
  },
  {
    role: "user",
    text: "주문 목록 조회에서 N+1 이 발생했습니다. fetch join 과 @EntityGraph 를 적용하고, 필요한 경우 DTO 로 직접 조회해 쿼리 수를 줄였습니다.",
  },
  {
    role: "ai",
    text: "fetch join 을 쓰면 페이징 처리에 제약이 생길 수 있는데, 그 부분은 어떻게 다루셨나요?",
  },
  {
    role: "user",
    text: "컬렉션 fetch join 과 페이징이 충돌하는 경우에는 ID 만 먼저 페이징으로 조회한 뒤, 그 ID 들로 데이터를 다시 조회하는 방식으로 처리했습니다.",
  },
];

// ── 라이브 녹음 — mock 전사 + 추천 질문 (가상 샘플) ──────────────────
export const DEMO_LIVE: { role: "interviewer" | "candidate"; text: string }[] = [
  {
    role: "interviewer",
    text: "가장 기억에 남는 백엔드 프로젝트는 무엇이었나요?",
  },
  {
    role: "candidate",
    text: "회원·주문 도메인의 REST API 를 새로 설계한 프로젝트가 가장 기억에 남습니다.",
  },
  {
    role: "interviewer",
    text: "그 프로젝트에서 성능 측면으로 신경 쓴 부분이 있나요?",
  },
  {
    role: "candidate",
    text: "조회가 많은 API 라 인덱스를 정리하고, 자주 쓰는 결과는 캐시를 적용해 응답 속도를 개선했습니다.",
  },
];

export const DEMO_SUGGESTIONS = [
  "주문 API 설계 시 트랜잭션 경계는 어떻게 잡으셨나요?",
  "JPA N+1 문제를 실제로 어떻게 진단하고 해결하셨는지?",
  "트래픽이 급증할 때 가장 먼저 개선할 지점은 어디라고 보시나요?",
];
