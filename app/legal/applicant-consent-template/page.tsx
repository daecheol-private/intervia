import {
  COMPANY_INFO,
  SITE_INFO,
  PROCESSORS,
} from "@/lib/site-info";
import Link from "next/link";

export const metadata = {
  title: `지원자 동의 문구 템플릿 — ${SITE_INFO.serviceName}`,
};

/**
 * 채용기업(고객사)이 사람인/잡코리아 추가 동의 항목 또는 자체 지원폼에
 * 그대로 복붙해서 쓸 수 있는 표준 동의 문구.
 *
 * 법적 의미: 본 서비스가 위탁받은 데이터 처리에 대한 §15·§26·§28의8·§37의2 동의를
 * 채용기업이 적법하게 취득하는 것을 돕는 가이드. 동의 취득 책임 자체는
 * 이용약관 §5 에 따라 채용기업에 있음.
 */
export default function ApplicantConsentTemplatePage() {
  const koreanTemplate = `[AI 채용 평가 적용 동의 — 본 채용 한정]

귀하가 본 채용에 지원하신 이력서·자기소개서·포트폴리오 및 (해당 시) AI 면접 응답은,
당사가 위탁한 "${SITE_INFO.serviceName}" (제공: ${COMPANY_INFO.name}) 의 AI 평가 시스템에서
다음과 같이 처리됩니다.

1) 처리위탁 수탁자
   - ${COMPANY_INFO.name} (대한민국) — 서비스 운영
   - Google Cloud (서울 리전 asia-northeast3, 대한민국) — 서류 평가·AI 면접 채팅·면접 평가 AI 호출 (Gemini), 응답 처리 후 즉시 폐기 (학습 미사용)
   - Vercel Inc. (미국) — 호스팅 및 이력서 파일 보관
   - Turso (일본 도쿄) — 데이터베이스

2) 처리 항목
   - 이력서·자기소개서·포트폴리오 본문 (식별 가능한 정보를 자동 마스킹 처리하여 AI 에 전달)
   - AI 면접 진행 시 후보자 응답 텍스트 (식별 가능한 정보를 자동 마스킹 처리하여 AI 에 전달)
   - 평가 결과 점수 및 코멘트

3) 처리 목적
   - 본 채용의 서류 평가 및 면접 평가 보조 (최종 합·불 결정은 사람이 검토)

4) 국외 이전
   - AI 처리(서류 평가·면접 채팅·면접 평가)는 모두 Google Cloud 서울 리전에서 처리되어 AI 단계의 국외이전이 발생하지 않습니다.
   - 인프라 단계 이전: Vercel Inc. (미국, 호스팅·이력서 파일), Turso (일본 도쿄, 데이터베이스)
   - 이전 시점·방법: 서비스 이용 전 과정에서 HTTPS 로 전송·저장
   - 보유 기간: 합·불 결정 시점 즉시 폐기 (이력서 원본·파일), 공고 종결 +14일 후 자동 삭제 (평가 결과)

5) 자동화된 의사결정에 관한 권리
   - 본 평가는 AI 가 점수·추천을 산출하나, 최종 합·불 결정은 채용 담당자가 수행합니다.
   - 귀하는 AI 평가 결과에 대한 설명 요구 및 이의제기를 할 수 있습니다.
     (이의제기 채널: 면접 종료 화면 또는 ${COMPANY_INFO.email} )
   - AI 평가 자체를 거부할 권리가 있으며, 거부 시 본 AI 평가 절차는 제외되고
     일반 채용 절차로 진행됩니다. (단, 채용기업의 절차상 AI 평가가 필수인 경우는 별도)

6) 보유 및 이용 기간
   - 합·불 결정 시점에 이력서 원본·마스킹 텍스트는 즉시 폐기
   - 평가 결과는 채용 공고 종결 +14일 후 자동 삭제
   - 채용절차의 공정화에 관한 법률 §11 에 따른 채용서류 반환·파기 의무 준수

☐ 위 사항에 동의합니다 (필수, 거부 시 본 채용 지원 불가)`;

  const englishTemplate = `[AI Evaluation Consent — This Recruitment Only]

Your resume, cover letter, portfolio and (if applicable) AI interview responses for this
recruitment will be processed by "${SITE_INFO.serviceName}" (operated by ${COMPANY_INFO.name}),
which we have contracted as a data processor, as follows:

1) Processors
   - ${COMPANY_INFO.name} (Republic of Korea) — Service operation
   - Google Cloud (Seoul region asia-northeast3, Republic of Korea) — Resume screening / AI interview chat / interview evaluation AI (Gemini), no training use, discarded after response
   - Vercel Inc. (USA) — Hosting and resume file storage
   - Turso (Tokyo, Japan) — Database

2) Data Items
   - Resume / CV / cover letter / portfolio (PII masked before AI invocation)
   - Candidate responses during AI interview
   - Evaluation scores and comments

3) Purpose
   - Resume and interview screening assistance for this recruitment
     (final hiring decision made by a human reviewer)

4) Cross-Border Transfer
   - All AI processing (resume screening / interview chat / interview evaluation)
     is performed in the Seoul region; no cross-border transfer at the AI stage.
   - Infrastructure-level transfer: Vercel Inc. (USA, hosting & file storage),
     Turso (Tokyo, Japan, database)
   - Method: HTTPS throughout service usage
   - Retention: Disposal upon hiring decision (resume original/files),
     +14 days after job closure (evaluation results)

5) Rights Regarding Automated Decisions
   - AI produces scores/recommendations; final hiring decision is made by a human reviewer.
   - You may request explanation of and object to the AI evaluation result.
     (Channel: end of interview screen, or ${COMPANY_INFO.email})
   - You may refuse AI evaluation; in such case the AI step is skipped and you proceed
     via the standard recruitment process.

6) Retention Period
   - Resume original and masked text deleted immediately upon hiring decision
   - Evaluation results auto-deleted +14 days after job posting closure
   - Compliant with Article 11 of the Korean Fair Hiring Procedure Act

☐ I consent to the above (required; refusal precludes application)`;

  return (
    <main className="max-w-3xl mx-auto w-full px-6 py-10">
      <Link href="/" className="text-xs text-slate-500 hover:underline">
        ← 홈
      </Link>
      <h1 className="text-2xl font-bold text-slate-900 mt-3">
        지원자 동의 문구 표준 템플릿
      </h1>
      <p className="text-sm text-slate-600 mt-2">
        본 페이지는 채용기업(고객사)이 사람인·잡코리아 등 채용 플랫폼의{" "}
        <strong>&quot;추가 동의 항목&quot;</strong> 또는 자체 지원폼에 그대로
        복붙해서 사용할 수 있는 표준 문구입니다.
      </p>

      <section className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <div className="font-semibold mb-1">⚠️ 왜 필요한가요?</div>
        <p className="leading-relaxed">
          {SITE_INFO.serviceName} 이용약관 §5 에 따라, 이력서를 본 서비스에
          업로드하기 전 지원자로부터{" "}
          <strong>AI 평가 적용·국외이전·처리위탁</strong> 에 대한 적법한 동의를
          취득할 책임은 채용기업에 있습니다. 동의 없이 업로드한 경우 발생하는
          법적 책임(개인정보보호법 §15·§26·§28의8·§37의2)은 채용기업이
          부담하며, {COMPANY_INFO.name} 은 면책됩니다.
        </p>
        <p className="leading-relaxed mt-2">
          업로드 화면의 <strong>&quot;지원자 동의 확인&quot;</strong> 체크박스를
          체크할 수 있도록, 사람인/잡코리아 공고 등록 시{" "}
          <strong>&quot;추가 동의 항목&quot;</strong> 기능에 아래 문구를 그대로
          등록해 주세요.
        </p>
      </section>

      <section className="mt-8">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-base font-semibold text-slate-900">
            한국어 (기본)
          </h2>
          <span className="text-xs text-slate-500">
            사람인·잡코리아 추가 동의 항목에 그대로 붙여넣기
          </span>
        </div>
        <pre className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs whitespace-pre-wrap font-mono text-slate-800 leading-relaxed">
          {koreanTemplate}
        </pre>
      </section>

      <section className="mt-8">
        <h2 className="text-base font-semibold text-slate-900 mb-2">
          English (외국인 지원자 대비)
        </h2>
        <pre className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs whitespace-pre-wrap font-mono text-slate-800 leading-relaxed">
          {englishTemplate}
        </pre>
      </section>

      <section className="mt-8">
        <h2 className="text-base font-semibold text-slate-900 mb-2">
          현재 등록된 처리위탁 수탁자 (참고)
        </h2>
        <table className="w-full text-xs border border-slate-200 mt-2">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left">수탁자</th>
              <th className="px-3 py-2 text-left">목적</th>
              <th className="px-3 py-2 text-left">국가</th>
            </tr>
          </thead>
          <tbody>
            {PROCESSORS.map((p) => (
              <tr key={p.name} className="border-t border-slate-200">
                <td className="px-3 py-2 font-medium text-slate-900">
                  {p.name}
                </td>
                <td className="px-3 py-2 text-slate-700">{p.purpose}</td>
                <td className="px-3 py-2 text-slate-700">{p.country}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-slate-500 mt-2">
          전체 항목·보유기간은{" "}
          <Link
            href="/privacy"
            className="text-primary hover:underline"
          >
            개인정보 처리방침
          </Link>{" "}
          §5 참고.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-base font-semibold text-slate-900 mb-2">
          자주 묻는 질문
        </h2>
        <dl className="text-sm text-slate-700 space-y-3 leading-relaxed">
          <div>
            <dt className="font-medium text-slate-900">
              Q. 공고 본문에 한 줄 적는 것만으로는 안 되나요?
            </dt>
            <dd className="mt-1">
              A. 안 됩니다. 개인정보보호법은 동의를{" "}
              <strong>명시적 의사표시(체크박스·서명)</strong> 로 받도록 합니다.
              공고 본문에 적어둔 것만으로는 묵시적 동의로 인정되지 않습니다.
              특히 §28의8 국외이전과 §37의2 자동화 결정은{" "}
              <strong>별도 동의 항목</strong> 이 필요합니다.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-slate-900">
              Q. 사람인/잡코리아의 기본 동의서로 커버되나요?
            </dt>
            <dd className="mt-1">
              A. 부분적으로만 커버됩니다. 기본 동의서는 &quot;지원 기업이
              평가에 활용&quot; 까지만 포함되고,{" "}
              <strong>제3자 처리위탁·국외이전·자동화 결정 적용</strong> 은
              포함되지 않습니다. 사람인·잡코리아 모두 채용기업이 &quot;추가
              동의 항목&quot; 을 등록할 수 있는 기능을 제공합니다.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-slate-900">
              Q. 자체 지원폼/오프라인 채용은 어떻게 하나요?
            </dt>
            <dd className="mt-1">
              A. 위 문구를 동의서 양식에 그대로 포함시키고{" "}
              <strong>체크박스 또는 서명</strong> 을 받으세요. 받은 동의서는
              분쟁 시 입증 자료로 보관(5년 권장).
            </dd>
          </div>
          <div>
            <dt className="font-medium text-slate-900">
              Q. 지원자가 AI 평가 거부 의사를 밝히면?
            </dt>
            <dd className="mt-1">
              A. 본 서비스에 업로드하지 마시고, 일반 채용 절차(사람 면접)로
              진행해 주세요. 거부권 보장은 §37의2 의 핵심 요건입니다.
            </dd>
          </div>
        </dl>
      </section>

      <hr className="my-8 border-slate-200" />
      <div className="text-xs text-slate-500 space-y-1">
        <div>
          본 템플릿은 일반적 가이드입니다. 채용 형태·산업 특성에 따라 법무
          검토가 필요할 수 있습니다.
        </div>
        <div>
          문의:{" "}
          <a
            href={`mailto:${COMPANY_INFO.email}`}
            className="text-primary hover:underline"
          >
            {COMPANY_INFO.email}
          </a>
        </div>
      </div>
    </main>
  );
}
