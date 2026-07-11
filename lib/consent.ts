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
import { eq, desc, and } from "drizzle-orm";
import type { Lang } from "./i18n/interview";

// 1.1.0 — Google 국외이전 단독 항목 분리, AI 거부권 영향 명시 (PIPA §28의8, §37의2)
// 1.2.0 — 마스킹 표현 절제, 식별가능정보 자동 마스킹 명시
// 1.3.0 — 서류평가는 Vertex AI 한국 리전(asia-northeast3) 처리로 §28의8 미적용. 국외이전은 면접 단계만 해당
// 1.4.0 — 모든 LLM 호출을 Vertex AI 서울 리전으로 통합 (flash). 국외이전 동의 항목 제거.
// 1.5.0 — 면접 무결성 행태정보(붙여넣기·타이핑·화면이탈·복사시도) 수집 동의 항목 신설 + collection_use 에 나이·학력 명시 (PIPA §15)
// 1.6.0 — 시스템 기본 메일 발송 수탁자 Resend Inc.(미국) 명시. 메일 단계 국외이전(§28의8) 을 처리위탁 동의에 반영.
// 1.7.0 — 동의 과잉(동의 만능주의) 정리: 필수 동의 5→2개. retention·interview_integrity 를 collection_use 로 흡수,
//         ai_decision(§37의2)·processors(§26) 는 '동의→고지(notice)' 로 전환. 근거:
//          · §26 위탁은 동의가 아니라 처리방침 공개 의무(이미 §5 공개됨) → 고지로 충분.
//          · §37의2 는 동의가 아니라 고지+권리보장 의무. 최종 결정은 사람이 하므로 '완전 자동화 결정'도 아님 → 고지로 충분.
//          · 보유기간은 §15 동의의 고지 항목, 무결성 행태정보는 같은 §15 수집 → collection_use 에 통합.
//         §28의8 국외이전만 보수적으로 동의 유지(belt-and-suspenders). 1차 동의는 고객사가 업로드 전 취득(약관 §5, 동의문구 템플릿).
// 1.8.0 — 합격자 보유 예외(채용기업 삭제 시까지) 명시 + 부정행위 방지 행태정보를 별도 단락으로 시각 분리(§22① 각 동의사항 인지)
//         + 문체 분석(외부 AI 대필 가능성 추정) 참고자료 산출 고지 추가.
// 1.9.0 — AI 처리 장애 폴백 국외이전 신설: 서울 리전 장애 시에 한해 마스킹 텍스트만 Google Cloud
//         도쿄(일본) 리전에서 임시 처리될 수 있음을 cross_border 에 병합(§28의8① 1호 동의 유지 +
//         처리방침 §5 고지 병행). 스캔 원본(OCR)·음성은 폴백 제외(항상 국내) 명시.
//         마스킹 텍스트 기능의 실제 폴백 발동은 세션 동의 버전 ≥1.9.0 게이트와 함께만 (COMPLIANCE_SOP §4).
export const CONSENT_VERSION = "1.9.0-2026-07-11";

export type ConsentItem = {
  key: string;
  // consent = 체크 동의(필수/선택), notice = 고지(체크 불요, 제시·확인만)
  kind: "consent" | "notice";
  required: boolean; // consent 에만 의미. notice 는 항상 false.
  title: string;
  // 동의 항목 접힘 시 노출할 한 줄 핵심 (PIPA 시행령 §17 '중요한 내용' 압축: 수집항목·목적·보유·거부 불이익).
  // 고지 항목은 접힘 시 제목만 노출하므로 미사용. description 은 '자세히 보기' 펼침 전문.
  summary: string;
  description: string; // '자세히 보기' 펼침 시 전문 (부연·상세 포함)
  legalBasis: string; // 표시용
};

