/**
 * 법인 중복 등록 탐지 — 비로그인. 가입 "신규 법인 등록" 제출 직전 1회 호출.
 *
 * 2단계 매칭:
 *   1) 결정적: 입력 법인명 정규화 매칭 + 사업자번호 일치 + (DART 등재 시) 사업자번호의
 *      공식 법인명을 역조회해 기존 법인명과 정규화 매칭. 싸고 정확.
 *   2) LLM(flash, 서울): 결정적으로 못 잡는 교차표기(한글 "포티넷" ↔ 영문 "fortinet"),
 *      음차·약칭·지사 표기 차이를 기존 법인 목록과 대조. 실패 시 graceful(결정적 결과만).
 *
 * 결과는 **비차단 제안** — 최종 합류/신규등록 선택은 사용자. 응답의 사업자번호는 마스킹.
 * 인증 전 노출 범위는 기존 /api/orgs/search 와 동일(법인명 존재). rate-limit 으로 정찰 차단.
 */
import { db } from "@/lib/db";
import { organizations } from "@/lib/schema";
import { sql } from "drizzle-orm";
import { rateLimit } from "@/lib/rate-limit";
import { maskBizNo } from "@/lib/email-domain";
import { normalizeBizNo } from "@/lib/business-registry";
import { findDartCorpByBizno } from "@/lib/dart-corps";
import { generateJSON } from "@/lib/gemini";
import { log } from "@/lib/logger";

export const runtime = "nodejs";
// 가입 시 법인 매칭에 LLM(generateJSON) 동기 호출 — 기본 타임아웃(~15s)에서 잘리지 않게 한도 확보.
export const maxDuration = 120;

// /api/orgs/search 와 동일 규칙 — 표기 변동(공백·(주)·법인형태)에 강건.
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[().,'"`·\-_/\\]/g, "")
    .replace(/㈜/g, "")
    .replace(/주식회사|유한회사|유한책임회사|재단법인|사단법인/g, "")
    .replace(/inc\.?$/i, "")
    .replace(/co\.?,?\s*ltd\.?$/i, "")
    .replace(/corp\.?$/i, "")
    .replace(/ltd\.?$/i, "");
}

const LLM_CANDIDATE_CAP = 100; // LLM 프롬프트에 보낼 후보 상한 (법인 수 증가 시 사전필터 필요)

export async function POST(req: Request) {
  const limited = await rateLimit(req, "org-match", { limit: 10, windowSec: 60 });
  if (limited) return limited;

  const { orgName, bizNo } = (await req.json().catch(() => ({}))) as {
    orgName?: string;
    bizNo?: string;
  };
  const name = (orgName ?? "").trim();
  if (name.length < 2) return Response.json({ matches: [] });

  const all = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      bizRegistrationNo: organizations.bizRegistrationNo,
      emailDomain: organizations.emailDomain,
    })
    .from(organizations)
    .where(
      sql`${organizations.name} IS NOT NULL AND ${organizations.verificationStatus} != 'rejected'`
    )
    .limit(500);
  if (all.length === 0) return Response.json({ matches: [] });

  const normName = normalize(name);
  const normBiz = bizNo ? normalizeBizNo(bizNo) : null;

  // 사업자번호의 공식 법인명(DART 등재 시) — "fortinet"+번호 → "포티넷코리아" 역조회로 한글 기존 법인 매칭
  const dart = normBiz ? findDartCorpByBizno(normBiz) : null;
  const dartNorms = [dart?.name, dart?.eng]
    .filter((s): s is string => !!s)
    .map(normalize)
    .filter((s) => s.length >= 2);

  // ── 결정적 매칭 ────────────────────────────────────────────
  const reasons = new Map<number, string>();
  const add = (id: number, reason: string) => {
    if (!reasons.has(id)) reasons.set(id, reason);
  };
  for (const o of all) {
    const nn = normalize(o.name);
    if (
      normBiz &&
      o.bizRegistrationNo &&
      o.bizRegistrationNo.replace(/\D/g, "") === normBiz
    ) {
      add(o.id, "사업자번호 일치");
      continue;
    }
    if (nn === normName) add(o.id, "법인명 일치");
    else if (nn.includes(normName) || (normName.length >= 2 && normName.includes(nn) && nn.length >= 2))
      add(o.id, "법인명 유사");
    else if (dartNorms.some((d) => nn.includes(d) || d.includes(nn)) && nn.length >= 2)
      add(o.id, "사업자번호 공식 법인명과 유사");
  }

  // ── LLM 매칭 (교차표기·음차) — 실패는 무시(graceful) ────────
  if (process.env.GOOGLE_CLOUD_PROJECT) {
    try {
      const candidates = all
        .slice(0, LLM_CANDIDATE_CAP)
        .map((o) => ({ id: o.id, name: o.name }));
      const prompt = [
        "당신은 한국 채용 플랫폼의 법인 중복 등록 판별기입니다.",
        `사용자가 등록하려는 법인명: "${name}"`,
        dart ? `해당 사업자번호의 공식 법인명: "${dart.name}"${dart.eng ? ` (영문: ${dart.eng})` : ""}` : "",
        "",
        "아래 '기존 법인 목록' 중 위 회사와 **동일한 법인으로 강하게 추정**되는 것을 고르세요.",
        "판단 기준: 한글↔영문 표기(예: 포티넷 ↔ Fortinet), 음차, 약칭, 'OO코리아'·지사 표기 차이, 사업자번호 공식명과의 일치.",
        "확실하지 않으면 포함하지 마세요(거짓 양성 최소화).",
        "",
        "기존 법인 목록(JSON):",
        JSON.stringify(candidates),
      ]
        .filter(Boolean)
        .join("\n");

      const res = await generateJSON<{
        matches?: Array<{ id?: number; confidence?: string; reason?: string }>;
      }>(prompt, {
        task: "orgMatch",
        temperature: 0,
        // 법인명만 투입 (개인정보 없음) — 서울 장애 시 도쿄 폴백 허용
        allowFallback: true,
        responseSchema: {
          type: "object",
          properties: {
            matches: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "integer" },
                  confidence: { type: "string", enum: ["high", "medium", "low"] },
                  reason: { type: "string" },
                },
                required: ["id", "confidence"],
              },
            },
          },
          required: ["matches"],
        },
      });

      const validIds = new Set(all.map((o) => o.id));
      for (const m of res.matches ?? []) {
        if (
          typeof m.id === "number" &&
          validIds.has(m.id) &&
          (m.confidence === "high" || m.confidence === "medium")
        ) {
          add(m.id, m.reason ? `AI 추정: ${m.reason}` : "AI 유사 법인 추정");
        }
      }
    } catch (e) {
      log.warn("org-match.llm_failed", {
        error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200),
      });
      // 결정적 결과만으로 진행 — LLM 장애가 가입을 막지 않음.
    }
  }

  const byId = new Map(all.map((o) => [o.id, o]));
  const matches = [...reasons.entries()]
    .map(([id, reason]) => {
      const o = byId.get(id)!;
      return {
        id: o.id,
        name: o.name,
        bizRegistrationNo: maskBizNo(o.bizRegistrationNo),
        emailDomain: o.emailDomain,
        reason,
      };
    })
    .slice(0, 8);

  return Response.json({ matches });
}
