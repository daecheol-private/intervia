/**
 * 인재상 텍스트 → Big Five 선호 특성 프로필 LLM 제안.
 * 설정 화면에서 관리자가 버튼으로 1회 호출 → 제안값을 확인·수정 후 저장하는 흐름.
 * (후보자 평가 경로에서 호출되지 않음 — 검사 채점은 결정적 코드)
 */
import { Type } from "@google/genai";
import { generateJSON } from "@/lib/gemini";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { rateLimit } from "@/lib/rate-limit";
import {
  TRAIT_KEYS,
  TRAIT_LABELS,
  type TraitProfile,
  type TraitLevel,
} from "@/lib/personality";

export const runtime = "nodejs";

const SUGGEST_SCHEMA = {
  type: Type.OBJECT,
  properties: Object.fromEntries(
    TRAIT_KEYS.map((k) => [
      k,
      {
        type: Type.OBJECT,
        properties: {
          level: { type: Type.STRING, enum: ["high", "medium", "low"] },
          reason: { type: Type.STRING },
        },
        required: ["level", "reason"],
        propertyOrdering: ["level", "reason"],
      },
    ])
  ),
  required: [...TRAIT_KEYS],
  propertyOrdering: [...TRAIT_KEYS],
};

type SuggestResult = Record<TraitKeyStr, { level: TraitLevel; reason: string }>;
type TraitKeyStr = (typeof TRAIT_KEYS)[number];

export async function POST(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role !== "org_admin" && me!.role !== "system_admin") {
    return new Response("Forbidden", { status: 403 });
  }

  // LLM 비용 가드 — 설정 화면 버튼 1회성 호출 용도
  const limited = await rateLimit(
    req,
    "culture-fit-trait-suggest",
    { limit: 5, windowSec: 60 },
    me!.id
  );
  if (limited) return limited;

  const { idealTalent } = (await req.json()) as { idealTalent?: string };
  if (!idealTalent?.trim()) {
    return new Response("인재상 텍스트를 먼저 입력하세요.", { status: 400 });
  }
  if (idealTalent.length > 2000) {
    return new Response("인재상 텍스트가 너무 깁니다 (2000자 이내).", {
      status: 413,
    });
  }

  const prompt = `너는 조직심리 전문가다. 한 기업이 작성한 선호 인재상 설명을 읽고,
그 기업이 중시하는 Big Five 성격 특성 수준을 제안하라.

## 인재상 설명
"""
${idealTalent.trim()}
"""

## 특성 정의
${TRAIT_KEYS.map((k) => `- ${k} (${TRAIT_LABELS[k]})`).join("\n")}

## 판정 규칙
- 인재상이 명확히 강조하는 특성만 high. 언급이 없거나 약하면 medium. 인재상과 상충하면 low.
- high 는 최대 3개 — 모든 특성을 high 로 만들면 변별이 사라진다.
- 각 특성의 reason 은 인재상 문구를 근거로 1줄 (한국어).

## 출력 (JSON 만)
{ ${TRAIT_KEYS.map((k) => `"${k}": {"level": "high|medium|low", "reason": "..."}`).join(", ")} }`;

  try {
    const result = await generateJSON<SuggestResult>(prompt, {
      task: "screening",
      responseSchema: SUGGEST_SCHEMA,
      temperature: 0,
    });

    const traitProfile = {} as TraitProfile;
    const reasons = {} as Record<TraitKeyStr, string>;
    for (const k of TRAIT_KEYS) {
      traitProfile[k] = result[k]?.level ?? "medium";
      reasons[k] = result[k]?.reason ?? "";
    }
    return Response.json({ traitProfile, reasons });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(`특성 프로필 제안 실패: ${msg}`, { status: 502 });
  }
}