export const CONSENT_ITEMS: readonly ConsentItem[] = [
  {
    key: "collection_use",
    kind: "consent",
    required: true,
    title: "개인정보 수집 · 이용 동의",
    summary:
      "수집: 이름·연락처·나이·학력·이력서·면접 대화록 · 목적: 채용 절차(서류·면접·합·불) · " +
      "보유: 합·불 결정 후 단계적 폐기 · 거부 시 면접 불가",
    description:
      "수집 항목: 이름·이메일·전화·나이·학력(수준·전공·학교)·이력서 본문·면접 대화록. " +
      "이용 목적: 채용 절차 수행(서류 평가·면접 진행·합·불 결정). " +
      "보유·이용기간: 원본 이력서 파일·마스킹 텍스트는 합·불 결정 시점 즉시 폐기하고, 평가 결과(점수·추천)는 공고 종결 +14일 후 자동 삭제합니다(채용절차법 §11 준수). " +
      "단, 최종 합격자의 정보는 입사 절차 및 인사기록 목적으로 채용기업이 삭제할 때까지 보유됩니다. 거부 시 면접에 참여할 수 없습니다.\n\n" +
      "[부정행위 방지를 위한 행태정보] 면접 공정성 확인을 위해 답변 입력 행태정보(붙여넣기·타이핑 분량, 응답까지 걸린 시간, 화면 이탈·질문 복사 시도 횟수)를 수집하여 외부 도구를 이용한 대리 작성 등 부정행위 방지에 이용합니다. 행태정보는 채용 담당자의 참고 자료로만 제공되며 단독으로 합·불을 결정하지 않습니다. " +
      "행태정보와 별개로, 면접 답변의 문체적 특징에 대한 AI 분석(외부 AI 대필 가능성 추정)이 참고 자료로 산출됩니다. 이 분석은 단독으로 합격·불합격을 결정하지 않습니다.",
    legalBasis: "PIPA §15·§21",
  },
  {
    key: "cross_border",
    kind: "consent",
    required: true,
    title: "개인정보 국외이전 동의",
    summary:
      "국외 이전: Vercel(미국)·Turso(일본)·Resend(미국) · " +
      "AI 평가·면접은 국내(서울) 처리 원칙, 국내 장애 시에만 마스킹된 텍스트가 일본(도쿄)에서 임시 처리될 수 있음 · 거부 시 면접 불가",
    description:
      "서비스 운영을 위해 위 개인정보가 다음과 같이 국외로 이전됩니다. 이전받는 자·국가·목적: Vercel Inc.(미국, 호스팅·이력서 파일 저장), Turso(일본 도쿄, 데이터베이스), Resend(미국, 시스템 기본 메일 발송 — 법인이 자체 SMTP 를 등록한 경우 해당 서버). " +
      "이전 항목: 위 수집 항목 및 면접 대화록. 이전 시기·방법: 서비스 이용 전 과정에서 HTTPS 로 전송·저장. 보유기간: 위 수집·이용 동의와 동일. " +
      "AI 평가·면접은 Google Cloud 서울 리전(asia-northeast3)에서 처리하는 것을 원칙으로 합니다. 다만 서울 리전 장애(일시적 처리 불가) 시에 한해, 식별 가능한 정보를 자동 마스킹 처리한 이력서 텍스트·면접 대화록이 Google LLC 의 일본 도쿄 리전(asia-northeast1)으로 이전되어 임시 처리될 수 있습니다(TLS 암호화 API 전송, 응답 처리 즉시 폐기, AI 학습 미사용, 문의: https://policies.google.com/privacy). 스캔 이력서 원본·음성 데이터는 이 임시 처리 대상이 아니며 항상 국내에서만 처리됩니다. 거부 시 면접 진행이 불가합니다.",
    legalBasis: "PIPA §28의8",
  },
  {
    key: "ai_decision",
    kind: "notice",
    required: false,
    title: "AI 자동화 평가 안내 및 권리 고지",
    summary:
      "AI가 점수·추천을 산출하지만 최종 합·불 결정은 채용 담당자(사람)가 합니다. " +
      "본인은 평가 결과 설명 요청·이의제기·AI 평가 거부 후 일반 채용 절차 요청 권리를 가집니다.",
    description:
      "이력서·면접 응답에 대해 AI(Google Gemini, Google Cloud 서울 리전 — 장애 시 일본 도쿄 리전 임시 처리)가 점수·추천을 산출하나, 최종 합·불 결정은 채용 담당자의 인간 검토로 이루어지며 AI 단독으로 결정하지 않습니다. " +
      "본인은 (1) AI 평가 결과에 대한 설명 요청, (2) 이의제기(채널 제공), (3) AI 평가 거부 후 지원 법인의 일반 채용 절차(서면 이력서 + 사람 면접) 요청 권리를 가집니다.",
    legalBasis: "PIPA §37의2",
  },
  {
    key: "processors",
    kind: "notice",
    required: false,
    title: "처리위탁 수탁자 안내",
    summary:
      "Google Cloud Korea·Vercel·Turso·Resend 에 개인정보 처리를 위탁합니다. " +
      "수탁자·위탁업무·국가·보유기간 전체는 개인정보 처리방침 §5 에서 확인하실 수 있습니다.",
    description:
      "원활한 서비스 제공을 위해 Google Cloud Korea(AI 평가·면접, 서울 asia-northeast3 — 장애 시 일본 도쿄 임시 처리)·Vercel(호스팅·파일 저장)·Turso(DB)·Resend(메일 발송)에 개인정보 처리를 위탁합니다. 수탁자·위탁업무·국가·보유기간 전체와 처리위탁계약(DPA) 안내는 개인정보 처리방침 §5 에서 확인하실 수 있습니다.",
    legalBasis: "PIPA §26",
  },
] as const;

