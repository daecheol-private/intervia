/**
 * 법인 컬처핏 프로필의 기본값 — 단일 출처.
 *
 * 신규 법인 가입 시(`app/api/orgs`) 이 값을 organizations.cultureFitProfile 에 자동 저장한다.
 * 그러면 법인이 설정 화면에서 아무것도 저장하지 않아도 AI 면접 인성검사가 기본 특성(전 특성
 * medium)으로 출제되고, 정성 평가 항목·핵심 역량도 기본값으로 반영된다.
 * (인성검사 출제 게이트는 organizations.cultureFitProfile 존재 여부 — GET interview 라우트.)
 *
 * org 설정 화면(client)은 이 값으로 폼을 초기화하고, 법인이 수정·저장하면 덮어쓴다.
 * 순수 데이터 함수(서버·클라 공용) — CultureFitProfile 은 type-only import 라 이 모듈을
 * import 해도 prompts.ts 런타임이 클라이언트 번들에 딸려오지 않는다.
 *
 * traitProfile 은 의도적으로 넣지 않는다 — 2026-06 부터 성향(Big Five)은 공고 단위
 * (job_postings.trait_profile)로 관리하며, 법인 JSON 의 이 필드는 레거시다.
 */
import type { CultureFitProfile, QualItem } from "./prompts";

function qualItem(
  enabled: boolean,
  weight: QualItem["weight"],
  guide: string
): QualItem {
  return { enabled, weight, guide };
}

export function defaultCultureFitProfile(): CultureFitProfile {
  return {
    idealTalent:
      "자기주도적으로 문제를 정의하고 실행까지 책임지며, 동료와 협력해 함께 성장하는 인재",
    qualitativeItems: {
      selfIntro: qualItem(
        true,
        "medium",
        "핵심 경험이 직무와 연결되는지, 구체적인 사례 중심으로 서술했는지"
      ),
      motivation: qualItem(
        true,
        "high",
        "회사·직무에 대한 이해도와 지원 이유의 진정성·구체성"
      ),
      interpersonal: qualItem(
        true,
        "medium",
        "협업·갈등 상황에서의 소통 방식과 해결 경험"
      ),
      strengthWeakness: qualItem(
        true,
        "medium",
        "단점을 스스로 인지하고 보완하려는 노력이 있는지"
      ),
      lifeExperience: qualItem(
        false,
        "medium",
        "성실함과 꾸준함을 보여주는 경험이 있는지"
      ),
      futureAmbition: qualItem(
        true,
        "medium",
        "포부가 직무·회사 방향과 맞고 실현 가능한 계획인지"
      ),
    },
    coreCompetencies: ["communication", "problemSolving", "interpersonal"],
  };
}
