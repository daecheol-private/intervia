/**
 * 유튜브 사용법 영상 21편. 원본 목록은 marketing/youtube-uploads.json.
 * 링크는 재생목록 포함형 — youtu.be 단독이면 다음 영상이 유튜브 추천으로 뒤섞인다.
 */
export type TutorialSeries = "start" | "interviewer" | "hr";

const PLAYLISTS: Record<TutorialSeries, string> = {
  start: "PLQouPPKCUQHU",
  interviewer: "PLB0QTOtqh0vw",
  hr: "PLUttB_6_6HdA",
};

export const TUTORIAL_SERIES_LABEL: Record<TutorialSeries, string> = {
  start: "시작하기",
  interviewer: "면접관편",
  hr: "인사팀편",
};

export interface TutorialVideo {
  key: string;
  series: TutorialSeries;
  title: string;
  videoId: string;
  duration: string;
}

export const TUTORIAL_VIDEOS = [
  { key: "0-1", series: "start", title: "Intervia 한눈에", videoId: "kaSXRkaumXk", duration: "2:36" },
  { key: "A1", series: "interviewer", title: "처음 시작하기", videoId: "Z17vcuApsVs", duration: "3:18" },
  { key: "A2", series: "interviewer", title: "내 공고와 후보자 찾기", videoId: "oOWaPlJf2Ok", duration: "3:45" },
  { key: "A3", series: "interviewer", title: "서류평가 리포트 읽는 법", videoId: "jQjUcYUHoNs", duration: "3:52" },
  { key: "A4", series: "interviewer", title: "서류 확인 후 AI면접 보내기", videoId: "sxF7gX5z2fo", duration: "2:44" },
  { key: "A5", series: "interviewer", title: "지원자는 AI면접을 이렇게 봐요", videoId: "ithxCyQPRKU", duration: "3:59" },
  { key: "A6", series: "interviewer", title: "AI면접 평가 읽는 법", videoId: "eZiWuIVROtg", duration: "4:03" },
  { key: "A7", series: "interviewer", title: "1차 면접 후보 지정과 일정 잡기", videoId: "SHFSyOabCkA", duration: "4:01" },
  { key: "A8", series: "interviewer", title: "대면 면접 진행하기 (질문지·녹음)", videoId: "_qzz0RB1Ovo", duration: "3:41" },
  { key: "A9", series: "interviewer", title: "대면평가·종합평가·후보자 비교", videoId: "_21XrSnwLHo", duration: "3:09" },
  { key: "A10", series: "interviewer", title: "면접관끼리 의견 나누기·평가 공유", videoId: "n6Tcbodt2as", duration: "3:04" },
  { key: "A11", series: "interviewer", title: "합격·불합격 결정과 통보", videoId: "QY6C26QIQuw", duration: "3:27" },
  { key: "A12", series: "interviewer", title: "여러 명 한 번에 처리하기", videoId: "tbglifGSBZ0", duration: "3:51" },
  { key: "B1", series: "hr", title: "법인 개설과 멤버 승인", videoId: "Eu9Fov-ak58", duration: "3:50" },
  { key: "B2", series: "hr", title: "법인 설정 (주소·브랜딩·컬처핏·메일·Zoom)", videoId: "C2DLQ3bKl-0", duration: "4:00" },
  { key: "B3", series: "hr", title: "토큰 지갑과 충전", videoId: "THyKIWEsO9o", duration: "4:00" },
  { key: "B4", series: "hr", title: "공고 만들기", videoId: "ctsNGxe3zrI", duration: "4:23" },
  { key: "B5", series: "hr", title: "면접관 지정과 공고 공유", videoId: "fxuadVy6FhA", duration: "3:20" },
  { key: "B6", series: "hr", title: "이력서 받기 (지원 링크·업로드)", videoId: "Od0xuOzkubc", duration: "4:43" },
  { key: "B7", series: "hr", title: "공고 연장·종결·재개, 채용 결과 리포트", videoId: "YH9RyKODjS8", duration: "3:56" },
  { key: "B8", series: "hr", title: "평가 정확도 보기", videoId: "QBNFKN4AopI", duration: "2:28" },
] as const satisfies readonly TutorialVideo[];

export type TutorialKey = (typeof TUTORIAL_VIDEOS)[number]["key"];

export function getTutorialVideo(key: TutorialKey): TutorialVideo {
  return TUTORIAL_VIDEOS.find((v) => v.key === key)!;
}

export function tutorialVideoUrl(v: TutorialVideo): string {
  return `https://www.youtube.com/watch?v=${v.videoId}&list=${PLAYLISTS[v.series]}`;
}

export function tutorialPlaylistUrl(series: TutorialSeries): string {
  return `https://www.youtube.com/playlist?list=${PLAYLISTS[series]}`;
}
