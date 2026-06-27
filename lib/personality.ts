/**
 * 인성검사(컬처핏 사전 문항) — Big Five **강제선택형(forced-choice)** 문항 + 결정적 채점.
 *
 * 왜 리커트("매우 그렇다~아니다")가 아니라 강제선택인가:
 * 채용 장면의 리커트 자기보고는 "회사가 좋아할 답"이 투명하게 보여 전략적 위장에 취약하다.
 * 강제선택은 **둘 다 바람직해 보이는 진술 중 더 자신에 가까운 쪽**을 고르게 해
 * 정답 찍기를 어렵게 만든다 (상용 인적성의 위장 방지 방식과 동일 계열).
 *
 * 설계 원칙:
 * - 문항·채점은 전원 동일(공고 단위로만 세트가 달라짐) — 같은 공고 후보자 간 비교 가능성·공정성 방어.
 * - 채점은 LLM 이 아니라 이 모듈의 결정적 코드 — 같은 응답이면 항상 같은 프로필.
 * - 점수는 본인 내 상대 선호(ipsative)다. 합불 점수에 미반영 — 면접 꼬리질문 앵커 +
 *   리포트 참고 정보로만 사용 (무검증 성격검사의 자동 의사결정 반영은 법적 리스크).
 * - 같은 특성 쌍을 표현을 바꿔 2회 묻고(플립 검사) 좌우 위치를 균형 배치(위치 편향 감지)
 *   → 무성의·무작위 응답 변별. 진짜 변별은 면접 행동 검증이 담당한다.
 */

import type { Lang } from "./i18n/interview";

export type TraitKey =
  | "openness"
  | "conscientiousness"
  | "extraversion"
  | "agreeableness"
  | "emotionalStability";

export const TRAIT_KEYS: TraitKey[] = [
  "openness",
  "conscientiousness",
  "extraversion",
  "agreeableness",
  "emotionalStability",
];

export const TRAIT_LABELS: Record<TraitKey, string> = {
  openness: "개방성·도전",
  conscientiousness: "성실성·꼼꼼함",
  extraversion: "외향성·표현력",
  agreeableness: "우호성·협업",
  emotionalStability: "정서 안정성·회복탄력성",
};

export type TraitLevel = "high" | "medium" | "low";

/**
 * 공고가 설정하는 선호 특성 프로필 — high 특성은 검사에서 심화 문항이 추가되고
 * 면접에서 행동 사례로 검증된다 (점수 가중치가 아니라 검증 우선순위).
 */
export type TraitProfile = Record<TraitKey, TraitLevel>;

/** high(심화 검증) 특성 상한 — 전부 high 면 변별·면접 시간이 모두 무너진다 */
export const MAX_HIGH_TRAITS = 3;

export const DEFAULT_TRAIT_PROFILE: TraitProfile = {
  openness: "medium",
  conscientiousness: "medium",
  extraversion: "medium",
  agreeableness: "medium",
  emotionalStability: "medium",
};

/** 외부 입력을 TraitProfile 로 정규화 — 객체가 아니면 null, 이상값 레벨은 medium */
export function sanitizeTraitProfile(input: unknown): TraitProfile | null {
  if (!input || typeof input !== "object") return null;
  const out = {} as TraitProfile;
  for (const k of TRAIT_KEYS) {
    const v = (input as Record<string, unknown>)[k];
    out[k] = v === "high" || v === "medium" || v === "low" ? v : "medium";
  }
  return out;
}

export function highTraitCount(p: TraitProfile): number {
  return TRAIT_KEYS.filter((k) => p[k] === "high").length;
}

/**
 * 추천 특성 키 배열 → TraitProfile. 배열에 든 유효 키는 high(심화 검증), 나머지는 medium.
 * 앞쪽 우선으로 MAX_HIGH_TRAITS 개까지만 high 로 채우고, 알 수 없는 키는 무시한다.
 * URL 임포트의 직무 분석 추천을 폼 상태로 변환하는 데 사용.
 */
export function traitProfileFromKeys(keys: readonly string[]): TraitProfile {
  const out: TraitProfile = { ...DEFAULT_TRAIT_PROFILE };
  let n = 0;
  for (const k of keys) {
    if (n >= MAX_HIGH_TRAITS) break;
    if ((TRAIT_KEYS as string[]).includes(k) && out[k as TraitKey] !== "high") {
      out[k as TraitKey] = "high";
      n++;
    }
  }
  return out;
}

