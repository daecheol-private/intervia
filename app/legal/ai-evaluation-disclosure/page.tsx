import {
  COMPANY_INFO,
  SITE_INFO,
  APPEAL_CONTACT,
  PROCESSORS,
} from "@/lib/site-info";
import Link from "next/link";

export const metadata = {
  title: `AI 평가 사전공개 — ${SITE_INFO.serviceName}`,
};

/**
 * 개인정보 보호법 §37의2 4항 사전공개 의무 충족용 페이지.
 *
 * 동의 화면(체크박스)만으로는 "쉽게 확인" 요건이 모호하므로,
 * 비로그인 + 검색·링크로 누구나 도달 가능한 공개 페이지로 별도 운영.
 *
 * 채용기업은 본 페이지 URL 을 채용공고 footer 에 함께 게재하도록 권고.
 *
 * ⚠️ §2 평가 가중치는 법적 고지물 — 실제 채점 코드와 반드시 일치 유지할 것.
 *   · 서류 6축  = lib/screening.ts `AXIS_WEIGHTS` · lib/prompts.ts raw score 산식
 *   · 면접 4차원 = lib/prompts.ts buildSummaryPrompt (기술0.35/경험0.30/협업0.15/적합0.20)
 *   코드 가중치를 바꾸면 이 표도 함께 갱신(불일치 = §37의2 사전공개 부정확).
 */
