import {
  COMPANY_INFO,
  SITE_INFO,
  PROCESSORS,
} from "@/lib/site-info";
import { buildApplicantConsentTemplate } from "@/lib/consent-template";
import { CopyButton } from "@/app/components/CopyButton";
import { BackLink } from "@/app/components/BackLink";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { jobPostings } from "@/lib/schema";
import { ownsOrg } from "@/lib/tenant";
import { eq } from "drizzle-orm";

export const metadata = {
  title: `지원자 안내 문구 — ${SITE_INFO.serviceName}`,
};

/**
 * 채용기업(고객사)이 공고 상세 내용(본문) 또는 자체 지원폼에
 * 그대로 복붙해서 쓸 수 있는 표준 안내 문구.
 *
 * 톤 원칙: HR 이 겁먹지 않도록 "30초 1단계" 액션을 맨 위에, 법조문·책임 배분은
 * 맨 아래 접힘 섹션으로. 법적 효력(약관 §5 진술·보증)은 그대로 유지.
 */
export default async function ApplicantConsentTemplatePage({
  searchParams,
}: {
  searchParams: Promise<{ jobId?: string }>;
}) {
  // 특정 공고에서 진입(?jobId=)하면 그 공고의 채용 담당자 이메일을 안내문에 주입.
  // 본인 소속 공고만 조회 — 타 법인 연락처 열람 차단.
  const sp = await searchParams;
  let contactEmail: string | null = null;
  if (sp.jobId) {
    const me = await getCurrentUser();
    if (me) {
      const [job] = await db
        .select({
          orgId: jobPostings.orgId,
          email: jobPostings.recruitingContactEmail,
        })
        .from(jobPostings)
        .where(eq(jobPostings.id, Number(sp.jobId)));
      if (job && ownsOrg(me, job.orgId)) contactEmail = job.email;
    }
  }
  const {
    koreanShort,
    korean: koreanTemplate,
    english: englishTemplate,
  } = buildApplicantConsentTemplate(contactEmail ?? undefined);

  return (
    <main className="max-w-3xl mx-auto w-full px-6 py-10">
      <BackLink fallbackHref="/" label="← 뒤로" />
      <h1 className="text-2xl font-bold text-ink mt-3">
        지원자 안내 문구 — 복사해서 공고에 붙여넣기
      </h1>

      {/* 안심 톤 — 무엇을 더 할 필요가 없는지 먼저 말한다 */}
      <section className="mt-4 rounded-lg border border-success bg-success-soft p-4 text-sm text-success">
        <div className="font-semibold mb-1">✅ 딱 1단계, 30초면 끝납니다</div>
        <p className="leading-relaxed">
          AI 채용은 지원자에게 <strong>“AI 평가를 활용한다”</strong> 는 안내만
          보이면 됩니다. <strong>새 시스템도, 별도 계약도 필요 없어요.</strong>{" "}
          지금 쓰시는 채용 플랫폼(사람인·잡코리아) 공고에 아래 문구 한 번만
          넣으면 법적 안내 의무가 충족됩니다.
        </p>
      </section>

      {/* 이게 되는지도 모르는 분이 많아서 — 개념부터 쉽게 */}
      <section className="mt-5 rounded-lg border border-border-default bg-card p-4">
        <div className="text-sm font-semibold text-ink mb-1">
          💡 “공고에 동의 항목을 넣는다고요?”
        </div>
        <p className="text-sm text-ink-soft leading-relaxed">
          어렵지 않아요. 사람인·잡코리아 공고를 올릴 때 직무·자격요건을 적는{" "}
          <strong>‘상세 내용(모집 요강)’ 영역</strong>이 있죠? 거기엔 아래{" "}
          <strong>짧은 안내문(3~4줄)</strong>만 넣으면 됩니다 — 긴 전문을 통째로
          넣을 필요 없어요. (처리위탁·국외이전까지 담은 전체 문구는 자체
          지원폼에서 체크 동의받을 때만 쓰면 됩니다.)
        </p>
        <p className="text-sm text-ink-soft leading-relaxed mt-2">
          꼭 플랫폼 기능이 아니어도 괜찮아요.{" "}
          <strong>자체 지원폼이나 지원 안내 메일</strong>로도 됩니다 — 상황별
          방법은{" "}
          <a href="#how" className="text-primary hover:underline">
            아래에서 하나씩
          </a>{" "}
          알려드릴게요.
        </p>
      </section>

      {/* ① 공고 본문용 — 짧은 안내문 (핵심) */}
      <section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
          <h2 className="text-base font-semibold text-ink">
            ① 공고 본문에 넣는 짧은 안내문
          </h2>
          <CopyButton
            text={koreanShort}
            label="짧은 안내문 복사"
            copiedLabel="복사됐어요"
          />
        </div>
        <p className="text-xs text-ink-muted mb-2">
          대부분 이거 하나면 됩니다. 공고 ‘상세 내용’ 맨 아래에 그대로
          붙여넣으세요.
        </p>
        <pre className="rounded-lg border border-border-default bg-surface-alt p-4 text-xs whitespace-pre-wrap font-mono text-ink leading-relaxed">
          {koreanShort}
        </pre>
        {contactEmail ? (
          <p className="text-[11px] text-success mt-1.5">
            ✓ 이 공고의 채용 담당자 이메일(
            <span className="font-mono">{contactEmail}</span>)이 자동으로
            채워졌습니다. 그대로 복사해 공고에 붙여넣으세요.
          </p>
        ) : (
          <p className="text-[11px] text-ink-muted mt-1.5">
            <strong className="text-ink-muted">[채용 담당 연락처]</strong> 부분은{" "}
            <strong className="text-ink-muted">반드시</strong> 회사 이메일로
            바꿔서 넣어주세요. 비워 두면 지원자의 거부·이의제기 통로가 없어 안내
            효력이 약해집니다. (AI 평가 기준·절차 안내 링크는 자동으로
            채워집니다.)
          </p>
        )}
      </section>

      {/* ② 자체 지원폼/동의서용 — 전체 문구 (체크박스 동의용, 접힘) */}
      <section className="mt-6">
        <details className="rounded-lg border border-border-default bg-card">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink select-none flex items-center justify-between gap-2">
            <span>② 자체 지원폼·동의서용 전체 문구 (체크박스 동의용)</span>
            <span className="text-xs text-ink-muted shrink-0">펼치기</span>
          </summary>
          <div className="px-4 pb-4">
            <p className="text-xs text-ink-muted mb-2">
              구글폼·자사 채용페이지 등에서 <strong>체크박스 동의</strong>까지 받을
              때 쓰는 전체 문구입니다 (처리위탁·국외이전·보유기간 포함).{" "}
              <strong>공고 본문에는 위 ① 짧은 안내문이면 충분</strong>해요.
            </p>
            <div className="flex justify-end mb-2">
              <CopyButton
                text={koreanTemplate}
                label="전체 문구 복사"
                copiedLabel="복사됐어요"
              />
            </div>
            <pre className="rounded-lg border border-border-default bg-surface-alt p-4 text-xs whitespace-pre-wrap font-mono text-ink leading-relaxed">
              {koreanTemplate}
            </pre>
          </div>
        </details>
      </section>

      {/* 어디에 어떻게 넣나요 — 상황별 (메뉴 이름에 의존하지 않게 + 못 찾을 때 대비) */}
      <section id="how" className="mt-10 scroll-mt-4">
        <h2 className="text-base font-semibold text-ink">
          어디에, 어떻게 넣나요?
        </h2>
        <p className="text-sm text-ink-soft mt-1">
          아래 셋 중 <strong>아무거나 하나</strong>만 하면 됩니다. 가장 편한
          방법을 고르세요.
        </p>

        <div className="mt-4 space-y-3">
          {/* 방법 1 — 공고 상세 내용(본문) */}
          <div className="rounded-lg border border-border-default bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="shrink-0 rounded-md bg-primary/10 text-primary text-[11px] font-semibold px-2 py-0.5">
                방법 1 · 가장 쉬움
              </span>
              <span className="text-sm font-semibold text-ink">
                공고 ‘상세 내용(모집 요강)’에 넣기
              </span>
            </div>
            <ol className="mt-2.5 space-y-1.5 text-sm text-ink-soft list-decimal list-inside leading-relaxed">
              <li>
                사람인·잡코리아 공고 <strong>등록(또는 수정)</strong> 화면에서,
                직무·자격요건을 적는{" "}
                <strong>‘상세 모집내용(상세 요강)’</strong> 큰 입력칸으로 갑니다.
              </li>
              <li>
                맨 아래에 위 <strong>① 짧은 안내문</strong>을 그대로 붙여넣습니다.{" "}
                <span className="text-ink-muted">
                  (문구에 ‘■ AI 평가 활용 안내’ 제목이 이미 포함돼 있어요)
                </span>
              </li>
              <li>
                저장하면 끝. 지원자가 공고를 볼 때 이 안내가 함께 보입니다.
              </li>
            </ol>
            <p className="mt-2.5 text-xs text-ink-muted leading-relaxed">
              사람인·잡코리아에 회사가 임의로 ‘필수 동의 체크박스’를 추가하는
              별도 칸은 없는 경우가 많아요. 그래서{" "}
              <strong className="text-ink-soft">
                상세 내용 본문에 짧은 안내문을 넣는 것
              </strong>
              이 가장 확실하고 빠릅니다. 체크 형태의 ‘동의’까지 받고 싶다면 방법
              2를 쓰세요.
            </p>
          </div>

          {/* 방법 2 — 자체 지원폼 */}
          <div className="rounded-lg border border-border-default bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="shrink-0 rounded-md bg-success-soft text-success text-[11px] font-semibold px-2 py-0.5">
                방법 2 · 가장 확실
              </span>
              <span className="text-sm font-semibold text-ink">
                자체 지원폼(구글폼·자사 채용페이지)에 넣기
              </span>
            </div>
            <p className="mt-2 text-sm text-ink-soft leading-relaxed">
              지원자가 이메일이나 자체 폼으로 지원한다면, 그 폼/동의서에 위{" "}
              <strong>② 전체 문구</strong>와 <strong>필수 체크박스</strong>를
              넣으세요. 받은 동의 기록은 분쟁 대비 <strong>5년 보관</strong>을
              권장합니다.
            </p>
            <p className="mt-2 text-xs text-ink-muted leading-relaxed">
              건강·이력 등 민감정보가 오갈 수 있는 직군이거나 합·불 영향이 큰
              채용이라면{" "}
              <strong className="text-ink-soft">
                이 방법(체크박스 동의)을 권장
              </strong>
              합니다. 공고 본문 안내(방법 1)는 ‘고지’라, 분쟁 시 “지원자가
              봤다·동의했다”는 사실을 입증하기 어렵습니다.
            </p>
          </div>

          {/* 방법 3 — 안내 메일 */}
          <div className="rounded-lg border border-border-default bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="shrink-0 rounded-md bg-surface-alt text-ink-soft text-[11px] font-semibold px-2 py-0.5">
                방법 3 · 보조
              </span>
              <span className="text-sm font-semibold text-ink">
                지원 접수 후 첫 안내 메일에 넣기
              </span>
            </div>
            <p className="mt-2 text-sm text-ink-soft leading-relaxed">
              지원자에게 보내는 <strong>첫 안내 메일·문자</strong>에 위 문구를
              넣고, “회신 시 동의로 간주” 또는 동의 링크를 안내하세요. 플랫폼
              기능을 못 찾을 때의 보조 수단입니다.
            </p>
          </div>
        </div>

        {/* 못 찾을 때 안심 */}
        <div className="mt-4 rounded-lg border border-warning bg-warning-soft p-3.5 text-sm text-warning">
          <div className="font-medium mb-0.5">플랫폼에서 못 찾으시겠어요?</div>
          <p className="text-[13px] leading-relaxed">
            메뉴 이름은 자주 바뀝니다. 못 찾아도 괜찮아요 —{" "}
            <strong>방법 2·3</strong>으로도 법적 안내 의무는 충족됩니다. 그래도
            막히면{" "}
            <a
              href={`mailto:${COMPANY_INFO.email}`}
              className="underline hover:text-warning"
            >
              {COMPANY_INFO.email}
            </a>{" "}
            로 문의 주세요. 같이 봐드릴게요.
          </p>
        </div>
      </section>

      {/* 영어 — 외국인 지원자 대비 (접힘) */}
      <section className="mt-6">
        <details className="rounded-lg border border-border-default bg-card">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink select-none flex items-center justify-between">
            <span>English (외국인 지원자 대비)</span>
            <span className="text-xs text-ink-muted">펼치기</span>
          </summary>
          <div className="px-4 pb-4">
            <div className="flex justify-end mb-2">
              <CopyButton
                text={englishTemplate}
                label="Copy (English)"
                copiedLabel="Copied"
              />
            </div>
            <pre className="rounded-lg border border-border-default bg-surface-alt p-4 text-xs whitespace-pre-wrap font-mono text-ink leading-relaxed">
              {englishTemplate}
            </pre>
          </div>
        </details>
      </section>

      {/* 법적 배경 — 궁금한 사람만 (접힘) */}
      <section className="mt-8">
        <details className="rounded-lg border border-border-default bg-surface-alt/60">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink select-none flex items-center justify-between">
            <span>법적 근거가 궁금하다면 (선택)</span>
            <span className="text-xs text-ink-muted">펼치기</span>
          </summary>
          <div className="px-4 pb-5 pt-1 space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-ink mb-1">
                왜 이 문구가 필요한가요?
              </h3>
              <p className="text-sm text-ink-soft leading-relaxed">
                개인정보보호법은 AI(자동화) 평가를 적용할 때 지원자에게 그 사실을{" "}
                <strong>고지</strong>하고 <strong>거부·이의제기 권리</strong>를
                보장하도록 합니다(§37의2). 또 이력서가 {SITE_INFO.serviceName}{" "}
                등 처리위탁 수탁자를 거치는 점(§26)도 함께 안내하면 가장
                안전합니다. 위 한 문구가 이 안내를 모두 담고 있어, 별도로 더
                준비하실 것은 없습니다.
              </p>
              <p className="text-xs text-ink-muted leading-relaxed mt-2">
                참고: <strong>‘AI 평가를 쓴다’는 안내(고지)</strong>는 지원자가
                보는 곳(공고 상세 내용)에 적어두면 됩니다 — 별도 체크박스가 꼭
                필요한 건 아니에요(§37의2 는 고지 + 거부권 보장이 요건).
                국외이전·처리위탁처럼 ‘동의’가 필요한 부분은 지원자가 면접에
                들어올 때 {SITE_INFO.serviceName} 동의 화면에서 한 번 더
                받으므로, 공고 단계에선 본문 안내로 충분합니다. 더 꼼꼼히 하려면
                자체 지원폼에 체크박스를 두세요(방법 2).
              </p>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-ink mb-1">
                책임은 누구에게 있나요?
              </h3>
              <p className="text-sm text-ink-soft leading-relaxed">
                지원자 안내·동의 취득의 주체는 채용을 진행하는 기업(이용약관 §5)
                입니다. 업로드 화면의 체크는 “공고에 안내 문구를 넣었다”는 확인
                이며, {COMPANY_INFO.name} 은 이를 신뢰하여 위탁 처리를 수행합니다.
                안내 문구·표준 템플릿·마스킹·서울 리전 처리 등 실무 부담을 줄이는
                장치는 모두 {SITE_INFO.serviceName} 이 제공합니다.
              </p>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-ink mb-2">
                현재 등록된 처리위탁 수탁자 (참고)
              </h3>
              <table className="w-full text-xs border border-border-default">
                <thead className="bg-card">
                  <tr>
                    <th className="px-3 py-2 text-left">수탁자</th>
                    <th className="px-3 py-2 text-left">목적</th>
                    <th className="px-3 py-2 text-left">국가</th>
                    <th className="px-3 py-2 text-left">연락처</th>
                  </tr>
                </thead>
                <tbody>
                  {PROCESSORS.map((p) => (
                    <tr key={p.name} className="border-t border-border-default">
                      <td className="px-3 py-2 font-medium text-ink">
                        {p.name}
                      </td>
                      <td className="px-3 py-2 text-ink-soft">{p.purpose}</td>
                      <td className="px-3 py-2 text-ink-soft">{p.country}</td>
                      <td className="px-3 py-2 text-ink-soft break-all">
                        {p.contact}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-ink-muted mt-2">
                전체 항목·보유기간은{" "}
                <Link href="/privacy" className="text-primary hover:underline">
                  개인정보 처리방침
                </Link>{" "}
                §5 참고.
              </p>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-ink mb-2">
                자주 묻는 질문
              </h3>
              <dl className="text-sm text-ink-soft space-y-3 leading-relaxed">
                <div>
                  <dt className="font-medium text-ink">
                    Q. 우리는 사람인·잡코리아에만 공고를 올려요. 더 해야 할 게
                    있나요?
                  </dt>
                  <dd className="mt-1">
                    A. 없습니다. 지금 쓰시는 그 공고의{" "}
                    <strong>‘상세 모집내용’ 본문</strong>에 위 문구를 한 단락
                    넣으시면 됩니다. 새로운 시스템 도입이나 사람인·잡코리아와의
                    별도 계약은 필요 없습니다.
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-ink">
                    Q. 사람인/잡코리아 기본 동의서로는 안 되나요?
                  </dt>
                  <dd className="mt-1">
                    A. 부분적으로만 커버됩니다. 기본 동의서는 “지원 기업이 평가에
                    활용”까지만 포함하고,{" "}
                    <strong>처리위탁·국외이전·자동화 결정 적용</strong>은
                    빠져 있어, 위 안내 문구를 공고 본문에 더해 보완합니다.
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-ink">
                    Q. 자체 지원폼/오프라인 채용은요?
                  </dt>
                  <dd className="mt-1">
                    A. 위 문구를 동의서 양식에 그대로 넣고{" "}
                    <strong>체크박스 또는 서명</strong>을 받으세요. 받은 동의서는
                    분쟁 대비 보관(5년 권장).
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-ink">
                    Q. 지원자가 AI 평가를 거부하면?
                  </dt>
                  <dd className="mt-1">
                    A. 그 지원자는 {SITE_INFO.serviceName} 에 올리지 마시고, 일반
                    채용 절차(사람 면접)로 진행해 주세요. 거부권 보장은 §37의2 의
                    핵심 요건입니다.
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-ink">
                    Q. 이력서에 건강·종교 같은 민감정보가 있으면요?
                  </dt>
                  <dd className="mt-1">
                    A. 채용에 꼭 필요하지 않은 민감정보(건강·종교·노조·정치성향
                    등)는 공고에서 요구하지 마세요. {SITE_INFO.serviceName} 은 평가
                    단계에서 이런 항목을 자동 마스킹하지만,{" "}
                    <strong>수집·저장 단계의 책임은 채용기업</strong>에 있으므로
                    처음부터 받지 않는 것이 가장 안전합니다.
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </details>
      </section>

      <hr className="my-8 border-border-default" />
      <div className="text-xs text-ink-muted space-y-1">
        <div>
          본 템플릿은 일반적 가이드입니다. 채용 형태·산업 특성에 따라 법무 검토가
          필요할 수 있습니다.
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
