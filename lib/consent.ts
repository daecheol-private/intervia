/**
 * 후보자 동의 항목 정의 (PIPA 표준 템플릿 기반).
 *
 * 정책 변경 시 CONSENT_VERSION 을 올린 신규 면접 세션부터 새 동의 요구.
 * 기존 세션의 과거 동의 row 는 그대로 유효 (감사·증거).
 *
 * 참조 조항:
 *  - §15 개인정보 수집·이용 동의
 *  - §22 동의 받는 방법 (필수/선택 구분)
 *  - §26 처리위탁 (수탁자 공개)
 *  - §37의2 자동화 의사결정 거부권 (2024.3 시행)
 */
import { db } from "./db";
import { consentLogs } from "./schema";
import { eq, desc } from "drizzle-orm";

// 1.1.0 — Google 국외이전 단독 항목 분리, AI 거부권 영향 명시 (PIPA §28의8, §37의2)
// 1.2.0 — 마스킹 표현 절제, 식별가능정보 자동 마스킹 명시
// 1.3.0 — 서류평가는 Vertex AI 한국 리전(asia-northeast3) 처리로 §28의8 미적용. 국외이전은 면접 단계만 해당
// 1.4.0 — 모든 LLM 호출을 Vertex AI 서울 리전으로 통합 (flash). 국외이전 동의 항목 제거.
export const CONSENT_VERSION = "1.4.0-2026-05-26";

export type ConsentItem = {
  key: string;
  required: boolean;
  title: string;
  description: string;
  legalBasis: string; // 표시용
};

export const CONSENT_ITEMS: readonly ConsentItem[] = [
  {
    key: "collection_use",
    required: true,
    title: "개인정보 수집 · 이용 동의",
    description:
      "이름·이메일·전화·이력서 본문 및 면접 대화록을 수집·이용합니다. 목적: 채용 절차 수행 (서류 평가, 면접 진행, 합·불 결정). 거부 시 면접에 참여할 수 없습니다.",
    legalBasis: "PIPA §15",
  },
  {
    key: "ai_decision",
    required: true,
    title: "AI 자동화 의사결정 동의 및 거부권 고지",
    description:
      "이력서·면접 응답에 대해 AI (Google Gemini, Google Cloud 서울 리전 asia-northeast3 에서 처리) 가 점수 및 추천을 산출합니다. 최종 합·불 결정은 채용 담당자의 인간 검토를 거치며, 본인은 (1) AI 평가 결과에 대한 설명 요청 권리, (2) AI 평가에 대한 이의제기 권리(이의제기 채널 제공)를 가집니다. " +
      "AI 평가를 거부할 권리가 있으며, 거부 시 본 AI 면접 서비스 이용은 불가하나, 지원 법인의 일반 채용 절차(서면 이력서 + 사람 면접) 이용을 직접 법인에 요청할 수 있습니다.",
    legalBasis: "PIPA §37의2",
  },
  {
    key: "processors",
    required: true,
    title: "처리위탁 동의",
    description:
      "다음 업체에 처리위탁됩니다: Google Cloud Korea (AI 평가·면접, 서울 asia-northeast3), Vercel Inc. (호스팅·파일 저장, 미국), Turso (DB, 일본 도쿄), SMTP 메일 발송 업체(법인별 상이). " +
      "Vercel·Turso 로의 국외이전은 PIPA §28의8 에 따라 본 동의에 포함됩니다. 거부 시 면접 진행 불가. 각 수탁자와의 처리위탁계약(DPA) 사본은 처리방침 §5 에서 확인 가능합니다.",
    legalBasis: "PIPA §26, §28의8",
  },
  {
    key: "retention",
    required: true,
    title: "보유 및 이용기간 동의",
    description:
      "합·불 결정 시점에 원본 이력서 파일과 마스킹 텍스트는 즉시 폐기됩니다. 평가 결과(점수·추천)는 공고 종결 +14일 후 자동 삭제됩니다.",
    legalBasis: "PIPA §21, 채용절차법 §11",
  },
] as const;

export function validateConsents(
  consents: Record<string, unknown>
): { ok: true } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  for (const item of CONSENT_ITEMS) {
    if (!item.required) continue;
    if (consents[item.key] !== true) missing.push(item.key);
  }
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

/** 해당 세션에 현재 버전의 유효 동의가 있는지. */
export async function hasValidConsent(
  interviewSessionId: number
): Promise<boolean> {
  const [row] = await db
    .select({ version: consentLogs.consentVersion, consents: consentLogs.consents })
    .from(consentLogs)
    .where(eq(consentLogs.interviewSessionId, interviewSessionId))
    .orderBy(desc(consentLogs.id))
    .limit(1);
  if (!row) return false;
  if (row.version !== CONSENT_VERSION) return false;
  const v = validateConsents(row.consents);
  return v.ok;
}