/** job_postings.trait_profile JSON 파싱 — null·손상 JSON 은 null (전 특성 medium 취급) */
export function parseTraitProfile(
  json: string | null | undefined
): TraitProfile | null {
  if (!json) return null;
  try {
    return sanitizeTraitProfile(JSON.parse(json));
  } catch {
    return null;
  }
}

/** 공고 API 입력 → 저장용 JSON. 형식 오류·high 초과는 error (공고 POST/PUT 공용 검증) */
export function traitProfileInputToJson(
  input: unknown
): { json: string | null; error: null } | { json: null; error: string } {
  if (input == null) return { json: null, error: null };
  const tp = sanitizeTraitProfile(input);
  if (!tp) return { json: null, error: "선호 특성 형식이 잘못되었습니다." };
  if (highTraitCount(tp) > MAX_HIGH_TRAITS)
    return {
      json: null,
      error: `높음(심화 검증) 특성은 최대 ${MAX_HIGH_TRAITS}개까지 지정할 수 있습니다.`,
    };
  return { json: JSON.stringify(tp), error: null };
}

/**
 * 특성별 긍정 진술 10개 — 전부 바람직하게 들리도록 작성 (부정·역채점 진술 없음:
 * 강제선택에서는 "덜 좋아 보이는 쪽"이 생기면 그쪽이 자동으로 기피되어 변별이 깨진다).
 * 인덱스 0~3: 1라운드(전체 10쌍) / 4~5: 2라운드(앞 N쌍만 재질문) /
 * 8: 심화 자기 진술 / 9: 심화 파트너 진술(자기 진술과 인덱스를 분리해야 high 특성이 인접해도 문장이 겹치지 않음). 6·7: 예비.
 */
const STATEMENTS_KO: Record<TraitKey, string[]> = {
  openness: [
    "익숙한 방법보다 새로운 방식을 먼저 시도해 본다",
    "처음 해 보는 일을 맡는 것이 즐겁다",
    "다양한 분야의 지식을 넓히는 데서 즐거움을 얻는다",
    "기존 프로세스라도 더 나은 방법이 보이면 바꿔 본다",
    "변화가 잦은 환경에서 오히려 활력을 느낀다",
    "새로운 도구와 기술을 먼저 도입해 보는 편이다",
    "남들이 가지 않은 방식에서 기회를 찾는다",
    "아이디어를 구상하는 단계에서 가장 몰입한다",
    "낯선 영역에 뛰어드는 것을 두려워하지 않는다",
    "더 나은 방법이 있다면 기꺼이 처음부터 다시 배운다",
  ],
  conscientiousness: [
    "일을 시작하면 끝까지 마무리한다",
    "계획을 세우고 그대로 실행하는 편이다",
    "세부 사항을 꼼꼼히 확인한다",
    "마감보다 먼저 끝나도록 일정을 관리한다",
    "스스로 세운 높은 기준을 지키려 노력한다",
    "실수를 줄이기 위해 한 번 더 검토한다",
    "맡은 일은 어떤 일이 있어도 끝맺는다",
    "반복적인 일도 일정한 품질로 해낸다",
    "작은 약속이라도 반드시 지킨다",
    "결과물의 완성도를 끝까지 끌어올린다",
  ],
  extraversion: [
    "처음 만나는 사람과도 쉽게 대화를 시작한다",
    "여러 사람과 함께 일할 때 에너지를 얻는다",
    "내 의견을 여러 사람 앞에서 말하는 것이 어렵지 않다",
    "회의에서 대화를 주도하는 편이다",
    "사람들을 연결하고 분위기를 이끄는 역할을 맡는다",
    "발표나 시연을 맡는 것이 부담스럽지 않다",
    "활발한 토론 속에서 생각이 정리된다",
    "새로운 사람들을 만나는 자리가 기대된다",
    "팀에 활기를 불어넣는 역할을 즐긴다",
    "처음 보는 자리에서도 먼저 말을 거는 편이다",
  ],
  agreeableness: [
    "동료가 어려움을 겪으면 먼저 도우려 한다",
    "상대방의 입장에서 생각해 보려고 노력한다",
    "의견이 다를 때도 상대의 관점을 존중한다",
    "팀의 성과를 위해 내 방식을 양보할 수 있다",
    "결정하기 전에 팀원들의 의견을 두루 듣는다",
    "갈등이 생기면 관계 회복을 먼저 챙긴다",
    "동료의 성장을 돕는 일에 보람을 느낀다",
    "공동의 목표를 개인 성과보다 앞에 둔다",
    "도움을 요청받기 전에 필요한 부분을 살핀다",
    "팀워크가 좋아야 좋은 결과가 나온다고 믿는다",
  ],
  emotionalStability: [
    "압박이 심한 상황에서도 평정심을 유지한다",
    "실패해도 비교적 빨리 회복하는 편이다",
    "비판을 받아도 감정적으로 크게 흔들리지 않는다",
    "예상 못 한 문제 앞에서 침착하게 대안을 찾는다",
    "스트레스 상황을 성장의 기회로 받아들인다",
    "급한 상황일수록 오히려 차분해진다",
    "감정보다 사실에 집중해 판단한다",
    "긴장되는 자리에서도 평소 실력을 낸다",
    "어려운 시기를 겪어도 의욕을 잃지 않는다",
    "결과가 나빠도 배울 점을 먼저 찾는다",
  ],
};

