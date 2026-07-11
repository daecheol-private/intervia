// /privacy (개인정보 처리방침) 좌측 레일 셸 — 로그인 상태에선 인증 영역과 동일한 셸을 공유한다.
// 비로그인 방문자는 AppShellLayout 이 children 만 반환하므로 기존 공개 헤더가 유지된다.
export { default } from "@/app/components/AppShellLayout";
