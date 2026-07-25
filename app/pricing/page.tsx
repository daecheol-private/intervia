import Link from "next/link";
import { BackHomeLink } from "@/app/components/BackHomeLink";
import { ArrowRight, Sparkles } from "lucide-react";
import { SITE_INFO } from "@/lib/site-info";
import { WELCOME_BONUS_TOKENS } from "@/lib/tokens";
import {
  LIST_PRICING,
  EFFECTIVE_PRICING,
  BETA,
  CHARGE_PACKAGES,
  CHARGE_BONUS_BOOSTED,
  TOKEN_KRW,
} from "@/lib/beta";
import { getCurrentUser } from "@/lib/auth";

export const metadata = {
  title: `요금 — ${SITE_INFO.serviceName}`,
  description:
    "구독료 없는 토큰 과금. 100원 = 1토큰, 신규 가입 무료 체험, 기능별 단가와 충전 보너스를 안내합니다.",
};

const won = (tokens: number) => (tokens * TOKEN_KRW).toLocaleString();
const priceLabel = (tokens: number) =>
  tokens === 0 ? "무료" : `${won(tokens)}원`;

// 공개 마케팅 페이지 — 정책 표준가(EFFECTIVE_PRICING: 베타 활성 시 베타가, 아니면 정가)를 표시.
// org 별 협상가(token_pricing override)에 노출되지 않도록 getAllPricing() 대신 코드 정책가를 쓴다.
// 정가(LIST_PRICING)와 다르면 취소선으로 함께 노출한다.
export default async function PricingPage() {
  // 로그인 상태에선 좌측 레일 셸 안에서 열리므로 가입 유도 CTA 를 숨긴다(이미 고객).
  const loggedIn = !!(await getCurrentUser());
  const welcomeKrw = (WELCOME_BONUS_TOKENS * TOKEN_KRW).toLocaleString();

  const rows = [
    {
      name: "공고 등록",
      list: LIST_PRICING.job_post,
      now: EFFECTIVE_PRICING.job_post,
      hint: "공고 1건 게시",
    },
    {
      name: "이력서 평가",
      list: LIST_PRICING.resume_upload,
      now: EFFECTIVE_PRICING.resume_upload,
      hint: "PDF 업로드 + AI 서류 평가",
    },
    {
      name: "AI 면접",
      list: LIST_PRICING.interview,
      now: EFFECTIVE_PRICING.interview,
      hint: "후보자 1명 채팅 면접 1회 (인성·직무·심층)",
    },
    {
      name: "면접 문제 생성",
      list: LIST_PRICING.interview_question_gen,
      now: EFFECTIVE_PRICING.interview_question_gen,
      hint: "면접 문제 1건 생성 (1·2차 동일)",
    },
    {
      name: "대면 면접 평가",
      list: LIST_PRICING.offline_interview,
      now: EFFECTIVE_PRICING.offline_interview,
      hint: "녹음·음성 1건 전사 + AI 평가 (1·2차)",
    },
  ];

  return (
    <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      <BackHomeLink />
      <h1 className="text-2xl font-bold text-ink mt-3">요금</h1>
      <p className="text-sm text-ink-soft leading-relaxed mt-2">
        월 구독료가 없습니다. 쓴 만큼만 토큰으로 차감되는 방식이라, 채용이 없는
        달엔 비용도 없습니다.{" "}
        <strong className="text-ink">100원 = 1토큰</strong> (VAT 별도).
      </p>

      {BETA.active && (
        <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary-soft px-3.5 py-1.5 text-xs font-medium text-primary-deep">
          <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-surface">
            {BETA.label}
          </span>
          AI 면접·대면 면접 평가 특가 · {BETA.endsAtLabel}까지
        </div>
      )}

      {/* 무료 체험 */}
      <div className="mt-8 rounded-2xl bg-primary p-6 text-surface shadow-lg">
        <div className="text-xs font-semibold uppercase tracking-widest text-surface/70">
          법인 첫 등록 시
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-4xl font-bold tabular-nums text-accent">
            {WELCOME_BONUS_TOKENS}
          </span>
          <span className="text-lg font-medium opacity-80">토큰 무료</span>
          <span className="text-sm opacity-70">≈ {welcomeKrw}원</span>
        </div>
        <p className="mt-2 text-xs opacity-80">
          신규 법인 최초 1회 · 신용카드 등록 불필요 · 성공 시에만 차감
        </p>
      </div>

      {/* 기능별 단가 */}
      <section className="mt-10">
        <h2 className="text-base font-semibold text-ink border-b border-border-default pb-2">
          기능별 단가
        </h2>
        <div className="mt-2">
          {rows.map((r) => (
            <div
              key={r.name}
              className="flex items-center justify-between gap-4 border-b border-border-default py-3.5 last:border-0"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-ink">{r.name}</div>
                <div className="text-xs text-ink-soft mt-0.5">{r.hint}</div>
              </div>
              <div className="shrink-0 text-right">
                {r.list !== r.now && (
                  <span className="mr-1.5 text-xs text-ink-muted line-through">
                    {priceLabel(r.list)}
                  </span>
                )}
                <span className="text-sm font-semibold text-ink">
                  {priceLabel(r.now)}
                </span>
                {r.now > 0 && (
                  <span className="ml-1 text-[11px] text-ink-soft">
                    ({r.now}토큰)
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 충전 보너스 */}
      <section className="mt-10">
        <div className="flex items-center justify-between gap-2 border-b border-border-default pb-2">
          <h2 className="text-base font-semibold text-ink">충전 보너스</h2>
          {CHARGE_BONUS_BOOSTED && (
            <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-bold text-accent-deep">
              <Sparkles className="w-3 h-3" strokeWidth={2.5} aria-hidden />
              오픈베타 2배
            </span>
          )}
        </div>
        <p className="text-xs text-ink-soft mt-2">
          많이 충전할수록 보너스 토큰을 더 드립니다. 결제는 부가가치세(10%)가
          별도 부과됩니다.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {CHARGE_PACKAGES.map((p) => (
            <div
              key={p.krw}
              className={`relative rounded-xl border p-3 text-center ${
                p.popular
                  ? "border-primary/40 bg-primary-soft/40"
                  : "border-border-default bg-card"
              }`}
            >
              <div className="text-sm font-semibold text-ink">
                {(p.krw / 10000).toLocaleString()}만원
              </div>
              {p.bonusPct > 0 ? (
                <div className="mt-0.5 text-xs font-semibold text-primary-deep">
                  +{p.bonusPct}%
                </div>
              ) : (
                <div className="mt-0.5 text-xs text-ink-muted">보너스 없음</div>
              )}
              {p.popular && (
                <span className="mt-1 inline-block rounded-full bg-primary px-1.5 py-px text-[9px] font-bold text-surface">
                  인기
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* 과금 정책 */}
      <section className="mt-10">
        <h2 className="text-base font-semibold text-ink border-b border-border-default pb-2">
          알아두면 좋은 점
        </h2>
        <ul className="mt-3 space-y-2 text-sm text-ink-soft leading-relaxed">
          <li className="flex items-start gap-2">
            <span
              className="mt-2 w-1 h-1 rounded-full bg-primary shrink-0"
              aria-hidden
            />
            <span>
              기능이 성공할 때만 토큰이 차감됩니다. 실패 시에는 차감되지 않습니다.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span
              className="mt-2 w-1 h-1 rounded-full bg-primary shrink-0"
              aria-hidden
            />
            <span>
              진행 중인 평가·면접은 잔액이 부족해도 끝까지 완료됩니다(부족분은
              다음 충전 시 자동 정산). 잔액이 0 이하가 되면 충전 전까지 신규
              작업이 차단됩니다.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span
              className="mt-2 w-1 h-1 rounded-full bg-primary shrink-0"
              aria-hidden
            />
            <span>유상 충전 토큰의 유효기간은 충전일로부터 5년입니다.</span>
          </li>
          <li className="flex items-start gap-2">
            <span
              className="mt-2 w-1 h-1 rounded-full bg-primary shrink-0"
              aria-hidden
            />
            <span>토큰은 양도·환금할 수 없습니다.</span>
          </li>
        </ul>
        {BETA.active && (
          <p className="mt-4 text-xs text-ink-muted">※ {BETA.note}</p>
        )}
      </section>

      {/* CTA — 비로그인 방문자에게만 */}
      {!loggedIn && (
      <div className="mt-12 rounded-2xl border border-border-default bg-surface-alt/50 p-6 text-center">
        <p className="text-sm font-semibold text-ink">
          무료 체험으로 먼저 확인해 보세요
        </p>
        <p className="text-xs text-ink-soft mt-1">
          {WELCOME_BONUS_TOKENS}토큰(약 {welcomeKrw}원) 제공 · 신용카드 등록
          불필요
        </p>
        <Link
          href="/signup"
          className="mt-4 inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-primary text-surface text-sm font-semibold hover:bg-primary-deep transition-colors"
        >
          무료로 시작하기 <ArrowRight className="w-4 h-4" />
        </Link>
        <div className="mt-4 text-xs text-ink-soft">
          <Link href="/how-it-works" className="text-primary hover:underline">
            작동 방식
          </Link>{" "}
          ·{" "}
          <Link href="/features" className="text-primary hover:underline">
            전체 기능
          </Link>{" "}
          ·{" "}
          <Link href="/faq" className="text-primary hover:underline">
            자주 묻는 질문
          </Link>
        </div>
      </div>
      )}
    </main>
  );
}
