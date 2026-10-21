import { cn } from "@/app/components/ui";
import { getTutorialVideo, tutorialVideoUrl, type TutorialKey } from "@/lib/tutorial-videos";

/** 페이지 제목 옆 작은 유튜브 로고 — 사용법 영상을 새 탭으로 연다(임베드 안 함). 페이지당 1개만. */
export function TutorialVideoLink({
  video,
  className,
}: {
  video: TutorialKey;
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
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md opacity-80 hover:opacity-100 hover:bg-surface-alt transition",
        className,
      )}
    >
      <svg viewBox="0 0 28 20" className="h-[13px] w-[18px]" aria-hidden>
        <path
          d="M27.4 3.1A3.5 3.5 0 0 0 24.9.6C22.7 0 14 0 14 0S5.3 0 3.1.6A3.5 3.5 0 0 0 .6 3.1C0 5.3 0 10 0 10s0 4.7.6 6.9a3.5 3.5 0 0 0 2.5 2.5C5.3 20 14 20 14 20s8.7 0 10.9-.6a3.5 3.5 0 0 0 2.5-2.5C28 14.7 28 10 28 10s0-4.7-.6-6.9Z"
          fill="#FF0000"
        />
        <path d="M11.2 14.3 18.5 10l-7.3-4.3v8.6Z" fill="#fff" />
      </svg>
    </a>
  );
}