// STATEMENTS_KO 의 영어판 — 인덱스·특성·개수(10)가 완전히 동일해야 한다.
// 채점은 trait·문항 id 기반이라 텍스트만 다르고 점수에는 영향이 없다(영어 면접 지원자에게
// 같은 문항을 영어로 보여줄 뿐). 강제선택이므로 모든 진술은 긍정적으로 들리게 번역.
const STATEMENTS_EN: Record<TraitKey, string[]> = {
  openness: [
    "I try new approaches before falling back on familiar ones",
    "I enjoy taking on tasks I've never done before",
    "I find joy in broadening my knowledge across many fields",
    "When I see a better way, I'll change even an established process",
    "I feel energized in fast-changing environments",
    "I tend to adopt new tools and technologies early",
    "I look for opportunities in paths others haven't taken",
    "I'm most absorbed in the idea-shaping stage",
    "I'm not afraid to dive into unfamiliar territory",
    "If there's a better way, I'll gladly relearn it from scratch",
  ],
  conscientiousness: [
    "Once I start something, I see it through to the end",
    "I make a plan and follow it through",
    "I check the details carefully",
    "I manage my schedule to finish ahead of the deadline",
    "I strive to meet the high standards I set for myself",
    "I review once more to reduce mistakes",
    "I finish what I take on, no matter what",
    "I deliver consistent quality even on repetitive work",
    "I keep even the smallest promises",
    "I push the quality of my work all the way up",
  ],
  extraversion: [
    "I easily start a conversation with people I've just met",
    "I gain energy from working with many people",
    "I'm comfortable voicing my opinion in front of a group",
    "I tend to lead the conversation in meetings",
    "I take on the role of connecting people and setting the mood",
    "I don't find it burdensome to give presentations or demos",
    "My thoughts come together in lively discussion",
    "I look forward to occasions where I meet new people",
    "I enjoy being the one who energizes the team",
    "I tend to speak up first even in a room of strangers",
  ],
  agreeableness: [
    "When a colleague is struggling, I'm the first to offer help",
    "I make an effort to see things from the other person's point of view",
    "Even when we disagree, I respect the other person's perspective",
    "I can give up my own way for the team's success",
    "I hear out my teammates before making a decision",
    "When conflict arises, I tend to the relationship first",
    "I find it rewarding to help colleagues grow",
    "I put shared goals ahead of personal achievement",
    "I notice what's needed before being asked for help",
    "I believe good teamwork leads to good results",
  ],
  emotionalStability: [
    "I stay composed even under intense pressure",
    "I tend to bounce back fairly quickly after a failure",
    "Criticism doesn't shake me much emotionally",
    "I calmly look for alternatives when unexpected problems arise",
    "I take stressful situations as chances to grow",
    "The more urgent things get, the calmer I become",
    "I focus on facts rather than emotions when making judgments",
    "I perform at my usual level even in tense settings",
    "I keep my drive even through difficult times",
    "Even when the result is poor, I look for the lesson first",
  ],
};

const STATEMENTS_BY_LANG: Record<Lang, Record<TraitKey, string[]>> = {
  ko: STATEMENTS_KO,
  en: STATEMENTS_EN,
};

