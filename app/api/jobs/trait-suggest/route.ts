/**
 * 공고 텍스트(직무·담당업무·자격요건·우대사항) → Big Five 선호 특성 프로필 LLM 제안.
 * 공고 등록/수정 폼에서 버튼으로 1회 호출 → 제안값을 확인·수정 후 저장하는 흐름.
 * 저장 전 폼에서도 쓸 수 있도록 공고 id 없이 텍스트를 직접 받는다.
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
  MAX_HIGH_TRAITS,
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
  // 공고 생성 권한과 동일 — 법인 소속이면 누구나 (system_admin 포함)
  if (me!.role !== "system_admin" && me!.orgId == null) {
    return new Response("법인이 지정되지 않은 계정입니다.", { status: 403 });
  }

  // LLM 비용 가드 — 공고 폼 버튼 1회성 호출 용도
  const limited = await rateLimit(
    req,
    "job-trait-suggest",
    { limit: 5, windowSec: 60 },
    me!.id
  );
  if (limited) return limited;

  const body = (await req.json()) as {
    position?: string;
    level?: string;
    responsibilities?: string;
    requirements?: string;
    idealProfile?: string;
  };
  const cut = (s: string | undefined, n: number) => (s ?? "").trim().slice(0, n);
  const position = cut(body.position, 200);
  const level = cut(body.level, 100);
  const responsibilities = cut(body.responsibilities, 2000);
  const requirements = cut(body.requirements, 2000);
  const idealProfile = cut(body.idealProfile, 1500);
  if (!responsibilities && !requirements) {
    return new Response("담당 업무 또는 자격 요건을 먼저 입력하세요.", {
      status: 400,
    });
  }

  const prompt = `너는 조직심리 전문가다. 채용 공고를 읽고, 이 직무의 면접에서
중점적으로 검증할 Big Five 성격 특성 수준을 제안하라.

## 공고
- 직무: ${position || "(미입력)"}${level ? ` / ${level}` : ""}
- 담당 업무:
"""
${responsibilities || "(미입력)"}
"""
- 자격 요건:
"""
${requirements || "(미입력)"}
"""
${idealProfile ? `- 우대사항·인재상:\n"""\n${idealProfile}\n"""` : ""}

## 특성 정의
${TRAIT_KEYS.map((k) => `- ${k} (${TRAIT_LABELS[k]})`).join("\n")}

## 판정 규칙
- high 는 "이 직무 수행에 명확히 중요해서 면접 시간을 들여 심화 검증할 가치가 있는" 특성만. 점수 가중치가 아니라 검증 우선순위다.
- high 는 최대 ${MAX_HIGH_TRAITS}개 — 모든 특성을 high 로 만들면 변별이 사라진다.
- 언급이 없거나 직무와 무관하면 medium. 직무 성격과 상충하면 low (예: 규정 준수가 핵심인 직무의 개방성·도전, 독립 연구 직무의 외향성).
- 각 특성의 reason 은 공고 문구를 근거로 1줄 (한국어).

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
    // 프롬프트 규칙 후검증 — LLM 이 상한을 어기면 초과분을 medium 으로 강등
    let highs = 0;
    for (const k of TRAIT_KEYS) {
      if (traitProfile[k] !== "high") continue;
      if (++highs > MAX_HIGH_TRAITS) traitProfile[k] = "medium";
    }
    return Response.json({ traitProfile, reasons });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(`특성 프로필 제안 실패: ${msg}`, { status: 502 });
  }
}
