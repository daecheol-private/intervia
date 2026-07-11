import {
  COMPANY_INFO,
  DPO_INFO,
  PROCESSORS,
  PRIVACY_EFFECTIVE_DATE,
  SITE_INFO,
  APPEAL_CONTACT,
} from "@/lib/site-info";
import Link from "next/link";

export const metadata = {
  title: `${SITE_INFO.serviceName} 개인정보 처리방침`,
};

export default function PrivacyPage() {
  return (
    <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      <Link href="/" className="text-xs text-ink-muted hover:underline">
        ← 홈
      </Link>
      <h1 className="text-2xl font-bold text-ink mt-3">
        {SITE_INFO.serviceName} 개인정보 처리방침
      </h1>
      <p className="text-xs text-ink-muted mt-1">
        시행일: {PRIVACY_EFFECTIVE_DATE}
      </p>

      <p className="text-sm text-ink-soft leading-relaxed mt-6">
        {COMPANY_INFO.name}(이하 &quot;회사&quot;)은 「개인정보 보호법」을
        준수하며, 정보주체의 개인정보를 보호하고 권익을 신속히 처리하기 위해
        다음과 같이 개인정보 처리방침을 수립·공개합니다.
      </p>
      <p className="text-sm text-ink-soft leading-relaxed mt-3">
        지원자(후보자)의 개인정보에 관하여는 채용을 진행하는 기업이
        개인정보처리자이며, 회사는 그로부터 처리를 위탁받은 수탁자의 지위에서
        본 방침이 정하는 바에 따라 처리합니다. 회원(채용기업 소속 사용자)의
        계정 정보에 관하여는 회사가 개인정보처리자입니다.
      </p>

      <Section n="1" title="개인정보의 처리 목적">
        <p>
          회사는 다음 목적으로 개인정보를 처리합니다. 처리 목적이 변경되는 경우
          별도 동의를 받습니다.
        </p>
        <ul className="list-disc list-inside mt-2 space-y-1">
          <li>
            채용 절차 수행 — <strong>사람인·잡코리아 등 채용 플랫폼을 통해
            제공받거나 채용 담당자가 직접 등록한 이력서를 AI 자동 평가(서류
            평가) 및 AI 면접 진행 후, 채용 담당자의 인간 검토를 거쳐 합·불
            결정에 이용</strong>합니다. AI 평가는 채용 결정의 참고 자료이며
            최종 결정은 사람이 합니다.
          </li>
          <li>법인 관리자 계정 인증 및 사용자 관리</li>
          <li>후보자 면접 결과 통지 및 안내 메일 발송</li>
          <li>서비스 부정 이용 방지 및 보안 (Rate limit, 로그인 시도 기록)</li>
        </ul>
      </Section>

      <Section n="2" title="처리하는 개인정보 항목">
        <Table>
          <thead>
            <tr>
              <th>구분</th>
              <th>항목</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>법인 관리자 / 멤버</td>
              <td>이메일, 이름, 비밀번호(해시), 로그인 IP, User-Agent</td>
            </tr>
            <tr>
              <td>후보자</td>
              <td>
                이름, 이메일, 전화번호, 나이, 학력(수준·전공·학교), 이력서
                본문(마스킹), 면접 응답, AI 평가 결과, 면접 입력 행태정보(부정행위
                방지용 — 붙여넣기·타이핑·화면이탈·복사시도 등)
              </td>
            </tr>
            <tr>
              <td>자동 수집</td>
              <td>접속 IP, User-Agent, 면접 동의 시각·버전</td>
            </tr>
          </tbody>
        </Table>
        <p className="mt-3 text-xs text-ink-soft">
          이력서 원본 텍스트는 데이터베이스에 저장되지 않습니다. 정규식으로
          이름·이메일·전화번호·나이만 추출 후 본문은 마스킹 처리하여 저장합니다.
        </p>
      </Section>

      <Section n="3" title="개인정보의 처리·보유 기간 및 파기">
        <Table>
          <thead>
            <tr>
              <th>대상</th>
              <th>보유 기간</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>법인 관리자/멤버 계정</td>
              <td>회원 탈퇴 시까지</td>
            </tr>
            <tr>
              <td>이력서 파일 및 마스킹 본문</td>
              <td>합·불 결정 시점 즉시 폐기</td>
            </tr>
            <tr>
              <td>평가 결과(점수·추천)</td>
              <td>공고 종결 +14일 후 후보자 정보 전체 자동 삭제</td>
            </tr>
            <tr>
              <td>로그인 시도·Rate limit 기록</td>
              <td>30일</td>
            </tr>
            <tr>
              <td>동의 기록</td>
              <td>분쟁 대비 5년 (감사 증거)</td>
            </tr>
          </tbody>
        </Table>
        <p className="mt-3">
          단, 최종 합격자의 정보는 입사 절차 및 인사기록 목적으로 채용기업이
          삭제할 때까지 보유됩니다.
        </p>
        <p>
          파기 사유가 발생한 개인정보는 지체 없이 파기하며, 전자적 파일은
          복구할 수 없는 방법으로 영구 삭제하고, 그 외 기록물은 분쇄·소각합니다.
        </p>
      </Section>

      <Section n="4" title="개인정보의 제3자 제공">
        <p>
          회사는 정보주체의 동의 없이 개인정보를 제3자에게 제공하지 않습니다.
          단, 법령에 따라 수사기관의 적법한 요청이 있는 경우는 예외입니다.
        </p>
        <p>
          회사가 영업의 전부 또는 일부를 양도하거나 합병 등으로 개인정보를
          이전하는 경우 사전에 그 사실을 통지합니다.
        </p>
      </Section>

      <Section n="5" title="개인정보 처리위탁">
        <p>
          회사는 원활한 서비스 제공을 위해 다음과 같이 개인정보 처리를 위탁하고
          있으며, 위탁 대상자 및 업무 내용을 공개합니다. (PIPA §26)
        </p>
        <Table>
          <thead>
            <tr>
              <th>수탁자</th>
              <th>위탁 업무</th>
              <th>위탁 항목</th>
              <th>처리 국가</th>
              <th>보유 기간</th>
              <th>연락처</th>
            </tr>
          </thead>
          <tbody>
            {PROCESSORS.map((p) => (
              <tr key={p.name}>
                <td>{p.name}</td>
                <td>{p.purpose}</td>
                <td>{p.items}</td>
                <td>{p.country}</td>
                <td>{p.retention}</td>
                <td className="break-all">{p.contact}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="mt-3 text-xs text-ink-soft">
          AI 처리(서류 평가·면접 채팅·면접 평가)는 Google Cloud 서울
          리전(asia-northeast3) 에서 수행하는 것을 원칙으로 하며, 서울 리전
          장애 시에 한해 식별가능정보를 자동 마스킹한 텍스트만 Google LLC 일본
          도쿄 리전(asia-northeast1)으로 이전되어 임시 처리될 수 있습니다(이전
          방법: TLS 암호화 API 전송·미저장, 목적: AI 평가·면접 처리, 보유: 응답
          처리 즉시 폐기·학습 미사용, 문의: 위 표의 연락처). 스캔 이력서
          원본(OCR)·음성 데이터는 항상 국내에서만 처리됩니다. 위 임시 처리 및
          호스팅(Vercel·미국)·데이터베이스(Turso·일본 도쿄)·메일
          발송(Resend·미국) 등 인프라 단계의 국외이전은 PIPA §28의8 에 따라 본
          처리방침 공개 및 면접 시작 전 동의로 진행되며, 동의를 거부할 수
          있으나 거부 시 AI 면접 진행이 불가합니다.
        </p>
      </Section>

      <Section n="6" title="정보주체의 권리·의무 및 행사 방법">
        <p>정보주체는 회사에 대해 다음 권리를 행사할 수 있습니다.</p>
        <ul className="list-disc list-inside mt-2 space-y-1">
          <li>개인정보 열람 요구 (PIPA §35)</li>
          <li>오류 정정 및 삭제 요구 (PIPA §36)</li>
          <li>처리 정지 요구 (PIPA §37)</li>
          <li>
            자동화된 결정에 대한 설명 요청·이의 제기·결정 거부 (PIPA §37의2)
          </li>
        </ul>
        <p className="mt-3">
          권리 행사는 <strong>{DPO_INFO.email}</strong> 으로 서면·이메일을
          통해 하실 수 있으며, 회사는 지체 없이 조치합니다.
        </p>
      </Section>

      <Section n="7" title="자동화된 결정에 대한 권리">
        <p>
          회사는 AI(Google Gemini)를 이용하여 이력서 및 면접 응답에 대한 점수와
          추천을 산출합니다. 다만 <strong>최종 합·불 결정은 채용 담당자가
          인간 검토를 거쳐 내리며</strong>, AI 단독으로 결정하지 않습니다.
        </p>
        <p className="mt-2">
          정보주체는 본인에 대한 AI 평가 결과의 의미 및 근거에 대한 설명을 요청
          할 수 있고, 결과에 이의를 제기할 수 있습니다.
        </p>
        <div className="mt-3 text-xs bg-primary-soft border border-primary/30 text-primary-deep rounded-lg px-3 py-2">
          📮 이의제기: <strong>{APPEAL_CONTACT.email}</strong>
          <br />
          {APPEAL_CONTACT.description}
        </div>
      </Section>

      <Section n="8" title="개인정보의 안전성 확보 조치">
        <ul className="list-disc list-inside space-y-1">
          <li>비밀번호 bcrypt 해시 + 10자/3종 정책 + 유출 비밀번호 차단(HIBP)</li>
          <li>이력서 본문 정규식·라벨 기반 PII 마스킹 후 LLM 전달</li>
          <li>법인별 데이터 격리 (org_id 필터)</li>
          <li>로그인 시도 5회 실패 시 15분 잠금</li>
          <li>API rate limit (분당 한도)</li>
          <li>활성 세션 디바이스 목록 및 원격 종료</li>
          <li>SMTP 비밀번호 등 민감 정보 암호화 저장 (예정)</li>
          <li>HTTPS 전송 구간 암호화</li>
        </ul>
      </Section>

      <Section n="9" title="쿠키 등 자동수집장치의 설치·운영 및 거부">
        <p>
          회사는 로그인 세션 유지를 위한 필수 쿠키(httpOnly 세션 쿠키)만
          사용하며, 광고·분석 목적의 쿠키는 사용하지 않습니다. 브라우저 설정에서
          쿠키 저장을 거부할 수 있으나, 거부 시 로그인이 불가합니다.
        </p>
      </Section>

      <Section n="10" title="개인정보 보호책임자">
        <p>
          개인정보 열람·정정·삭제·처리정지 청구는 아래 개인정보 보호책임자에게
          할 수 있으며, 회사는 10일 이내에 조치 결과를 통지합니다.
        </p>
        <Table>
          <tbody>
            <tr>
              <td>성명</td>
              <td>{DPO_INFO.name}</td>
            </tr>
            <tr>
              <td>직책</td>
              <td>{DPO_INFO.title}</td>
            </tr>
            <tr>
              <td>이메일</td>
              <td>{DPO_INFO.email}</td>
            </tr>
          </tbody>
        </Table>
      </Section>

      <Section n="11" title="권익 침해 구제 방법">
        <p>다음 기관에 분쟁 해결·상담을 신청하실 수 있습니다.</p>
        <ul className="list-disc list-inside mt-2 space-y-1">
          <li>개인정보분쟁조정위원회: 1833-6972, www.kopico.go.kr</li>
          <li>개인정보침해신고센터: 118, privacy.kisa.or.kr</li>
          <li>대검찰청 사이버수사과: 1301, www.spo.go.kr</li>
          <li>경찰청 사이버안전국: 182, ecrm.cyber.go.kr</li>
        </ul>
      </Section>

      <Section n="12" title="처리방침의 변경">
        <p>
          본 처리방침은 시행일로부터 적용되며, 법령 및 방침에 따른 변경 내용의
          추가·삭제 및 정정이 있는 경우 변경사항 시행 7일 전 공지합니다.
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

function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border border-border-default rounded mt-2 [&_th]:bg-surface-alt [&_th]:font-medium [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:border-b [&_th]:border-border-default [&_td]:px-3 [&_td]:py-2 [&_td]:border-b [&_td]:border-border-default [&_tr:last-child_td]:border-b-0">
        {children}
      </table>
    </div>
  );
}
