import { ChevronDown, CirclePlay, ExternalLink } from "lucide-react";
import {
  TUTORIAL_SERIES_LABEL,
  TUTORIAL_VIDEOS,
  tutorialPlaylistUrl,
  tutorialVideoUrl,
  type TutorialSeries,
} from "@/lib/tutorial-videos";

const SERIES: { key: TutorialSeries; desc: string }[] = [
  { key: "start", desc: "전 직원" },
  { key: "interviewer", desc: "서류 검토부터 합격 통보" },
  { key: "hr", desc: "법인·공고·충전 관리" },
];

/** 사용 가이드 상단 — 유튜브 사용법 영상 전체 목록 (새 탭) */
export function TutorialVideoList() {
  return (
    <details className="group mb-8 rounded-xl border border-border-default bg-card shadow-xs">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
        <CirclePlay className="h-4 w-4 text-primary" aria-hidden />
        사용법 영상 {TUTORIAL_VIDEOS.length}편
        <span className="text-xs font-normal text-ink-muted">· 유튜브, 화면 그대로 따라 하기</span>
        <ChevronDown className="ml-auto h-4 w-4 text-ink-muted transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="grid gap-6 border-t border-border-default px-4 py-4 md:grid-cols-2">
        {SERIES.map((s) => (
          <section key={s.key} className={s.key === "start" ? "md:col-span-2" : undefined}>
            <div className="mb-2 flex items-baseline gap-2 px-2">
              <h2 className="shrink-0 whitespace-nowrap text-sm font-semibold text-ink">{TUTORIAL_SERIES_LABEL[s.key]}</h2>
              <span className="truncate text-xs text-ink-muted">{s.desc}</span>
              <a
                href={tutorialPlaylistUrl(s.key)}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap text-xs text-ink-muted hover:text-primary"
              >
                전체 재생 <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            </div>
            <ul className="space-y-0.5">
              {TUTORIAL_VIDEOS.filter((v) => v.series === s.key).map((v) => (
                <li key={v.key}>
                  <a
                    href={tutorialVideoUrl(v)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-baseline gap-2 rounded-md px-2 py-1 text-sm text-ink-soft hover:bg-surface-alt hover:text-primary"
                  >
                    <span className="w-7 shrink-0 text-xs font-semibold tabular-nums text-ink-muted">{v.key}</span>
                    <span className="min-w-0 flex-1">{v.title}</span>
                    <span className="shrink-0 text-xs tabular-nums text-ink-muted">{v.duration}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </details>
  );
}
