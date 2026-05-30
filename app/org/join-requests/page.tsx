import { redirect } from "next/navigation";

/**
 * 합류 요청 관리는 법인 멤버 페이지의 "합류 요청" 탭으로 통합됨.
 * 기존 링크·북마크 호환을 위해 영구 리다이렉트만 남긴다.
 */
export default function JoinRequestsRedirect() {
  redirect("/org/members?tab=requests");
}
