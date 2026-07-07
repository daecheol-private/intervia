import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronDown, ArrowRight } from "lucide-react";
import { SITE_INFO } from "@/lib/site-info";
import { WELCOME_BONUS_TOKENS } from "@/lib/tokens";
import { TOKEN_KRW } from "@/lib/beta";

export const metadata = {
  title: `자주 묻는 질문 — ${SITE_INFO.serviceName}`,
  description:
    "Intervia 의 서비스·요금·AI 평가·면접 진행·데이터 보안에 대해 자주 묻는 질문을 모았습니다.",
};

const linkCls = "text-primary hover:underline";

export default function FaqPage() {
  const welcomeKrw = (WELCOME_BONUS_TOKENS * TOKEN_KRW).toLocaleString();

  const GROUPS: { category: string; items: { q: string; a: ReactNode }[] }[] = [
    {
      category: "서비스 일반",
      items: [
        {
          q: "Intervia 는 어떤 서비스인가요?",
          a: (
            <>
              채팅 기반 AI 면접으로 후보자를 평가하는 채용 플랫폼입니다. 공고
              등록, 이력서 자동 평가, AI 면접, 일정 조율, 대면 면접 녹음 평가,
              결과 리포트·통보까지 채용 한 사이클을 지원합니다.{" "}
              <Link href="/how-it-works" className={linkCls}>
                작동 방식
              </Link>
              에서 순서를 볼 수 있습니다.
            </>
          ),
        },
        {
          q: "어떤 기업에 적합한가요?",
          a: "회사 이메일 도메인으로 가입하는 법인 대상입니다. 서류·면접 평가에 드는 반복 업무를 줄이려는 채용팀에 맞습니다.",
        },
        {
          q: "무료로 써볼 수 있나요?",
          a: `네. 신규 법인 가입 시 ${WELCOME_BONUS_TOKENS}토큰(약 ${welcomeKrw}원)을 무료로 드립니다. 신용카드 등록이 필요 없습니다.`,
        },
      ],
    },
    {
      category: "요금 · 결제",
      items: [
        {
          q: "토큰이 무엇인가요?",
          a: (
            <>
              기능을 쓸 때 차감되는 크레딧입니다. 100원 = 1토큰이며, 월 구독료는
              없습니다. 기능별 단가는{" "}
              <Link href="/pricing" className={linkCls}>
                요금
              </Link>{" "}
              페이지에서 확인할 수 있습니다.
            </>
          ),
        },
        {
          q: "평가가 실패하면 환불되나요?",
          a: "기능이 성공할 때만 토큰이 차감됩니다. 실패했을 때는 차감되지 않습니다. 진행 중인 평가·면접은 잔액이 부족해도 끝까지 완료됩니다.",
        },
        {
          q: "토큰에 유효기간이 있나요?",
          a: "유상 충전 토큰의 유효기간은 충전일로부터 5년입니다. 토큰은 양도·환금할 수 없습니다.",
        },
      ],
    },
    {
      category: "AI 평가",
      items: [
        {
          q: "AI 가 합격·불합격을 결정하나요?",
          a: (
            <>
              아니요. AI 는 점수와 의견을 제시할 뿐, 최종 합·불은 반드시 사람이
              결정합니다. 평가 기준은{" "}
              <Link href="/legal/ai-evaluation-disclosure" className={linkCls}>
                AI 평가 사전공개
              </Link>
              에서 전부 공개합니다.
            </>
          ),
        },
        {
          q: "개인정보는 어떻게 보호되나요?",
          a: (
            <>
              AI 에 전달하기 전 이름·연락처·학교 등 식별정보를 자동 마스킹합니다.
              AI 추론은 서울 리전에서 처리되어 국외로 이전되지 않습니다.{" "}
              <Link href="/security" className={linkCls}>
                보안·데이터 보호
              </Link>{" "}
              참고.
            </>
          ),
        },
        {
          q: "평가가 특정 집단에 편향되지 않나요?",
          a: "성별·나이·출신학교 등 채용절차법상 평가 금지 항목은 자동 마스킹과 평가 금지 지시로 이중 차단합니다. 지원자는 평가 결과에 이의를 제기할 수 있습니다.",
        },
      ],
    },
    {
      category: "면접 진행",
      items: [
        {
          q: "지원자는 어떻게 면접을 보나요?",
          a: "메일·카카오톡으로 받은 링크를 누르면 인성검사 → 직무 역량 → 심층 면접을 채팅 또는 음성으로 봅니다. 앱 설치가 필요 없습니다.",
        },
        {
          q: "외부 AI 로 대신 답하는 부정행위는 어떻게 막나요?",
          a: "붙여넣기·탭 이탈을 집계하고 답변 문체로 대필 가능성을 보조 판단합니다. 이 신호는 단독으로 합·불을 결정하지 않고 채용 담당자의 참고 자료로만 제공됩니다.",
        },
        {
          q: "대면 면접도 지원하나요?",
          a: "네. 1·2차 대면 면접을 녹음 파일로 올리거나 브라우저에서 라이브로 받아쓰면 화자를 분리해 평가 리포트를 만듭니다. 녹음 파일은 전사 후 보관하지 않습니다.",
        },
      ],
    },
    {
      category: "데이터 · 보안",
      items: [
        {
          q: "데이터는 어디에 저장되나요?",
          a: (
            <>
              AI 추론은 서울 리전(국내)에서 처리합니다. 저장 등 일부 인프라는
              해외 클라우드에 위탁되며, 국외이전 현황은{" "}
              <Link href="/privacy" className={linkCls}>
                개인정보 처리방침
              </Link>
              에 투명하게 공개합니다.
            </>
          ),
        },
        {
          q: "이력서 원본은 얼마나 보관하나요?",
          a: "이력서 원본 파일은 합·불 결정 시점에 즉시 폐기합니다. 평가 결과는 채용 공고 종결 후 14일 뒤 자동 삭제됩니다.",
        },
      ],
    },
    {
      category: "시작하기",
      items: [
        {
          q: "어떻게 시작하나요?",
          a: "회사 이메일로 가입하고 첫 공고를 등록하면 됩니다. 공고별 '지원하기' 링크를 채용 사이트·홈페이지에 붙여넣어 지원을 받거나, 보유 이력서를 직접 업로드할 수 있습니다.",
        },
        {
          q: "지원자는 어떻게 모으나요?",
          a: "공고마다 전용 지원 링크가 생깁니다. 사람인·잡코리아 등에 그 링크를 넣거나 회사 홈페이지·메일로 공유하면 지원자가 직접 이력서를 올립니다.",
        },
      ],
    },
  ];

  return (
    <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      <Link href="/" className="text-xs text-ink-muted hover:underline">
        ← 홈
      </Link>
      <h1 className="text-2xl font-bold text-ink mt-3">자주 묻는 질문</h1>
      <p className="text-sm text-ink-soft leading-relaxed mt-2">
        서비스·요금·AI 평가·면접 진행·데이터 보안에 대해 자주 묻는 질문을
        모았습니다. 더 궁금한 점은{" "}
        <a href="mailto:admin.intervia@gmail.com" className={linkCls}>
          도입 문의
        </a>
        로 보내주세요.
      </p>

      {GROUPS.map((g) => (
        <section key={g.category} className="mt-9">
          <h2 className="text-base font-semibold text-ink">{g.category}</h2>
          <div className="mt-1">
            {g.items.map((it) => (
              <details
                key={it.q}
                className="group border-b border-border-default"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3.5 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
                  {it.q}
                  <ChevronDown
                    className="w-4 h-4 shrink-0 text-ink-muted transition-transform group-open:rotate-180"
                    aria-hidden
                  />
                </summary>
                <div className="pb-4 text-sm text-ink-soft leading-relaxed">
                  {it.a}
                </div>
              </details>
            ))}
          </div>
        </section>
      ))}

      {/* CTA */}
      <div className="mt-12 rounded-2xl border border-border-default bg-surface-alt/50 p-6 text-center">
        <p className="text-sm font-semibold text-ink">궁금증이 풀렸다면</p>
        <p className="text-xs text-ink-soft mt-1">
          {WELCOME_BONUS_TOKENS}토큰(약 {welcomeKrw}원) 무료 체험으로 바로 시작해
          보세요.
        </p>
        <Link
          href="/signup"
          className="mt-4 inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-primary text-surface text-sm font-semibold hover:bg-primary-deep transition-colors"
        >
          무료로 시작하기 <ArrowRight className="w-4 h-4" />
        </Link>
        <div className="mt-4 text-xs text-ink-soft">
          <Link href="/how-it-works" className={linkCls}>
            작동 방식
          </Link>{" "}
          ·{" "}
          <Link href="/features" className={linkCls}>
            전체 기능
          </Link>{" "}
          ·{" "}
          <Link href="/pricing" className={linkCls}>
            요금
          </Link>
        </div>
      </div>
    </main>
  );
}