export type PersonalityItem = {
  id: string;
  /** 선택지 1 */
  a: { trait: TraitKey; text: string };
  /** 선택지 2 */
  b: { trait: TraitKey; text: string };
  /** base: 1라운드 / repeat: 같은 특성 쌍 재질문(플립 검사) / emphasis: 공고 high 특성 심화 */
  kind: "base" | "repeat" | "emphasis";
  /** 특성 쌍 식별자 (정렬 결합) — base↔repeat 플립 비교용 */
  pairingKey: string;
};

/** 후보자 화면·API 로 내보내는 형태 — 특성 태그는 절대 노출 금지 (정답 추론 차단) */
export type PublicPersonalityItem = { id: string; a: string; b: string };

// 10개 특성 쌍 — 인접 문항이 같은 특성을 공유하지 않도록 배열.
const PAIRINGS: Array<[TraitKey, TraitKey]> = [
  ["openness", "conscientiousness"],
  ["extraversion", "agreeableness"],
  ["openness", "emotionalStability"],
  ["conscientiousness", "extraversion"],
  ["agreeableness", "emotionalStability"],
  ["openness", "extraversion"],
  ["conscientiousness", "agreeableness"],
  ["extraversion", "emotionalStability"],
  ["openness", "agreeableness"],
  ["conscientiousness", "emotionalStability"],
];

function pairingKeyOf(x: TraitKey, y: TraitKey): string {
  return [x, y].sort().join("|");
}

/**
 * 2라운드(같은 특성쌍 재질문) 쌍 수 — 문항 길이 ↔ 무성의·무작위 응답 감지력의 트레이드오프.
 * 1라운드는 항상 10쌍 전부(전 특성 커버), 2라운드는 앞 N쌍만 재질문해 플립 검사에 쓴다.
 */
const REPEAT_PAIRINGS_COUNT = 5;

// 결정적 생성 — 라운드별로 좌우를 뒤집어 위치 편향을 상쇄.
// 진술 배정: 특성별 등장 순서대로 1라운드 0~, 2라운드 4~ 사용 (재사용 없음).
function buildBaseItems(lang: Lang): PersonalityItem[] {
  const S = STATEMENTS_BY_LANG[lang];
  const items: PersonalityItem[] = [];
  for (const round of [0, 1] as const) {
    const used: Record<TraitKey, number> = {
      openness: 0,
      conscientiousness: 0,
      extraversion: 0,
      agreeableness: 0,
      emotionalStability: 0,
    };
    const pairings =
      round === 0 ? PAIRINGS : PAIRINGS.slice(0, REPEAT_PAIRINGS_COUNT);
    pairings.forEach(([x, y], i) => {
      const sx = S[x][round * 4 + used[x]++];
      const sy = S[y][round * 4 + used[y]++];
      const first = round === 0 ? { trait: x, text: sx } : { trait: y, text: sy };
      const second = round === 0 ? { trait: y, text: sy } : { trait: x, text: sx };
      items.push({
        id: `${round === 0 ? "b" : "r"}${i + 1}`,
        a: first,
        b: second,
        kind: round === 0 ? "base" : "repeat",
        pairingKey: pairingKeyOf(x, y),
      });
    });
  }
  return items;
}

const BASE_ITEMS_KO = buildBaseItems("ko");
const BASE_ITEMS_EN = buildBaseItems("en");

/**
 * 공고 특성 프로필에 따른 출제 세트 — base(1라운드 10 + 2라운드 N)는 항상, high 특성당 심화 1쌍 추가.
 * 같은 프로필이면 항상 같은 세트·순서 (결정적). 총 문항 = (10 + REPEAT_PAIRINGS_COUNT) + high 수(0~3).
 */
