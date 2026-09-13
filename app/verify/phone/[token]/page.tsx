import type { ReactNode } from "react";
import Link from "next/link";
import { BellRing, Clock, FileQuestion } from "lucide-react";
import { getPhoneVerifyView } from "@/lib/notify-phone";
import { VerifyPhoneActions } from "./verify-phone-actions";

export const runtime = "nodejs";
// 확인 상태가 바로 반영돼야 한다 (캐시 금지).
export const dynamic = "force-dynamic";

export const metadata = {
  title: "면접 일정 알림 번호 확인 · Intervia",
  robots: { index: false, follow: false },
};

function Shell({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-card border border-border-default rounded-2xl p-6 shadow-sm">
        <div className="w-12 h-12 rounded-2xl bg-primary-soft text-primary mx-auto mb-4 flex items-center justify-center">
          {icon}
        </div>
        <h1 className="text-lg font-bold text-ink text-center">{title}</h1>
        <div className="mt-3 text-sm text-ink-soft leading-relaxed">{children}</div>
      </div>
    </main>
  );
}

export default async function VerifyPhonePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const view = await getPhoneVerifyView(token);

  if (view.state === "not_found") {
    return (
      <Shell icon={<FileQuestion className="w-6 h-6" />} title="링크를 찾을 수 없습니다">
        <p className="text-center">
          이미 삭제된 번호이거나 주소가 올바르지 않습니다.
        </p>
      </Shell>
    );
  }

  if (view.state === "expired") {
    return (
      <Shell icon={<Clock className="w-6 h-6" />} title="확인 기한이 지났습니다">
        <p className="text-center">
          {view.orgName} 채용 담당자에게 번호 확인 요청을 다시 보내 달라고 해 주세요.
          계정이 있다면 계정 설정에서 직접 다시 요청할 수 있습니다.
        </p>
      </Shell>
    );
  }

  return (
    <Shell icon={<BellRing className="w-6 h-6" />} title="면접 일정 알림 번호 확인">
      <p>
        {view.name}님, <strong className="text-ink">{view.orgName}</strong>의 면접 일정
        확정·취소 안내를 받을 번호로{" "}
        <strong className="text-ink">{view.phoneMasked}</strong>이(가) 등록되었습니다.
      </p>
      <div className="mt-4 rounded-lg bg-surface-alt border border-border-default px-3 py-2.5 text-xs text-ink-muted leading-relaxed">
        <div className="font-semibold text-ink-soft mb-1">개인정보 수집·이용 안내</div>
        <ul className="list-disc pl-4 space-y-0.5">
          <li>항목: 휴대폰 번호, 확인 시각·접속 IP·브라우저 정보</li>
          <li>목적: 면접 일정 확정·취소 안내를 카카오 알림톡으로 발송</li>
          <li>보유: &ldquo;받지 않기&rdquo;를 누르거나 계정 탈퇴·법인 해지 시까지</li>
          <li>동의하지 않을 수 있으며, 이 경우 알림톡 없이 메일로만 안내됩니다.</li>
        </ul>
        <p className="mt-1.5">
          자세한 내용은{" "}
          <Link href="/privacy" target="_blank" className="underline hover:text-ink-soft">
            개인정보 처리방침
          </Link>
          을 참고해 주세요.
        </p>
      </div>
      <VerifyPhoneActions token={token} initialState={view.state} />
    </Shell>
  );
}
