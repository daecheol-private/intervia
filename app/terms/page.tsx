import { COMPANY_INFO, SITE_INFO, TERMS_EFFECTIVE_DATE } from "@/lib/site-info";
import Link from "next/link";
import { BackHomeLink } from "@/app/components/BackHomeLink";

export const metadata = {
  title: `${SITE_INFO.serviceName} 이용약관`,
};

export default function TermsPage() {
  return (
    <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      <BackHomeLink />
      <h1 className="text-2xl font-bold text-ink mt-3">
        {SITE_INFO.serviceName} 이용약관
      </h1>
      <p className="text-xs text-ink-muted mt-1">시행일: {TERMS_EFFECTIVE_DATE}</p>

      <Section n="1" title="목적">
        본 약관은 {COMPANY_INFO.name}(이하 &quot;회사&quot;)가 제공하는 AI 채용
        면접 플랫폼 &quot;{SITE_INFO.serviceName}&quot;(이하 &quot;서비스&quot;)의
        이용과 관련하여 회사와 이용자 간 권리·의무 및 책임 사항을 규정함을
        목적으로 합니다.
      </Section>

      <Section n="2" title="용어의 정의">
        <ul className="list-disc list-inside space-y-1">
          <li>
            <strong>법인</strong>: 채용을 진행하는 사업자 단위. 동일 법인의
            관리자·멤버는 같은 데이터에 접근합니다.
          </li>
          <li>
            <strong>이용자</strong>: 회사의 서비스에 가입한 법인 관리자 또는
            멤버.
          </li>
          <li>
            <strong>후보자</strong>: 법인이 발송한 면접 링크를 통해 AI 면접에
            참여하는 사람. 별도 회원가입은 없습니다.
          </li>
          <li>
            <strong>토큰</strong>: 서비스 내 사용량 단위. 공고 등록, 이력서
            평가, 면접 발송 시 차감됩니다.
          </li>
        </ul>
      </Section>

      <Section n="3" title="서비스 내용">
        회사는 다음 서비스를 제공합니다.
        <ul className="list-disc list-inside mt-2 space-y-1">
          <li>채용 공고 관리</li>
          <li>이력서 PDF/DOCX 자동 텍스트 추출 및 AI 서류 평가</li>
          <li>채팅 기반 AI 면접 진행 및 자동 평가</li>
          <li>면접 결과 리포트 및 후보자 비교</li>
          <li>법인별 메일 서버 설정 및 면접 안내 자동 발송</li>
        </ul>
      </Section>

      <Section n="4" title="회원 가입 및 계약 성립">
        <ul className="list-disc list-inside space-y-1">
          <li>
            가입은 법인 단위로 이루어지며, 도메인 매칭 또는 검색으로 기존 법인에
            합류하거나 새 법인을 등록할 수 있습니다.
          </li>
          <li>이메일 인증 후 서비스 이용이 가능합니다.</li>
          <li>법인 관리자의 승인 절차가 있는 경우 승인 후 이용 가능합니다.</li>
        </ul>
      </Section>

      <Section n="5" title="이용자의 의무 — 지원자 동의 취득 책임">
        <p className="text-sm text-ink-soft mb-2">
          본 서비스는 채용기업(이용자)이 위탁한 데이터를 처리하는{" "}
          <strong>수탁자(processor)</strong> 의 지위에 있으며, 개인정보보호법상{" "}
          <strong>개인정보처리자(controller)</strong> 는 채용기업입니다. 따라서
          후보자(지원자)로부터 적법한 동의를 취득할 책임은 채용기업에 있습니다.
        </p>
        <ol className="list-decimal list-inside space-y-1 text-sm">
          <li>
            이용자는 본 서비스에 이력서·자기소개서·포트폴리오 등 후보자 정보를
            업로드하기 전, 해당 후보자에게 다음 사항을 적법하게 고지하고, 그중
            동의가 필요한 사항에 대해서는 후보자로부터 적법한 동의를 취득할
            책임을 진다.
            <ul className="list-disc list-inside ml-5 mt-1 space-y-0.5 text-ink-soft">
              <li>{COMPANY_INFO.name} 에 대한 개인정보 처리위탁 (PIPA §26)</li>
              <li>
                Vercel Inc.(미국)·Turso(일본 도쿄) 등 인프라 단계 국외 처리자로의
                이전 (PIPA §28의8, 별도 동의 필요)
              </li>
              <li>AI 자동화 평가 적용 사실 및 거부권 고지 (PIPA §37의2)</li>
              <li>채용 종료 시까지의 보유·이용</li>
            </ul>
          </li>
          <li>
            이용자가 전항의 동의를 취득하지 않은 상태에서 본 서비스에 후보자
            정보를 업로드한 경우, 그로 인해 발생하는 법적·행정적·민사적 책임
            중 <strong>이용자(개인정보처리자) 지위에서 부담하는 부분</strong>
            은 이용자가 부담한다. 단, 회사가 수탁자로서 개인정보 보호법에 따라
            부담하는 안전조치 의무(§29), 침해 신고 의무(§34), 정보주체 권리
            대응 의무 등은 본 조항에 의해 면제되지 아니한다.
          </li>
          <li>
            회사는 동의 취득을 돕기 위해{" "}
            <Link
              href="/legal/applicant-consent-template"
              className="text-primary hover:underline"
            >
              표준 안내·동의 문구 템플릿
            </Link>
            을 제공한다. 이용자는 본 템플릿을 채용 공고의 상세 내용(본문)에
            게시하여 AI 평가 적용 사실·거부권을 고지하거나, 자체 지원폼·동의서에
            등록하여 후보자로부터 명시적 동의(체크박스·서명)를 받을 수 있다.
          </li>
          <li>
            업로드 화면의 &quot;지원자 동의 확인&quot; 체크박스 클릭은 이용자가
            전항의 동의를 적법하게 취득했음을 회사에 진술·보증하는 의사표시이며,
            회사는 이용자의 진술·보증을 신뢰하여 처리위탁 업무를 수행한다.
            이용자의 진술·보증이 사실과 다른 것으로 밝혀져 회사에 손해(과징금·
            과태료·소송비용·합의금·평판 회복 비용 등 일체)가 발생한 경우,
            이용자는 회사를 그 손해로부터 면책(indemnify)시키고 회사의 손해를
            배상한다.
          </li>
          <li>
            이용자는 후보자에게 면접 링크를 보낼 때, 본 서비스가 AI 평가를
            사용한다는 사실을 사전에 안내해야 한다.
          </li>
          <li>
            이용자(채용기업)는 인공지능 기본법상 고영향 인공지능의
            이용사업자로서, 지원자에게 AI 평가 활용 사실을 고지할 의무 이행에
            협력하여야 한다.
          </li>
          <li>
            서비스를 차별적·불공정·불법적 채용 목적으로 사용해서는 안 된다.
            (채용절차의 공정화에 관한 법률 §4의2·§4의3 준수)
          </li>
          <li>
            본 서비스의 이메일 발송 기능(면접 안내 등)은 채용 절차 수행 목적에
            한정되며, 이용자는 이를 영리목적 광고성 정보 전송에 사용할 수 없다.
          </li>
          <li>
            계정 정보를 타인과 공유하거나 권한 없는 사용을 허용해서는 안 된다.
          </li>
          <li>
            이용자는 회사가 개인정보 처리방침에 공개된 수탁자(클라우드·AI·메일
            발송 등)에게 업무를 재위탁하는 것에 동의하며, 수탁자 변경 시
            처리방침 갱신으로 고지한다.
          </li>
        </ol>
      </Section>

      <Section n="6" title="회사의 의무">
        <ul className="list-disc list-inside space-y-1">
          <li>회사는 법령과 본 약관을 준수하며 서비스를 안정적으로 제공합니다.</li>
          <li>
            회사는 이용자 및 후보자의 개인정보를 보호하기 위해 별도
            <Link href="/privacy" className="text-primary hover:underline mx-1">
              개인정보 처리방침
            </Link>
            을 두고 이를 준수합니다.
          </li>
          <li>
            회사는 자동화 의사결정 (AI 평가) 의 결과에 대한 설명 요청 및
            이의제기를 받을 수 있는 창구를 운영합니다.
          </li>
        </ul>
      </Section>

      <Section n="7" title="토큰 및 결제">
        <ul className="list-disc list-inside space-y-1">
          <li>
            토큰 단가는 시스템관리자가 정하며 변동될 수 있습니다. 변경 시점
            이후의 사용분에만 새 단가가 적용됩니다 (소급 적용 없음). 단가 인상
            시 7일 전 서비스 내 공지하며, 인상에 동의하지 않는 법인은 미사용
            유상 토큰의 환급을 청구할 수 있습니다.
          </li>
          <li>
            진행 중인 평가·면접은 잔액이 부족해도 완료되며, 그 차감분으로
            잔액이 마이너스가 될 수 있습니다. 잔액이 0 이하인 동안에는 신규
            이력서 업로드·평가·AI 면접·이메일 발송이 제한됩니다. 마이너스
            잔액에는 이자·연체료가 부과되지 않으며 다음 충전 시 자동으로 우선
            차감(상계)됩니다.
          </li>
          <li>
            이력서 평가·AI 면접은 기능이 성공한 경우에만 토큰이 차감되며, 실패
            시에는 차감되지 않습니다.
          </li>
          <li>
            <strong>토큰 유효기간</strong>: 유상으로 충전한 토큰의 유효기간은
            충전일로부터 1년이며, 유효기간 내 미사용 유상 잔액은 환불
            정책(제7-2조)에 따라 환급을 청구할 수 있습니다. 유효기간이 지난
            토큰은 소멸합니다. 무상으로 지급된 토큰(쿠폰·보너스)의 유효기간은
            지급 시 안내된 기간을 따릅니다.
          </li>
          <li>
            <strong>양도·환금 제한</strong>: 토큰은 충전한 법인 계정에
            귀속되며, 다른 법인이나 개인에게 양도·판매하거나 현금으로 교환할
            수 없습니다 (환불 정책에 따른 환급은 예외).
          </li>
        </ul>
      </Section>

      <Section n="7-2" title="환불 정책">
        <p>
          회사는 법정 의무 적용 여부와 무관하게 다음 환불 기준을 적용합니다.
        </p>
        <ul className="list-disc list-inside space-y-1">
          <li>
            <strong>결제 후 7일 이내</strong>: 전액 환불합니다.
          </li>
          <li>
            <strong>7일 경과 후</strong>: 유상 충전분의 미사용 잔액은 언제든
            환급을 청구할 수 있습니다 (환급 수수료 10% 이내 공제 가능, 무상
            지급분·보너스 토큰은 제외).
          </li>
          <li>
            <strong>강제 해지 시</strong>: 약관 위반으로 강제 해지된 경우에도
            유상 충전분의 미사용 잔액은 환급합니다.
          </li>
          <li>
            <strong>환불 신청 방법</strong>: 법인 관리자가 시스템관리자
            (<a href={`mailto:${COMPANY_INFO.email}`} className="text-primary hover:underline">{COMPANY_INFO.email}</a>)에게
            이메일로 사업자등록번호 및 환불 사유와 함께 요청합니다.
          </li>
          <li>
            <strong>환불 처리 기간</strong>: 신청 접수 후 영업일 기준 7일 이내
            결제 수단으로 환불됩니다 (PG사 정책에 따른 지연 가능).
          </li>
        </ul>
      </Section>

      <Section n="8" title="서비스의 중지 및 변경">
        회사는 시스템 점검·확장·교체 등 부득이한 사유로 서비스 제공을 일시
        중단할 수 있으며, 사전 공지가 어려운 긴급한 경우 사후 공지할 수 있습니다.
        회사의 귀책사유로 상당 시간 서비스 장애가 발생한 경우 해당 기간 차감된
        토큰을 환불하거나 보상 토큰을 지급합니다.
      </Section>

      <Section n="9" title="면책">
        <ul className="list-disc list-inside space-y-1">
          <li>
            회사는 천재지변, DDoS, 외부 서비스(Google AI, Vercel 등) 장애 등
            불가항력으로 인한 서비스 제공 불능에 대해 책임지지 않습니다.
          </li>
          <li>
            AI 평가 결과는 채용 결정의 참고 자료일 뿐, 최종 합·불 책임은
            법인(이용자)에 있습니다.
          </li>
          <li>
            이용자가 후보자에게 적법한 동의를 받지 않고 서비스를 사용함으로써
            발생한 분쟁에 대해 회사는 책임지지 않습니다.
          </li>
        </ul>
      </Section>

      <Section n="10" title="계약 해지">
        이용자는 언제든 회원 탈퇴를 요청할 수 있으며, 회사는 즉시 계정 및
        관련 데이터를 처리방침에 따라 폐기합니다. 단, 법령 보존 의무가 있는
        항목은 의무 기간 동안 보존합니다. 법인 이용계약 종료(해지·탈퇴) 시
        유상 충전분 미사용 잔액은 환불 정책에 따라 환급하고, 무상 지급분은
        소멸하며, 마이너스 잔액은 종료 전 정산하여야 합니다.
      </Section>

      <Section n="11" title="준거법 및 관할">
        본 약관은 대한민국 법률에 따라 해석·집행되며, 서비스와 관련하여 분쟁이
        발생할 경우 회사 소재지를 관할하는 법원을 전속관할로 합니다.
      </Section>

      <Section n="12" title="약관의 개정">
        <ul className="list-disc list-inside space-y-1">
          <li>
            회사는 약관을 개정할 경우 시행일 7일 전(이용자에게 불리하거나
            중대한 변경은 30일 전)까지 서비스 내 공지 및 법인 관리자 이메일로
            통지합니다.
          </li>
          <li>
            이용자는 개정 약관 시행일 전까지 거부 의사를 표시하고 이용계약을
            해지할 수 있으며, 시행일까지 거부 의사를 표시하지 않으면 개정
            약관에 동의한 것으로 봅니다.
          </li>
          <li>해지 시 미사용 유상 토큰은 환불 정책에 따라 환급합니다.</li>
        </ul>
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
