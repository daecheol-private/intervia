/**
 * 가입 환영 메일 — **가입자 전원에게 계정이 쓸 수 있게 된 시점에 최초 1회**.
 *
 * 발송 지점이 둘인 이유: 가입 경로마다 "쓸 수 있게 되는" 순간이 다르다.
 *   · 법인 개설자 → 이메일 인증 완료 (api/auth/verify-email)
 *   · 멤버(초대·자가 합류요청 모두) → 법인 관리자 승인으로 active 전환 (api/orgs/join-requests/[id])
 * 멤버는 가입 직후엔 status=pending 이라 로그인이 막혀 있다 — 그때 보내면 "시작하기" 가
 * 승인 대기 화면으로 떨어진다. 두 지점은 한 사람에게 양쪽이 모두 일어나지 않아 중복이 없다.
 *
 * 왜 인증/승인 시점인가: 미인증(오타) 주소로 보내면 반송이 쌓여 발신 평판이 깎이고,
 * 인증 메일과 동시에 두 통이 가면 인증 클릭률이 떨어진다.
 *
 * 왜 소개서 PDF 를 첨부하지 않고 링크로 주는가: 3MB 첨부는 첫 발신 메일의 스팸 가중치를
 * 올려 면접 초대·일정 메일까지 같이 끌어내리고, 수신자가 전부 사내 메일함이라
 * 기업 게이트웨이가 외부 PDF 첨부를 격리하는 경우가 있다. 링크는 소개서를 다시 찍어도
 * (marketing/brochure/build.mjs --publish) 항상 최신판을 가리킨다.
 *
 * 문구에 단가·토큰·행사가는 넣지 않는다 (소개서와 같은 기준 — 자주 바뀜).
 */
import { db } from "./db";
import { users } from "./schema";
import { eq } from "drizzle-orm";
import { sendMail, EMAIL_BRAND, wrapEmailCard, escapeHtml } from "./mailer";
import { BROCHURE } from "./site-info";
import { TUTORIAL_VIDEOS } from "./tutorial-videos";

/** 본문의 "첫 3단계" — 공고는 채용사이트에 올리고 Intervia 에는 "연결"한다. */
const FLOW_STEPS: ReadonlyArray<{ title: string; detail: string }> = [
  { title: "공고 연결", detail: "채용사이트에 올린 공고를 Intervia 에 연결합니다." },
  { title: "이력서 받기", detail: "지원 링크를 공유하거나 이력서를 직접 올립니다." },
  { title: "AI 면접", detail: "서류평가 결과를 보고 면접 링크를 보냅니다." },
];

function linkRow(opts: {
  href: string;
  label: string;
  desc: string;
}): string {
  return `<tr><td style="padding:0 0 10px;">
    <a href="${opts.href}" style="display:block;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;text-decoration:none;">
      <div style="font-size:14px;font-weight:600;color:${EMAIL_BRAND.primary};margin-bottom:3px;">${escapeHtml(opts.label)}</div>
      <div style="font-size:12px;color:#64748b;line-height:1.5;">${escapeHtml(opts.desc)}</div>
    </a>
  </td></tr>`;
}

/**
 * variant:
 *   "signup"   — 가입 직후(인증·승인 완료). 기본값.
 *   "existing" — 이 메일이 생기기 전에 이미 가입해 있던 사용자에게 1회 안내
 *                (scripts/send-welcome-backfill.ts). "가입이 완료되었습니다" 가
 *                말이 안 되므로 인사말과 CTA 만 바꾸고 자료·흐름은 동일하게 둔다.
 */
export type WelcomeVariant = "signup" | "existing";

