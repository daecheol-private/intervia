import { COMPANY_INFO, SITE_INFO } from "./site-info";

/**
 * 채용기업(고객사)이 공고 상세 내용(본문) 또는 자체 지원폼에
 * 그대로 붙여넣는 표준 지원자 안내·동의 문구.
 *
 * 단일 소스 — 업로드 게이트의 "안내 문구 복사" 버튼과
 * /legal/applicant-consent-template 페이지가 동일 문구를 사용한다.
 * 법적 내용(처리위탁·국외이전·§37의2 권리·보유기간)은 여기서만 관리.
 */
export function buildApplicantConsentTemplate(contactEmail?: string): {
  koreanShort: string;
  korean: string;
  english: string;
} {
  // 공고에 채용 담당자 이메일이 지정돼 있으면 그 값을 안내문에 주입. 없으면 placeholder 유지.
  const contactForNotice = contactEmail?.trim() || "[채용 담당 연락처]";
  const contactForForm = contactEmail?.trim() || "(채용기업 연락처 기재)";

  const korean = `[AI 채용 평가 적용 동의 — 본 채용 한정]

귀하가 본 채용에 지원하신 이력서·자기소개서·포트폴리오 및 (해당 시) AI 면접 응답은,
당사가 위탁한 "${SITE_INFO.serviceName}" (제공: ${COMPANY_INFO.name}) 의 AI 평가 시스템에서
다음과 같이 처리됩니다.

1) 처리위탁 수탁자
   - ${COMPANY_INFO.name} (대한민국) — 서비스 운영
   - Google Cloud (서울 리전 asia-northeast3, 대한민국 — 장애 시 일본 도쿄 리전 임시 처리) — 서류 평가·AI 면접 채팅·면접 평가 AI 호출 (Gemini), 응답 처리 후 즉시 폐기 (학습 미사용)
   - Vercel Inc. (미국) — 호스팅 및 이력서 파일 보관
   - Turso (일본 도쿄) — 데이터베이스
   - Resend (미국) — 시스템 기본 면접 안내·결과 통보 메일 발송 (지원자 이메일 주소·메일 본문)

2) 처리 항목
   - 이력서·자기소개서·포트폴리오 본문 (식별 가능한 정보를 자동 마스킹 처리하여 AI 에 전달)
   - AI 면접 진행 시 후보자 응답 텍스트 (식별 가능한 정보를 자동 마스킹 처리하여 AI 에 전달)
   - 스캔(이미지) 형태 이력서는 텍스트 추출(OCR)을 위해 마스킹 전 원본이 AI 수탁자에게
     전달될 수 있습니다 (OCR 기능을 사용하는 경우)
   - 평가 결과 점수 및 코멘트

3) 처리 목적
   - 본 채용의 서류 평가 및 면접 평가 보조 (최종 합·불 결정은 사람이 검토)

4) 국외 이전
   - AI 처리(서류 평가·면접 채팅·면접 평가)는 Google Cloud 서울 리전 처리가 원칙이며, 서울 리전 장애 시에 한해
     마스킹된 텍스트만 일본(도쿄 리전, Google LLC)에서 임시 처리될 수 있습니다 (즉시 폐기·학습 미사용).
     스캔 이력서 원본·음성 데이터는 항상 국내에서만 처리됩니다.
   - 인프라 단계 이전: Vercel Inc. (미국, 호스팅·이력서 파일), Turso (일본 도쿄, 데이터베이스), Resend (미국, 메일 발송)
   - 이전 시점·방법: 서비스 이용 전 과정에서 HTTPS 로 전송·저장
   - 보유 기간: 합·불 결정 시점 즉시 폐기 (이력서 원본·파일), 공고 종결 +14일 후 자동 삭제 (평가 결과)

5) 자동화된 의사결정에 관한 권리
   - 본 평가는 AI 가 점수·추천을 산출하나, 최종 합·불 결정은 채용 담당자가 수행합니다.
   - AI 평가의 기준·절차·처리 방식 안내: ${SITE_INFO.baseUrl}/legal/ai-evaluation-disclosure
   - 귀하는 AI 평가 결과에 대한 설명 요구 및 이의제기를 할 수 있습니다.
     (이의제기 채널: 면접 종료 화면 또는 ${COMPANY_INFO.email} )
   - AI 평가 자체를 거부할 권리가 있으며, 거부 시 본 AI 평가 절차는 제외되고
     일반 채용 절차로 진행됩니다. (단, 채용기업의 절차상 AI 평가가 필수인 경우는 별도)

6) 보유 및 이용 기간
   - 합·불 결정 시점에 이력서 원본·마스킹 텍스트는 즉시 폐기
   - 평가 결과는 채용 공고 종결 +14일 후 자동 삭제
   - 본 채용서류는 홈페이지·전자우편 등 전자적 방법으로 제출되어 채용절차의 공정화에 관한
     법률 §11 에 따른 반환 의무 대상이 아니며, 불합격 확정 시 즉시, 늦어도 공고 종결 후
     14일 이내 파기됩니다 (최종 합격자 정보는 입사 절차 목적으로 보유)
   - 파기 관련 문의: ${contactForForm}

☐ 위 사항에 동의합니다 (필수, 거부 시 본 채용 지원 불가)`;

  const english = `[AI Evaluation Consent — This Recruitment Only]

Your resume, cover letter, portfolio and (if applicable) AI interview responses for this
recruitment will be processed by "${SITE_INFO.serviceName}" (operated by ${COMPANY_INFO.name}),
which we have contracted as a data processor, as follows:

1) Processors
   - ${COMPANY_INFO.name} (Republic of Korea) — Service operation
   - Google Cloud (Seoul region asia-northeast3, Republic of Korea — temporary processing in the Tokyo region, Japan, during a Seoul-region outage) — Resume screening / AI interview chat / interview evaluation AI (Gemini), no training use, discarded after response
   - Vercel Inc. (USA) — Hosting and resume file storage
   - Turso (Tokyo, Japan) — Database
   - Resend (USA) — System default email delivery (interview invitations / result notifications)

2) Data Items
   - Resume / CV / cover letter / portfolio (PII masked before AI invocation)
   - Candidate responses during AI interview
   - Evaluation scores and comments

3) Purpose
   - Resume and interview screening assistance for this recruitment
     (final hiring decision made by a human reviewer)

4) Cross-Border Transfer
   - AI processing (resume screening / interview chat / interview evaluation) is
     performed in the Seoul region in principle; only during a Seoul-region outage,
     masked text may be temporarily processed in Japan (Tokyo region, Google LLC —
     discarded immediately, no training use). Scanned resume originals and voice
     data are always processed within Korea.
   - Infrastructure-level transfer: Vercel Inc. (USA, hosting & file storage),
     Turso (Tokyo, Japan, database), Resend (USA, email delivery)
   - Method: HTTPS throughout service usage
   - Retention: Disposal upon hiring decision (resume original/files),
     +14 days after job closure (evaluation results)

5) Rights Regarding Automated Decisions
   - AI produces scores/recommendations; final hiring decision is made by a human reviewer.
   - Evaluation criteria, procedure and processing: ${SITE_INFO.baseUrl}/legal/ai-evaluation-disclosure
   - You may request explanation of and object to the AI evaluation result.
     (Channel: end of interview screen, or ${COMPANY_INFO.email})
   - You may refuse AI evaluation; in such case the AI step is skipped and you proceed
     via the standard recruitment process.

6) Retention Period
   - Resume original and masked text deleted immediately upon hiring decision
   - Evaluation results auto-deleted +14 days after job posting closure
   - Compliant with Article 11 of the Korean Fair Hiring Procedure Act

☐ I consent to the above (required; refusal precludes application)`;

  // 공고 본문(모집 요강)에 그대로 붙여넣는 짧은 §37의2 고지문 — 핵심(AI 적용 사실 +
  // 거부권 + 설명·이의제기)만. 처리위탁·국외이전 전문은 자체 지원폼/동의서(korean)에서
  // 받고, 인프라 국외이전 명시 동의는 면접 시작 전 동의 화면에서 별도 취득.
  const koreanShort = `■ AI 평가 활용 안내

본 채용은 서류·면접 평가에 AI를 활용하되, 최종 합격 여부는 채용 담당자가 결정합니다(평가 기준·절차: ${SITE_INFO.baseUrl}/legal/ai-evaluation-disclosure).

AI 평가를 원하지 않으시면 ${contactForNotice}로 알려 주시면 AI 없이 일반 절차로 진행되며, 평가 결과에 대한 설명·이의제기도 하실 수 있습니다.`;

  return { koreanShort, korean, english };
}