export function buildItemSet(
  profile?: TraitProfile | null,
  lang: Lang = "ko"
): PersonalityItem[] {
  const p = profile ?? DEFAULT_TRAIT_PROFILE;
  const S = STATEMENTS_BY_LANG[lang];
  const items = [...(lang === "en" ? BASE_ITEMS_EN : BASE_ITEMS_KO)];
  for (const t of TRAIT_KEYS) {
    if (p[t] !== "high") continue;
    const idx = TRAIT_KEYS.indexOf(t);
    // 파트너는 순환상 다음 특성 — 결정적이고 특정 특성에 쏠리지 않음
    const partner = TRAIT_KEYS[(idx + 1) % TRAIT_KEYS.length];
    // 자기 진술은 8번, 파트너 진술은 9번 — 인덱스를 분리해야 파트너 특성도 high 라
    // 자기 심화에서 파트너[8]을 자기 진술로 다시 써(같은 문장 중복) 출제되는 일이 없다.
    // (각 특성은 정확히 한 번만 누군가의 파트너 → 파트너[9]끼리도 겹치지 않음)
    const self = { trait: t, text: S[t][8] };
    const other = { trait: partner, text: S[partner][9] };
    items.push({
      id: `em-${t}-1`,
      // high 특성이 한쪽에 고정되지 않도록 idx 짝/홀로 좌우 교차 (위치 균형)
      a: idx % 2 === 0 ? self : other,
      b: idx % 2 === 0 ? other : self,
      kind: "emphasis",
      pairingKey: pairingKeyOf(t, partner),
    });
  }
  return items;
}

export function toPublicItems(items: PersonalityItem[]): PublicPersonalityItem[] {
  return items.map(({ id, a, b }) => ({ id, a: a.text, b: b.text }));
}

/** value: 1 = 선택지 a, 2 = 선택지 b */
export type PersonalityResponse = { itemId: string; value: number };

export type PersonalityProfile = {
  version: 2;
  /**
   * 특성별 0~100 — 그 특성이 등장한 쌍에서 선택된 비율 (강제선택 기반 **상대 선호**.
   * 본인 내 상대 강도이지 절대 수준이 아님). answered = 등장 쌍 수.
   */
  traits: Record<TraitKey, { score: number; answered: number }>;
  flags: {
    /** 좌/우 한쪽 위치만 반복 선택 (≥90%) — 내용을 읽지 않은 무성의 신호 */
    straightLining: boolean;
    /** 같은 특성 쌍 재질문에서 선택이 6쌍 이상 뒤집힘 — 무작위 응답 신호 */
    inconsistent: boolean;
    /** 문항당 평균 2초 미만 응답 (진술 2개를 읽기에 비현실적) */
    rushed: boolean;
  };
  elapsedMs?: number;
  completedAt: string;
};

/** 응답 검증 — 출제 세트와 정확히 일치해야 함. 오류 메시지 반환, 정상이면 null */
export function validateResponses(
  items: PersonalityItem[],
  responses: PersonalityResponse[]
): string | null {
  const expected = new Set(items.map((i) => i.id));
  const seen = new Set<string>();
  for (const r of responses) {
    if (!expected.has(r.itemId)) return `알 수 없는 문항: ${r.itemId}`;
    if (seen.has(r.itemId)) return `중복 응답: ${r.itemId}`;
    if (r.value !== 1 && r.value !== 2) return `잘못된 응답 값: ${r.itemId}`;
    seen.add(r.itemId);
  }
  if (seen.size !== expected.size) return "모든 문항에 응답해야 합니다.";
  return null;
}

function chosenTraitOf(item: PersonalityItem, value: number): TraitKey {
  return value === 1 ? item.a.trait : item.b.trait;
}

