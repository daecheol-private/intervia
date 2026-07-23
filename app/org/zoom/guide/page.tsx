import Link from "next/link";

export const metadata = { title: "줌 연동 가이드 — Intervia" };

/**
 * 줌(Zoom) 연동 설명서 — 법인 담당자용. /org/zoom 에서 링크.
 * 원본 문서: docs/ZOOM_SETUP_GUIDE.md (내용 동기화 유지).
 */
export default function ZoomGuidePage() {
  return (
    <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-6">
        <Link
          href="/org/zoom"
          className="text-xs text-ink-muted hover:underline"
        >
          ← 줌 연동 설정
        </Link>
        <h1 className="text-2xl font-bold text-ink mt-2">
          줌(Zoom) 연동 가이드
        </h1>
        <p className="text-sm text-ink-muted mt-1 leading-relaxed">
          회사 줌 계정을 한 번만 연결해 두면, 온라인 면접 시간이 확정될 때 줌
          회의 링크가 자동으로 만들어져 후보자·면접관에게 메일로 발송됩니다.
          설정은 처음 한 번, 약 10분이면 됩니다. 코딩은 필요 없습니다.
        </p>
      </div>

      <div className="space-y-6">
        <Callout>
          <strong>시작하기 전에</strong>
          <ul className="list-disc list-inside mt-1 space-y-0.5">
            <li>회사 줌 계정의 <strong>관리자 권한</strong>이 필요합니다.</li>
            <li>
              줌 <strong>무료 계정</strong>으로도 연동·사용할 수 있습니다(회의가
              40분으로 제한되는 점만 다릅니다).
            </li>
            <li>아래 과정은 <strong>딱 한 번만</strong> 하면 됩니다.</li>
          </ul>
        </Callout>

        <Section title="1단계 · 줌에서 연결 정보 만들기">
          <Step n="①" title="줌 개발자 페이지 접속">
            인터넷 주소창에{" "}
            <a
              href="https://marketplace.zoom.us"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              marketplace.zoom.us
            </a>{" "}
            를 입력해 접속한 뒤, 오른쪽 위 <Kbd>Sign In</Kbd> 으로{" "}
            <strong>회사 관리자 계정</strong>으로 로그인합니다.
            <Warn>
              꼭 회사 관리자 계정으로 로그인하세요. 그래야 회사 회의가
              만들어집니다.
            </Warn>
          </Step>
          <Step n="②" title="새 앱 만들기">
            <strong>왼쪽 아래</strong> <Kbd>Developer</Kbd> 를 누른 뒤, 나오는{" "}
            <Kbd>Created apps</Kbd> 화면에서 <Kbd>Develop</Kbd> →{" "}
            <Kbd>Build an app</Kbd> 을 누릅니다. 여러 종류 중{" "}
            <strong>“Server-to-Server OAuth app”</strong> 를 골라{" "}
            <Kbd>Create</Kbd> 를 누르고, 앱 이름(예: <em>Intervia 면접</em>)을
            적은 뒤 다시 <Kbd>Create</Kbd>.
            <GuideImg
              src="/zoom-2.png"
              alt="줌 마켓플레이스에서 Server-to-Server OAuth app 만들기 화면"
            />
          </Step>
          <Step n="③" title="연결 정보 3개 복사하기 ⭐ 가장 중요">
            앱을 만들면 <Kbd>App credentials</Kbd> 화면에{" "}
            <strong>Account ID</strong>, <strong>Client ID</strong>,{" "}
            <strong>Client Secret</strong> 3개가 나옵니다. 이 3개를 복사해 두세요.
            (잠시 후 Intervia에 붙여넣습니다)
            <Warn>
              Client Secret 은 비밀번호와 같습니다. 다른 사람에게 공유하지
              마세요.
            </Warn>
          </Step>
          <Step n="④" title="빈 칸 채우기 ⭐ 활성화에 필수">
            왼쪽 메뉴 <Kbd>Information</Kbd> 에서 <strong>빨간 별표(*)</strong> 된
            칸을 모두 채웁니다. 아래 네 가지가 비어 있으면 ⑥의{" "}
            <Kbd>Activate</Kbd> 버튼이 <strong>눌리지 않습니다.</strong>
            <ul className="list-disc list-inside mt-1.5 space-y-1">
              <li>
                <strong>Short Description</strong> — 앱 설명. 예: “면접 일정 확정
                시 줌 회의를 자동 생성”{" "}
                <span className="text-ink-muted">
                  (너무 짧으면 거부되니 한 문장 이상)
                </span>
              </li>
              <li>
                <strong>Company Name</strong> — 회사명
              </li>
              <li>
                <strong>Developer Contact Name</strong> — 담당자 이름
              </li>
              <li>
                <strong>Developer Contact Email</strong> — 담당자 이메일
              </li>
            </ul>
            <span className="text-ink-soft">
              형식적인 내용이라 정확히 적기만 하면 됩니다.
            </span>
          </Step>
          <Step n="⑤" title="권한 추가하기 ⭐ 필수">
            <Kbd>Scopes</Kbd> → <Kbd>Add Scopes</Kbd> 를 누릅니다. 창이 뜨면{" "}
            <strong>
              왼쪽 “Product” 목록에서 <Kbd>Meetings</Kbd> 를 클릭
            </strong>
            하세요. 그다음 <strong>“Create a meeting for a user”</strong>(코드:{" "}
            <code className="text-[12px]">meeting:write:meeting:admin</code>) 를
            체크하고 <Kbd>Done</Kbd> 을 누릅니다.
            <GuideImg
              src="/zoom-5.png"
              alt="Meetings 권한(Create a meeting for a user) 추가 화면"
            />
          </Step>
          <Step n="⑥" title="켜기(활성화)">
            왼쪽 메뉴 <Kbd>Activation</Kbd> → <Kbd>Activate</Kbd> 버튼을
            누릅니다. 버튼이 안 눌리면 앞 단계에서 빨간 표시된 빈 칸이 남아 있는
            것입니다. “Activated” 라고 나오면 줌 쪽 준비는 끝입니다.
          </Step>
        </Section>

        <Section title="2단계 · Intervia에 연결 정보 입력하기">
          <ol className="list-decimal list-inside text-sm text-ink-soft space-y-1.5 leading-relaxed">
            <li>
              <Link href="/org/zoom" className="text-primary underline">
                줌 연동 설정
              </Link>{" "}
              화면을 엽니다.
            </li>
            <li>1단계 ③에서 복사한 값 3개를 각 칸에 붙여넣습니다.</li>
            <li>
              <strong>저장 및 연결 테스트</strong> 를 누릅니다. “연결 테스트
              통과” 가 나오면 끝입니다. 🎉
            </li>
          </ol>
        </Section>

        <Section title="사용 방법">
          <p className="text-sm text-ink-soft leading-relaxed">
            면접 일정을 <strong>온라인</strong>으로 잡고 시간이 확정되면, 줌
            회의가 자동으로 만들어지고 그 링크가 후보자·면접관에게 메일로
            발송됩니다. 담당자가 따로 줌 링크를 만들 필요가 없습니다.
          </p>
        </Section>

        <Section title="문제가 생겼을 때">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-ink-muted border-b border-border-default">
                <th className="py-2 pr-3 font-medium">이런 증상이면</th>
                <th className="py-2 font-medium">이렇게 하세요</th>
              </tr>
            </thead>
            <tbody className="text-ink-soft">
              <Trouble
                symptom="연결 테스트가 실패해요"
                fix="값 3개 중 하나를 잘못 복사한 경우입니다. 앞뒤 빈칸 없이 다시 붙여넣어 보세요."
              />
              <Trouble
                symptom="‘권한 없음’ 오류가 나요"
                fix="1단계 ⑤의 회의 만들기 권한이 빠진 것입니다. 권한을 추가하고 다시 활성화하세요."
              />
              <Trouble
                symptom="활성화 버튼이 안 눌려요"
                fix="Information의 빨간 별표 칸(특히 Short Description·Company Name·담당자 이름·이메일)이 비어 있습니다. 1단계 ④의 네 가지를 모두 채운 뒤 다시 누르세요."
              />
              <Trouble
                symptom="회의가 40분 만에 끊겨요"
                fix="줌 무료 요금제의 제한입니다. 유료(Pro 이상)로 올리면 해결됩니다."
              />
            </tbody>
          </table>
        </Section>
      </div>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-card border border-border-default rounded-2xl p-5 sm:p-6 shadow-sm">
      <h2 className="text-base font-bold text-ink mb-3">{title}</h2>
      {children}
    </section>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3 py-2.5 border-t border-border-default first:border-t-0 first:pt-0">
      <div className="text-primary font-bold text-sm shrink-0 w-5">{n}</div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-ink">{title}</div>
        <div className="text-sm text-ink-soft leading-relaxed mt-0.5">
          {children}
        </div>
      </div>
    </div>
  );
}

function GuideImg({ src, alt }: { src: string; alt: string }) {
  return (
    <img
      src={src}
      alt={alt}
      className="mt-3 block w-full max-w-xl mx-auto rounded-lg border border-border-default shadow-sm"
    />
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-primary-soft border border-primary/30 text-primary-deep rounded-xl px-4 py-3 text-sm leading-relaxed">
      {children}
    </div>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-1.5 w-fit max-w-full text-[12px] text-warning bg-warning-soft border border-warning/30 rounded-md px-2.5 py-1.5">
      ⚠️ {children}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block px-1.5 py-0.5 rounded bg-surface-alt border border-border-strong text-[12px] font-medium text-ink-soft">
      {children}
    </span>
  );
}

function Trouble({ symptom, fix }: { symptom: string; fix: string }) {
  return (
    <tr className="border-b border-border-default align-top">
      <td className="py-2 pr-3 font-medium">{symptom}</td>
      <td className="py-2">{fix}</td>
    </tr>
  );
}