export default function AiEvaluationDisclosurePage() {
  return (
    <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      <Link href="/" className="text-xs text-ink-muted hover:underline">
        ← 홈
      </Link>
      <h1 className="text-2xl font-bold text-ink mt-3">
        AI 평가 사전공개
      </h1>
      <p className="text-xs text-ink-muted mt-1">
        개인정보 보호법 §37의2 (자동화된 결정에 대한 정보주체의 권리) 4항에
        따른 사전공개. 누구나 로그인 없이 확인할 수 있습니다.
      </p>

      <p className="text-sm text-ink-soft leading-relaxed mt-6">
        본 문서는 <strong>{SITE_INFO.serviceName}</strong>(제공:{" "}
        {COMPANY_INFO.name})의 AI 채용 평가 시스템이 어떤 기준과 절차로
        동작하는지를 정보주체(지원자)가 사전에 확인할 수 있도록 공개하는
        문서입니다.
      </p>

      <Section n="1" title="평가 대상과 방식">
        <ul className="list-disc list-inside space-y-1">
          <li>
            <strong>서류 평가</strong>: 지원자가 제출한 이력서·자기소개서·
            포트폴리오 텍스트를 기반으로 LLM(대규모 언어모델)이 점수와 의견을
            산출합니다.
          </li>
          <li>
            <strong>AI 면접 평가</strong>: 채팅 기반 면접 응답을 기반으로
            LLM이 점수와 의견을 산출합니다.
          </li>
          <li>
            <strong>면접 무결성 신호</strong>: AI 면접 중 외부 도구를 이용한
            대리 작성 등 부정행위를 방지·탐지하기 위해 답변 입력 과정의
            행태정보(붙여넣기·타이핑 분량, 응답 시간, 화면 이탈·질문 복사 시도
            횟수)를 수집합니다. 이 신호는 채용 담당자의{" "}
            <strong>참고 자료로만</strong> 제공되며, 단독으로 합·불을 결정하지
            않습니다. 정당한 사용(메모 참고 등) 가능성을 전제로 중립적으로
            표시됩니다. 행태정보와 별개로, 면접 답변의 문체적 특징에 대한 AI
            분석(외부 AI 대필 가능성 추정)이 참고 자료로 산출됩니다. 이 분석은
            단독으로 합격·불합격을 결정하지 않으며, 채용 담당자의 종합 판단
            자료로만 제공됩니다.
          </li>
          <li>
            서류·면접 단계 모두 LLM 호출 전에 생년월일·연락처·이메일·주소·
            학교명·지역명 등 직접 식별자와, 라벨로 표기된{" "}
            <strong>채용절차법 §4의3 평가 금지 항목</strong>(나이·성별·혼인·
            종교·가족관계 등)을 <strong>자동 마스킹 처리하여 LLM 에 전달</strong>
            합니다. 마스킹은 정규식·사전 기반 자동 처리로, 사전에 등록되지 않은
            신규 학교명·회사명·변형 표기 등은 잔존할 가능성이 있으며, 마스킹을
            통과한 표현이 있더라도 평가 모델에 해당 항목의 평가 반영을 금지하는
            지시를 함께 적용합니다 (이중 방어).
          </li>
        </ul>
      </Section>

      <Section n="2" title="평가 차원과 가중치">
        <p className="text-sm text-ink-soft mb-3">
          평가 단계(서류 평가 / AI 면접 평가)에 따라 평가 차원과 가중치가
          다릅니다.
        </p>

        <h3 className="text-sm font-semibold text-ink-soft mt-4 mb-1">
          가. 서류 평가 — 6개 차원
        </h3>
        <table className="w-full text-sm border border-border-default">
          <thead className="bg-surface-alt">
            <tr>
              <th className="px-3 py-2 text-left w-40">차원</th>
              <th className="px-3 py-2 text-left">평가 내용</th>
              <th className="px-3 py-2 text-right w-20">가중치</th>
            </tr>
          </thead>
          <tbody className="text-ink-soft">
            <tr className="border-t border-border-default">
              <td className="px-3 py-2 font-medium">기술 적합도</td>
              <td className="px-3 py-2">
                JD 핵심 도메인·기술 요구사항과 이력서에 나타난 기술 경험의 직접
                부합 정도
              </td>
              <td className="px-3 py-2 text-right">20%</td>
            </tr>
            <tr className="border-t border-border-default">
              <td className="px-3 py-2 font-medium">경험 깊이</td>
              <td className="px-3 py-2">
                JD 직무와 매칭되는 실무 경력의 연수 × 책임 범위 × 프로젝트
                규모·난이도
              </td>
              <td className="px-3 py-2 text-right">20%</td>
            </tr>
            <tr className="border-t border-border-default">
              <td className="px-3 py-2 font-medium">직무 매칭도</td>
              <td className="px-3 py-2">
                JD 주요 업무와 후보자의 과거 수행 업무(실무 경력)의 일치
              </td>
              <td className="px-3 py-2 text-right">25%</td>
            </tr>
            <tr className="border-t border-border-default">
              <td className="px-3 py-2 font-medium">성과 임팩트</td>
              <td className="px-3 py-2">
                정량 지표·책임 범위·외부 인지 등 성과의 구체성과 임팩트
              </td>
              <td className="px-3 py-2 text-right">15%</td>
            </tr>
            <tr className="border-t border-border-default">
              <td className="px-3 py-2 font-medium">재직 안정성</td>
              <td className="px-3 py-2">
                회사별 재직 기간 등 커리어의 안정성
              </td>
              <td className="px-3 py-2 text-right">10%</td>
            </tr>
            <tr className="border-t border-border-default">
              <td className="px-3 py-2 font-medium">성장·태도</td>
              <td className="px-3 py-2">학습의 깊이와 커리어 상승 궤적</td>
              <td className="px-3 py-2 text-right">10%</td>
            </tr>
          </tbody>
        </table>

        <h3 className="text-sm font-semibold text-ink-soft mt-5 mb-1">
          나. AI 면접 평가 — 4개 차원
        </h3>
        <table className="w-full text-sm border border-border-default">
          <thead className="bg-surface-alt">
            <tr>
              <th className="px-3 py-2 text-left w-40">차원</th>
              <th className="px-3 py-2 text-left">평가 내용</th>
              <th className="px-3 py-2 text-right w-20">가중치</th>
            </tr>
          </thead>
          <tbody className="text-ink-soft">
            <tr className="border-t border-border-default">
              <td className="px-3 py-2 font-medium">기술역량</td>
              <td className="px-3 py-2">
                JD hard skill 에 대한 면접 답변의 깊이·정확성
              </td>
              <td className="px-3 py-2 text-right">35%</td>
            </tr>
            <tr className="border-t border-border-default">
              <td className="px-3 py-2 font-medium">실무경험</td>
              <td className="px-3 py-2">
                사례의 구체성, 본인 기여, 정량 성과, 트레이드오프 인지
              </td>
              <td className="px-3 py-2 text-right">30%</td>
            </tr>
            <tr className="border-t border-border-default">
              <td className="px-3 py-2 font-medium">협업·커뮤니케이션</td>
              <td className="px-3 py-2">
                질문 이해·답변 명료성·경청·갈등 해결 사례
              </td>
              <td className="px-3 py-2 text-right">15%</td>
            </tr>
            <tr className="border-t border-border-default">
              <td className="px-3 py-2 font-medium">직무적합성</td>
              <td className="px-3 py-2">
                직무·회사 이해, 동기, 선호 인재상 부합
              </td>
              <td className="px-3 py-2 text-right">20%</td>
            </tr>
          </tbody>
        </table>

        <p className="text-xs text-ink-muted mt-3">
          각 표의 가중치 합은 100% 입니다. 모든 차원은 0~100 점, 종합 점수도
          0~100 점으로 산출됩니다. 추천 등급: 85+ 강력추천 / 70+ 추천 / 55+
          보류 / 미만 비추천.
        </p>
      </Section>

      <Section n="3" title="사용 모델·기술">
        <ul className="list-disc list-inside space-y-1">
          <li>
            모델 (Google 제공, 결제 등급 — 입력이 모델 학습에 활용되지 않음):
            <ul className="list-disc list-inside ml-5 mt-1">
              <li>
                서류 평가·AI 면접 채팅·면접 응답 평가 모두{" "}
                <strong>Google Gemini 2.5 Flash</strong> —{" "}
                <strong>Google Cloud 서울 리전(asia-northeast3, 대한민국) 에서 처리</strong>{" "}
                (AI 처리 단계의 국외이전 없음)
              </li>
            </ul>
          </li>
          <li>
            LLM에 전달되는 텍스트는 본 페이지 §1 의 마스킹을 거친 텍스트로
            한정됩니다.
          </li>
          <li>
            평가 결과는 JSON 으로 산출되어 회사 데이터베이스(Turso, 일본
            도쿄 리전)에 저장됩니다.
          </li>
        </ul>
      </Section>

      <Section n="4" title="인적 검토 절차">
        <p className="text-sm text-ink-soft mb-2">
          AI 평가는 <strong>최종 합·불 결정을 자동으로 내리지 않습니다</strong>.
          모든 채용 결정에는 사람의 실질적 검토가 개입합니다.
        </p>
        <ol className="list-decimal list-inside space-y-1 text-sm">
          <li>
            <strong>서류 평가</strong>: AI 가 점수와 의견을 산출한 후, 채용
            담당자가 점수를 참고하여 면접 진행 여부를 결정합니다.
          </li>
          <li>
            <strong>AI 면접 평가</strong>: AI 가 면접 응답에 대한 점수와
            의견을 산출한 후, 채용 담당자가 다음 단계(2차 면접·합격·불합격)를
            결정합니다.
          </li>
          <li>
            <strong>최종 결정</strong>: 채용기업의 권한 있는 담당자가
            시스템에 결정 사유를 기록한 뒤에야 합·불 상태가 확정됩니다.
            결정 시각·결정자·결정 사유는 감사 로그에 최장 5년 보존됩니다.
          </li>
        </ol>
      </Section>

      <Section n="5" title="정보주체의 권리">
        <p className="text-sm text-ink-soft mb-2">
          개인정보 보호법 §37의2 에 따라 지원자는 AI 평가에 대해 다음 권리를
          가집니다.
        </p>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>
            <strong>설명 요구권</strong>: AI 가 어떤 기준으로 평가했는지에 대해
            설명을 요구할 수 있습니다.
          </li>
          <li>
            <strong>이의 제기권</strong>: AI 평가 결과에 대해 이의를 제기할 수
            있습니다. 회사는 7영업일 이내에 답변합니다.
          </li>
          <li>
            <strong>인적 검토 요구권</strong>: 사람의 재검토를 요구할 수
            있습니다.
          </li>
          <li>
            <strong>거부권</strong>: AI 평가 자체를 거부할 수 있습니다. 거부 시
            본 AI 평가 절차는 제외되고, 채용기업의 일반 채용 절차로 진행됩니다
            (채용기업이 일반 절차를 제공하지 않는 경우는 본 채용 지원이 제한될
            수 있습니다).
          </li>
        </ul>
        <p className="text-xs text-ink-soft mt-3 rounded-md bg-surface-alt border border-border-default p-3">
          <strong>이의제기·설명 요청 채널</strong>:{" "}
          <a
            href={`mailto:${APPEAL_CONTACT.email}`}
            className="text-primary hover:underline"
          >
            {APPEAL_CONTACT.email}
          </a>
          <br />
          또는 면접 종료 화면의 &quot;자동화 의사결정 이의제기&quot; 링크.{" "}
          {APPEAL_CONTACT.description}
        </p>
      </Section>

      <Section n="6" title="평가에서 절대 사용하지 않는 정보 (차별 금지)">
        <p className="text-sm text-ink-soft mb-2">
          채용절차의 공정화에 관한 법률 §4의3, 남녀고용평등법, 연령차별금지법,
          장애인차별금지법, 국가인권위원회법에 따라, 다음 정보는 평가의
          근거·인용·언급에서 모두 제외됩니다.
        </p>
        <ul className="list-disc list-inside space-y-0.5 text-sm text-ink-soft">
          <li>성별, 나이, 혼인 여부</li>
          <li>출신 지역, 본적, 출생지</li>
          <li>출신 학교명, 학교 서열, 출신 학과의 특정 정보</li>
          <li>가족관계, 부모·형제의 직업·학력·재산</li>
          <li>종교, 정치적 견해, 노조 활동 이력</li>
          <li>신체 조건 (키·체중·외모·장애 여부)</li>
          <li>건강 상태 (직무 수행에 직접 필요한 경우 제외)</li>
        </ul>
        <p className="text-xs text-ink-muted mt-2">
          위 항목 중 직접 식별자와 라벨로 표기된 항목은 LLM 호출 전 자동
          마스킹되며, 마스킹을 통과한 표현이 있더라도 AI 평가 프롬프트의
          명시적인 평가 금지 지시가 적용됩니다 (이중 방어). 그럼에도 평가
          결과에 이러한 정보의 흔적이 발견된 경우 §5 의 이의제기 채널로
          신고해 주세요.
        </p>
      </Section>

      <Section n="7" title="평가 결과의 보유 기간">
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li>이력서 원본 파일·마스킹 텍스트: 합·불 결정 시점 즉시 폐기</li>
          <li>평가 결과(점수·코멘트): 채용 공고 종결 +14일 후 자동 삭제</li>
          <li>감사 로그 (결정 시각·결정자·이의제기 기록): 분쟁 대응 목적
            상 최장 5년 보유 (법적 의무 기간 종료 시 폐기)</li>
          <li>단, 최종 합격자의 정보는 입사 절차 및 인사기록 목적으로
            채용기업이 삭제할 때까지 보유됩니다.</li>
        </ul>
      </Section>

      <Section n="8" title="처리위탁 / 국외이전">
        <p className="text-sm text-ink-soft mb-2">
          AI 평가는 다음 수탁자를 거쳐 수행됩니다. 자세한 처리 항목·보유기간은{" "}
          <Link href="/privacy" className="text-primary hover:underline">
            개인정보 처리방침
          </Link>{" "}
          §5 참고.
        </p>
        <table className="w-full text-xs border border-border-default mt-2">
          <thead className="bg-surface-alt">
            <tr>
              <th className="px-3 py-2 text-left">수탁자</th>
              <th className="px-3 py-2 text-left">목적</th>
              <th className="px-3 py-2 text-left">국가</th>
              <th className="px-3 py-2 text-left">연락처</th>
            </tr>
          </thead>
          <tbody className="text-ink-soft">
            {PROCESSORS.filter((p) =>
              ["Google", "Vercel Inc", "Turso", "Vercel Blob"].some((k) =>
                p.name.includes(k)
              )
            ).map((p) => (
              <tr key={p.name} className="border-t border-border-default">
                <td className="px-3 py-2 font-medium text-ink">
                  {p.name}
                </td>
                <td className="px-3 py-2">{p.purpose}</td>
                <td className="px-3 py-2">{p.country}</td>
                <td className="px-3 py-2 break-all">{p.contact}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section n="9" title="고영향 인공지능에 관한 책무">
        <p className="text-sm text-ink-soft">
          본 서비스의 AI 평가 시스템은 「인공지능 발전과 신뢰 기반 조성 등에
          관한 기본법」상 채용 분야의 <strong>고영향 인공지능</strong>에
          해당하며, 회사는 같은 법 제34조에 따른 위험관리방안 수립·운영,
          설명 가능성 확보(본 사전공개 및 §5 의 설명 요구권), 사람의
          관리·감독(§4 의 인적 검토 절차) 등 사업자 책무를 이행하고 그 내역을
          문서로 관리합니다.
        </p>
      </Section>

      <Section n="10" title="채용기업에 대한 권고 사항">
        <p className="text-sm text-ink-soft">
          본 서비스를 도입하는 채용기업은 채용 공고 본문 또는 지원 페이지
          하단에 본 페이지 URL 을 함께 게재할 것을 권고합니다. 사전공개는
          개인정보 보호법 §37의2 4항의 필수 의무이며, 지원자가 본 정보에
          &quot;쉽게 접근할 수 있는 상태&quot; 가 입증 가능해야 합니다.
        </p>
        <p className="text-xs text-ink-muted mt-2">
          본 페이지 URL: {SITE_INFO.baseUrl}/legal/ai-evaluation-disclosure
        </p>
      </Section>

    </main>
  );
}

function Section({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-base font-semibold text-ink">
        제{n}조 · {title}
      </h2>
      <div className="text-sm text-ink-soft leading-relaxed mt-2 space-y-2">
        {children}
      </div>
    </section>
  );
}