/**
 * 영어 동의문 — 위 CONSENT_ITEMS(한국어, 법적 정본) 1.8.0 내용의 기능적 번역.
 * 외국인 지원자가 영어 면접을 선택했을 때 표시한다. 법적 효력은 한국어판이 가지며
 * (정본 고지는 동의 화면 상단에 별도 노출), 정식 영문 법무 검토는 운영 배포 전 별도로 진행한다.
 * key·legalBasis·kind·required·CONSENT_VERSION 은 언어와 무관하게 동일(번역만 추가).
 */
const CONSENT_TEXT_EN: Record<
  string,
  { title: string; summary: string; description: string }
> = {
  collection_use: {
    title: "Consent to Collection and Use of Personal Information",
    summary:
      "Collected: name·contact·age·education·resume·interview transcript · " +
      "Purpose: hiring process (screening·interview·decision) · " +
      "Retention: phased deletion after the decision · Refusal: interview unavailable",
    description:
      "Items collected: name·email·phone·age·education (level·major·school)·resume text·interview transcript. " +
      "Purpose of use: conducting the hiring process (document screening·interview·hire/reject decision). " +
      "Retention period: the original resume file and masked text are deleted immediately upon the hire/reject decision, and evaluation results (scores·recommendation) are automatically deleted 14 days after the job posting closes (in compliance with the Fair Hiring Procedure Act §11). " +
      "However, a final successful candidate's information is retained until the hiring company deletes it, for onboarding and HR-record purposes. If you refuse, you cannot take part in the interview.\n\n" +
      "[Behavioral data for fraud prevention] To verify interview fairness, behavioral data on answer input (paste/typing volume, response time, screen-leaving and question-copy attempts) is collected and used to prevent fraud such as proxy answering with external tools. This behavioral data is provided only as reference for the recruiter and does not by itself determine hire/reject. " +
      "Separately, an AI analysis of the writing style of your answers (estimating the possibility of external AI ghostwriting) is produced as reference material. This analysis does not by itself determine hire/reject.",
  },
  cross_border: {
    title: "Consent to Overseas Transfer of Personal Information",
    summary:
      "Overseas transfer: Vercel (USA)·Turso (Japan)·Resend (USA) · " +
      "AI evaluation·interview processed in Korea (Seoul) in principle; only during a Korea-region outage, masked text may be temporarily processed in Japan (Tokyo) · Refusal: interview unavailable",
    description:
      "To operate the service, the above personal information is transferred overseas as follows. Recipient·country·purpose: Vercel Inc. (USA — hosting·resume file storage), Turso (Tokyo, Japan — database), Resend (USA — default system email delivery; the company's own SMTP server is used instead if registered). " +
      "Items transferred: the items collected above and the interview transcript. Timing·method: transmitted and stored over HTTPS throughout service use. Retention period: same as the collection·use consent above. " +
      "AI evaluation·interview is processed in the Google Cloud Seoul region (asia-northeast3) in principle. Only during a Seoul-region outage, resume text and interview transcripts with identifiable information automatically masked may be transferred to and temporarily processed in Google LLC's Tokyo region (asia-northeast1) (TLS-encrypted API transmission, discarded immediately after the response, not used for AI training; contact: https://policies.google.com/privacy). Scanned resume originals and voice data are excluded from this temporary processing and are always processed within Korea. If you refuse, the interview cannot proceed.",
  },
  ai_decision: {
    title: "Notice on Automated AI Evaluation and Your Rights",
    summary:
      "AI produces scores·recommendations, but the final hire/reject decision is made by a human recruiter. " +
      "You have the right to request an explanation of the result, to raise an objection, and to refuse AI evaluation and request a standard hiring process.",
    description:
      "For your resume and interview answers, AI (Google Gemini, Google Cloud Seoul region — temporarily processed in the Tokyo region, Japan, during a Seoul-region outage) produces scores·recommendations, but the final hire/reject decision is made through human review by the recruiter — AI does not decide alone. " +
      "You have the right to (1) request an explanation of the AI evaluation result, (2) raise an objection (a channel is provided), and (3) refuse AI evaluation and request the applying company's standard hiring process (paper resume + human interview).",
  },
  processors: {
    title: "Notice on Entrusted Processors",
    summary:
      "Personal information processing is entrusted to Google Cloud Korea·Vercel·Turso·Resend. " +
      "The full list of processors·tasks·countries·retention is available in §5 of the Privacy Policy.",
    description:
      "For smooth service provision, personal information processing is entrusted to Google Cloud Korea (AI evaluation·interview, Seoul asia-northeast3 — Tokyo, Japan fallback during an outage)·Vercel (hosting·file storage)·Turso (database)·Resend (email delivery). " +
      "The full list of processors·entrusted tasks·countries·retention and the data processing agreement (DPA) details are available in §5 of the Privacy Policy.",
  },
};