export function scoreResponses(
  items: PersonalityItem[],
  responses: PersonalityResponse[],
  elapsedMs?: number
): PersonalityProfile {
  const byId = new Map(responses.map((r) => [r.itemId, r.value]));
  const counts = {} as Record<TraitKey, { chosen: number; appeared: number }>;
  for (const k of TRAIT_KEYS) counts[k] = { chosen: 0, appeared: 0 };

  let pos1 = 0;
  let answeredN = 0;
  for (const it of items) {
    const v = byId.get(it.id);
    if (v == null) continue;
    answeredN++;
    if (v === 1) pos1++;
    counts[it.a.trait].appeared++;
    counts[it.b.trait].appeared++;
    counts[chosenTraitOf(it, v)].chosen++;
  }

  const traits = {} as PersonalityProfile["traits"];
  for (const k of TRAIT_KEYS) {
    const { chosen, appeared } = counts[k];
    traits[k] = {
      score: appeared > 0 ? Math.round((chosen / appeared) * 100) : 0,
      answered: appeared,
    };
  }

  const straightLining =
    answeredN >= 10 && Math.max(pos1, answeredN - pos1) / answeredN >= 0.9;

  // 플립 검사 — 같은 특성 쌍의 base vs repeat 에서 선택 특성이 뒤집힌 비율.
  // 재질문 쌍의 60% 이상 뒤집히면 내용 기반 선택이 아니라는 신호 (재질문 수가 바뀌어도 비례 유지).
  let flips = 0;
  let repeatTotal = 0;
  const baseChoice = new Map<string, TraitKey>();
  for (const it of items) {
    if (it.kind !== "base") continue;
    const v = byId.get(it.id);
    if (v != null) baseChoice.set(it.pairingKey, chosenTraitOf(it, v));
  }
  for (const it of items) {
    if (it.kind !== "repeat") continue;
    const v = byId.get(it.id);
    const prev = baseChoice.get(it.pairingKey);
    if (v == null || !prev) continue;
    repeatTotal++;
    if (chosenTraitOf(it, v) !== prev) flips++;
  }
  // 재질문이 4쌍 미만이면 표본 부족 — 신호로 쓰지 않음
  const inconsistent = repeatTotal >= 4 && flips / repeatTotal >= 0.6;

  const rushed =
    elapsedMs != null && elapsedMs > 0 && elapsedMs < answeredN * 2000;

  return {
    version: 2,
    traits,
    flags: { straightLining, inconsistent, rushed },
    elapsedMs,
    completedAt: new Date().toISOString(),
  };
}

export function traitLevelOf(score: number): TraitLevel {
  return score >= 67 ? "high" : score >= 34 ? "medium" : "low";
}

/**
 * 행동 스타일(4분면) — Big Five 점수에서 **파생만** 하는 표시용 라벨. 저장·채점 영향 0.
 *
 * 왜 직접 만든 라벨인가: DISC/MBTI 는 등록상표·라이선스라 그 이름을 쓸 수 없다. 대신
 * DISC 를 아는 면접관이면 바로 읽히는 2축 4분면을 우리 어휘로 코인한다 (IP 안전).
 *
 * 두 축:
 * - 가로(주도성): 외향성 점수 — 낮음=신중/관망, 높음=적극/주도
 * - 세로(관계지향): 우호성 점수 — 낮음=과업중심, 높음=사람중심
 * 보조 태그: 나머지 3개 특성(성실성·개방성·정서안정성) 중 가장 높은 1개를 짧은 수식으로 덧붙인다.
 */
export type BehaviorStyleKey = "driver" | "connector" | "analyst" | "supporter";

export type BehaviorStyle = {
  key: BehaviorStyleKey;
  /** 4분면 라벨 (예: "목표·추진형") */
  label: string;
  /** 한 줄 요약 — 리포트 부제 */
  summary: string;
  /** 가로축 0~100 (외향성) — 사분면 맵의 점 위치 */
  assertiveness: number;
  /** 세로축 0~100 (우호성) — 사분면 맵의 점 위치 */
  peopleFocus: number;
  /** 보조 강점 태그 (예: "성실·꼼꼼") — 없으면 null */
  modifier: string | null;
};

const BEHAVIOR_STYLE_META: Record<
  BehaviorStyleKey,
  { label: string; summary: string }
> = {
  driver: {
    label: "목표·추진형",
    summary: "결과와 목표를 향해 빠르게 결정하고 주도적으로 밀어붙이는 스타일",
  },
  connector: {
    label: "관계·협력형",
    summary: "사람들과 활발히 교류하며 분위기를 이끌고 함께 일하는 스타일",
  },
  analyst: {
    label: "분석·신중형",
    summary: "신중하게 사실과 기준을 따져 정확하게 일을 처리하는 스타일",
  },
  supporter: {
    label: "안정·지원형",
    summary: "차분하게 팀을 받쳐주며 안정적으로 협력을 이어가는 스타일",
  },
};

/** 보조 강점 태그 — 성실성·개방성·정서안정성 중 최고 점수 특성을 짧은 수식으로 */
const MODIFIER_TAG: Partial<Record<TraitKey, string>> = {
  conscientiousness: "성실·꼼꼼",
  openness: "개방·도전",
  emotionalStability: "안정·회복탄력",
};

/**
 * 강제선택 프로필(traits 점수) → 행동 스타일. 점수가 비어있으면(미응답) null.
 * 경계(50)는 high 쪽으로 포함 — 적극/사람중심으로 본다.
 */
