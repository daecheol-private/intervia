import { CirclePlay } from "lucide-react";
import { cn } from "@/app/components/ui";
import { getTutorialVideo, tutorialVideoUrl, type TutorialKey } from "@/lib/tutorial-videos";

/** 화면 옆에 붙는 "사용법 영상" 링크. 유튜브 새 탭으로 연다(임베드 안 함). */
export function TutorialVideoLink({
  video,
  iconOnly = false,
  label = "사용법 영상",
  className,
}: {
  video: TutorialKey;
  iconOnly?: boolean;
  label?: string;
  className?: string;
}) {
  const v = getTutorialVideo(video);
  const tip = `사용법 영상 보기 · ${v.title} (${v.duration})`;
  return (
    <a
      href={tutorialVideoUrl(v)}
      target="_blank"
      rel="noopener noreferrer"
      title={tip}
      aria-label={tip}
      className={cn(
        "inline-flex items-center gap-1 shrink-0 rounded-md text-xs font-medium text-ink-muted hover:text-primary hover:bg-surface-alt transition-colors",
        iconOnly ? "h-7 w-7 justify-center" : "h-7 px-1.5",
        className,
      )}
    >
      <CirclePlay className="w-4 h-4 shrink-0" aria-hidden />
      {!iconOnly && <span>{label}</span>}
    </a>
  );
}