/**
 * 선택 언어의 동의 항목 목록. ko 는 원본(CONSENT_ITEMS) 그대로,
 * en 은 구조·key·legalBasis 는 유지한 채 title/summary/description 만 영어로 교체한 사본.
 * (en 번역 누락 항목은 해당 항목만 한국어로 폴백.)
 */
export function getConsentItems(lang: Lang): ConsentItem[] {
  if (lang !== "en") return [...CONSENT_ITEMS];
  return CONSENT_ITEMS.map((item) => {
    const tr = CONSENT_TEXT_EN[item.key];
    return tr
      ? { ...item, title: tr.title, summary: tr.summary, description: tr.description }
      : item;
  });
}

export function validateConsents(
  consents: Record<string, unknown>
): { ok: true } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  for (const item of CONSENT_ITEMS) {
    // 고지(notice)·선택 항목은 면접 시작을 막지 않음. 필수 동의만 검증.
    if (item.kind !== "consent" || !item.required) continue;
    if (consents[item.key] !== true) missing.push(item.key);
  }
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

/**
 * 해당 세션에 현재 버전의 유효 동의가 있는지.
 *
 * candidateId 를 함께 넘기면 "이 후보의" 동의인지도 확인한다. consent_logs 는
 * interview_session_id 에 FK 가 없어(감사 목적상 세션 삭제 후에도 동의 row 를 보존한다)
 * 세션이 사라져도 동의 row 가 남는데, 로컬/재시드 환경에서 세션 id 가 재사용되면
 * 옛 후보의 orphan 동의가 새 세션에 잘못 매칭돼 동의 화면이 건너뛰어질 수 있다.
 * candidate_id 병행 매칭으로 이 오탐을 차단한다. 동의 저장 시 candidateId =
 * session.candidateId 로 기록되므로(consent 라우트) 정상 흐름에는 영향이 없다.
 */