export function buildWelcomeEmail(opts: {
  userName: string;
  baseUrl: string;
  variant?: WelcomeVariant;
}): { subject: string; html: string; text: string } {
  const { userName, baseUrl } = opts;
  const variant: WelcomeVariant = opts.variant ?? "signup";
  const isExisting = variant === "existing";
  const appUrl = `${baseUrl}/`;
  const brochureUrl = `${baseUrl}${BROCHURE.href}`;
  const guideUrl = `${baseUrl}/features`;
  const videoCount = TUTORIAL_VIDEOS.length;

  const stepsHtml = FLOW_STEPS.map(
    (s, i) =>
      `<div style="margin-bottom:${i === FLOW_STEPS.length - 1 ? 0 : 8}px;">
        <strong style="color:#0f172a;">${i + 1}. ${escapeHtml(s.title)}</strong> — ${escapeHtml(s.detail)}
      </div>`
  ).join("");

  return {
    subject: isExisting
      ? "[Intervia] 서비스 소개서와 사용 가이드를 보내드립니다"
      : "[Intervia] 가입이 완료되었습니다 — 서비스 소개서와 사용 가이드",
    text: [
      isExisting
        ? `${userName} 님, Intervia 를 이용해 주셔서 감사합니다.`
        : `${userName} 님, Intervia 가입이 완료되었습니다.`,
      "",
      isExisting
        ? "그동안 따로 안내드리지 못했던 자료를 한 번만 보내드립니다. 사내 공유에 쓰실 서비스 소개서와, 기능을 찾아보는 사용 가이드입니다."
        : "사내 공유에 쓰실 서비스 소개서와, 기능을 찾아보는 사용 가이드를 함께 보내드립니다.",
      "",
      `서비스 소개서 (PDF — 사용법 영상 QR 포함): ${brochureUrl}`,
      `사용 가이드 (웹 — 사용법 영상 ${videoCount}편 포함): ${guideUrl}`,
      `${isExisting ? "Intervia 열기" : "Intervia 시작하기"}: ${appUrl}`,
      "",
      "Intervia 는 이렇게 진행됩니다.",
      ...FLOW_STEPS.map((s, i) => `${i + 1}. ${s.title} — ${s.detail}`),
    ].join("\n"),
    html: wrapEmailCard({
      innerHtml: `
        <h1 style="font-size:20px;margin:24px 0 8px;color:#0f172a;">${
          isExisting ? "소개서와 사용 가이드를 보내드립니다" : "가입이 완료되었습니다"
        }</h1>
        <p style="color:#475569;line-height:1.6;margin:0 0 20px;">
          <strong style="color:#0f172a;">${escapeHtml(userName)}</strong> 님, ${
            isExisting
              ? "Intervia 를 이용해 주셔서 감사합니다.<br>그동안 따로 안내드리지 못했던 자료를 한 번만 보내드립니다."
              : "Intervia 에 오신 것을 환영합니다.<br>사내 공유에 쓰실 자료를 함께 보내드립니다."
          }
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;">
          ${linkRow({
            href: brochureUrl,
            label: "서비스 소개서 (PDF)",
            desc: "서비스 전체와 사용법을 한 부로 정리했습니다. 사용법 영상 QR 도 들어 있어, 인쇄해서 사내 공유·도입 검토에 그대로 쓰실 수 있습니다.",
          })}
          ${linkRow({
            href: guideUrl,
            label: "사용 가이드",
            desc: `기능·버튼·상태·용어를 검색해 찾아보는 웹 설명서입니다. 사용법 영상 ${videoCount}편도 여기에서 바로 볼 수 있습니다.`,
          })}
        </table>
        <p style="text-align:center;margin:0 0 20px;">
          <a href="${appUrl}" style="display:inline-block;background:${EMAIL_BRAND.primary};color:#fff;text-decoration:none;font-weight:600;padding:12px 28px;border-radius:10px;font-size:14px;">${
            isExisting ? "Intervia 열기" : "Intervia 시작하기"
          }</a>
        </p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;font-size:13px;color:#475569;line-height:1.6;">
          <div style="color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">이용 흐름</div>
          ${stepsHtml}
        </div>
      `,
      footer: "본 메일은 Intervia 시스템에서 자동 발송되었습니다.",
    }),
  };
}

/**
 * 환영 메일 발송 — 가입자 전원 대상. 호출부(인증 완료·합류 승인)는 각각 한 사람당
 * 한 번만 실행되므로 여기서 추가 중복 가드는 두지 않는다.
 * 호출부는 가입·인증 흐름을 막지 않도록 반드시 catch 한다.
 */
export async function sendWelcomeMail(opts: {
  userId: number;
  baseUrl: string;
  variant?: WelcomeVariant;
}): Promise<void> {
  const [user] = await db
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, opts.userId));
  if (!user) return;
  const mail = buildWelcomeEmail({
    userName: user.name,
    baseUrl: opts.baseUrl,
    variant: opts.variant,
  });
  await sendMail({ to: user.email, ...mail, audience: "org", kind: "welcome" });
}
