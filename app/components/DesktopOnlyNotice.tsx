import { Monitor } from "lucide-react";

/**
 * 모바일에서 데스크톱 전용 기능 영역에 표시하는 안내 카드.
 * `< sm` 에서만 노출되도록 호출부에서 `sm:hidden` 컨테이너로 감싸 사용.
 * (예: 이력서 업로드, 공고 등록·수정 — HR 이 PC 에서 처리하는 기능)
 */
export function DesktopOnlyNotice({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-6 text-center">
      <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-white border border-slate-200">
        <Monitor className="h-5 w-5 text-slate-400" />
      </div>
      <div className="text-sm font-medium text-slate-700">{title}</div>
      <p className="mt-1 text-xs text-slate-500 leading-relaxed">
        {description ?? "이 기능은 PC(데스크톱)에서 이용해 주세요."}
      </p>
    </div>
  );
}
