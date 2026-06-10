import { db } from "@/lib/db";
import { marketingRecipients } from "@/lib/schema";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import Link from "next/link";
import { MailX, CheckCircle2, ArrowRight } from "lucide-react";

export const dynamic = "force-dynamic";

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const head = local.slice(0, 2);
  return `${head}${"*".repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

async function unsubscribeAction(formData: FormData) {
  "use server";
  const token = String(formData.get("token") ?? "");
  if (token) {
    await db
      .update(marketingRecipients)
      .set({ status: "unsubscribed", unsubscribedAt: new Date().toISOString() })
      .where(
        and(
          eq(marketingRecipients.unsubscribeToken, token),
          eq(marketingRecipients.status, "active")
        )
      );
  }
  redirect(`/unsubscribe/${token}`);
}

export default async function UnsubscribePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [r] = await db
    .select()
    .from(marketingRecipients)
    .where(eq(marketingRecipients.unsubscribeToken, token));

  return (
    <main className="min-h-[70vh] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {!r ? (
          <div className="bg-card border border-border-default rounded-2xl shadow-sm p-8 text-center">
            <h1 className="text-lg font-bold text-ink">유효하지 않은 링크입니다</h1>
            <p className="text-sm text-ink-soft mt-2 leading-relaxed">
              링크가 잘못되었거나 만료되었습니다.
              <br />
              수신거부를 원하시면 받으신 메일로 회신해 주세요.
            </p>
          </div>
        ) : r.status === "unsubscribed" ? (
          <>
            <div className="bg-card border border-border-default rounded-2xl shadow-sm p-8 text-center">
              <span className="inline-flex w-12 h-12 rounded-full bg-primary-soft text-primary items-center justify-center">
                <CheckCircle2 className="w-6 h-6" />
              </span>
              <h1 className="text-lg font-bold text-ink mt-4">
                수신거부가 완료되었습니다
              </h1>
              <p className="text-sm text-ink-soft mt-2 leading-relaxed">
                <strong className="text-ink">{maskEmail(r.email)}</strong> 주소로
                <br />
                더 이상 Intervia 광고성 메일이 발송되지 않습니다.
              </p>
            </div>
            {/* 거부 처리는 위에서 무조건 완료 — 아래는 가벼운 서비스 소개만 */}
            <div className="mt-4 bg-surface-alt/60 border border-border-default rounded-2xl p-6 text-center">
              <p className="text-xs text-ink-soft leading-relaxed">
                Intervia는 AI 이력서 평가부터 채팅 면접, 평가 리포트까지
                <br />
                채용 사이클의 80%를 자동화하는 플랫폼입니다.
              </p>
              <Link
                href="/"
                className="inline-flex items-center gap-1 mt-3 text-xs font-medium text-primary hover:underline"
              >
                그래도 궁금하시다면 둘러보기
                <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          </>
        ) : (
          <div className="bg-card border border-border-default rounded-2xl shadow-sm p-8 text-center">
            <span className="inline-flex w-12 h-12 rounded-full bg-danger-soft text-danger items-center justify-center">
              <MailX className="w-6 h-6" />
            </span>
            <h1 className="text-lg font-bold text-ink mt-4">광고성 메일 수신거부</h1>
            <p className="text-sm text-ink-soft mt-2 leading-relaxed">
              <strong className="text-ink">{maskEmail(r.email)}</strong> 주소로 발송되는
              <br />
              Intervia 광고성 메일을 더 이상 받지 않습니다.
            </p>
            <form action={unsubscribeAction} className="mt-6">
              <input type="hidden" name="token" value={token} />
              <button
                type="submit"
                className="w-full h-11 rounded-lg bg-primary hover:bg-primary-deep text-surface text-sm font-semibold transition-colors"
              >
                수신거부 하기
              </button>
            </form>
            <p className="text-[11px] text-ink-muted mt-3">
              버튼을 누르면 즉시 처리되며, 별도 가입이나 로그인이 필요 없습니다.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
