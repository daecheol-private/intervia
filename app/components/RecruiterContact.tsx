import { Mail } from "lucide-react";

/**
 * 지원자 대면 화면(일정 선택·지원·AI 면접)의 채용 담당자 문의처.
 *
 * 값은 공고의 `recruitingContactEmail` — 지원자 메일 하단 안내 박스(wrapEmailCard)와
 * 같은 출처다. "담당자에게 문의하세요" 라고만 적고 연락 수단이 없으면 지원자가 막히므로,
 * 토큰 링크로 들어온 화면에서도 같은 주소를 노출한다.
 * 미설정(구버전 공고)이면 아무것도 그리지 않는다.
 */
export function RecruiterContact({
  email,
  note = "문의 사항이 있으시면 채용 담당자에게 연락해 주세요.",
  className = "",
}: {
  email?: string | null;
  note?: string;
  className?: string;
}) {
  if (!email) return null;
  return (
    <div
      className={`rounded-lg border border-border-default bg-surface-alt px-4 py-3 text-left ${className}`}
    >
      <div className="text-[11px] text-ink-muted leading-relaxed">{note}</div>
      <a
        href={`mailto:${email}`}
        className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-primary hover:text-primary-deep"
      >
        <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 break-all">{email}</span>
      </a>
    </div>
  );
}