export function behaviorStyleOf(
  traits: Record<TraitKey, { score: number; answered: number }> | null | undefined
): BehaviorStyle | null {
  if (!traits) return null;
  const e = traits.extraversion;
  const a = traits.agreeableness;
  if (!e || !a || (e.answered === 0 && a.answered === 0)) return null;

  const assertiveness = e.score;
  const peopleFocus = a.score;
  const high = (s: number) => s >= 50;

  let key: BehaviorStyleKey;
  if (high(assertiveness)) key = high(peopleFocus) ? "connector" : "driver";
  else key = high(peopleFocus) ? "supporter" : "analyst";

  // 보조 태그: 성실성·개방성·정서안정성 중 최고점 (단, 50 미만이면 두드러진 강점 없음 → null)
  let modifier: string | null = null;
  let best = 49;
  for (const t of ["conscientiousness", "openness", "emotionalStability"] as const) {
    const s = traits[t]?.score ?? 0;
    if (s > best) {
      best = s;
      modifier = MODIFIER_TAG[t] ?? null;
    }
  }

  return {
    key,
    label: BEHAVIOR_STYLE_META[key].label,
    summary: BEHAVIOR_STYLE_META[key].summary,
    assertiveness,
    peopleFocus,
    modifier,
  };
}

export const TRAIT_LEVEL_LABELS: Record<TraitLevel, string> = {
  high: "높음",
  medium: "보통",
  low: "낮음",
};

/**
 * 면접 꼬리질문 앵커 — 공고가 중시하는(high) 특성에서 선택이 한쪽으로 뚜렷하게
 * 쏠린(≥75% 선택 또는 ≤25% 선택) 경우를 골라낸다. 최대 3개 — 면접 시간 잠식 방지.
 * (v1 리커트 응답 등 현재 문항 은행과 매칭되지 않는 응답이면 빈 배열 — 하위 호환)
 */
export type NotableResponse = {
  item: PersonalityItem;
  value: number;
  /** 앵커로 인용할 해당 특성 쪽 진술 텍스트 */
  statement: string;
  answerLabel: string;
  whyNotable: string;
};

export function notableResponses(
  items: PersonalityItem[],
  responses: PersonalityResponse[],
  traitProfile?: TraitProfile | null
): NotableResponse[] {
  const p = traitProfile ?? DEFAULT_TRAIT_PROFILE;
  const byId = new Map(responses.map((r) => [r.itemId, r.value]));
  const picked: NotableResponse[] = [];

  for (const t of TRAIT_KEYS) {
    if (picked.length >= 3) break;
    if (p[t] !== "high") continue;

    let chosen = 0;
    let appeared = 0;
    let chosenItem: { item: PersonalityItem; value: number } | null = null;
    let appearedItem: { item: PersonalityItem; value: number } | null = null;
    for (const it of items) {
      const v = byId.get(it.id);
      if (v == null) continue;
      if (it.a.trait !== t && it.b.trait !== t) continue;
      appeared++;
      if (!appearedItem) appearedItem = { item: it, value: v };
      if (chosenTraitOf(it, v) === t) {
        chosen++;
        if (!chosenItem) chosenItem = { item: it, value: v };
      }
    }
    if (appeared < 4) continue; // v1 응답 등 매칭 부족 — 앵커 생략
    const rate = chosen / appeared;
    if (rate >= 0.75 && chosenItem) {
      picked.push({
        item: chosenItem.item,
        value: chosenItem.value,
        statement:
          chosenItem.value === 1
            ? chosenItem.item.a.text
            : chosenItem.item.b.text,
        answerLabel: "일관되게 선택",
        whyNotable: `${TRAIT_LABELS[t]} 진술을 거의 항상 선택 — 뒷받침하는 실제 사례 확인`,
      });
    } else if (rate <= 0.25 && appearedItem) {
      picked.push({
        item: appearedItem.item,
        value: appearedItem.value,
        statement:
          appearedItem.item.a.trait === t
            ? appearedItem.item.a.text
            : appearedItem.item.b.text,
        answerLabel: "거의 선택하지 않음",
        whyNotable: `공고에서 중시하는 ${TRAIT_LABELS[t]} 진술을 다른 가치보다 후순위로 선택 — 맥락 확인`,
      });
    }
  }

  return picked.slice(0, 3);
}