// ── 도쿄 폴백 게이트 (마스킹 텍스트 LLM 호출의 국외 임시 처리 — COMPLIANCE_SOP §4) ──
// ① 처리방침 1.5.0 시행일 이후이고 ② 해당 동의가 1.9.0(도쿄 폴백 고지 포함) 이상일 때만
// gemini `allowFallback` 을 켤 수 있다.
// 시행일: 원래 §12 "7일 전 공지"에 맞춰 07-18 이었으나, 서비스 개시 전(보호할 기존
// 정보주체 부재)이라 사용자 결정(2026-07-12)으로 게시 즉시 시행.
const PII_FALLBACK_ACTIVE_FROM = process.env.PII_FALLBACK_FROM
  ? Date.parse(process.env.PII_FALLBACK_FROM)
  : Date.UTC(2026, 6, 11, 15, 0, 0); // 2026-07-12 00:00 KST (처리방침 1.5.0 시행일)

export function piiFallbackActive(): boolean {
  return Date.now() >= PII_FALLBACK_ACTIVE_FROM;
}

export function consentVersionAllowsFallback(
  version: string | null | undefined
): boolean {
  const m = /^(\d+)\.(\d+)/.exec(version ?? "");
  if (!m) return false;
  const major = Number(m[1]);
  return major > 1 || (major === 1 && Number(m[2]) >= 9);
}

async function latestConsentAllowsFallback(
  where: ReturnType<typeof eq>
): Promise<boolean> {
  if (!piiFallbackActive()) return false;
  const [row] = await db
    .select({
      version: consentLogs.consentVersion,
      consents: consentLogs.consents,
    })
    .from(consentLogs)
    .where(where)
    .orderBy(desc(consentLogs.id))
    .limit(1);
  if (!row || !consentVersionAllowsFallback(row.version)) return false;
  return validateConsents(row.consents).ok;
}

/** 세션의 최신 유효 동의가 도쿄 폴백 고지(1.9.0+)를 포함하는지 — 재평가 등 과거 세션용. */
export function sessionAllowsPiiFallback(
  interviewSessionId: number
): Promise<boolean> {
  return latestConsentAllowsFallback(
    eq(consentLogs.interviewSessionId, interviewSessionId)
  );
}

/** 후보자 단위 (세션 무관 — 질문지 생성 등). AI 면접 동의 이력이 없으면 false(서울 전용). */
export function candidateAllowsPiiFallback(
  candidateId: number
): Promise<boolean> {
  return latestConsentAllowsFallback(eq(consentLogs.candidateId, candidateId));
}

export async function hasValidConsent(
  interviewSessionId: number,
  candidateId?: number
): Promise<boolean> {
  const [row] = await db
    .select({ version: consentLogs.consentVersion, consents: consentLogs.consents })
    .from(consentLogs)
    .where(
      candidateId != null
        ? and(
            eq(consentLogs.interviewSessionId, interviewSessionId),
            eq(consentLogs.candidateId, candidateId)
          )
        : eq(consentLogs.interviewSessionId, interviewSessionId)
    )
    .orderBy(desc(consentLogs.id))
    .limit(1);
  if (!row) return false;
  if (row.version !== CONSENT_VERSION) return false;
  const v = validateConsents(row.consents);
  return v.ok;
}
