import { ZoomGuideBody } from "@/app/components/ZoomGuideBody";
import { SITE_INFO } from "@/lib/site-info";

export const metadata = {
  title: `줌(Zoom) 연동 가이드 — ${SITE_INFO.serviceName}`,
  description:
    "Intervia 온라인 면접용 줌 연동 방법 — 회사 줌 계정에서 연결 정보 3개를 만들어 담당자에게 전달하는 과정을 단계별로 안내합니다. Intervia 계정이 없어도 따라 할 수 있습니다.",
};

/**
 * 줌(Zoom) 연동 가이드 (공개 페이지).
 * Intervia 계정이 없는 회사 줌 관리자/담당자가 링크만 받아 볼 수 있도록 로그인 없이
 * 접근 가능(proxy.ts 공개 경로). 본문은 관리자용(/org/zoom/guide)과 ZoomGuideBody 로 공유.
 */
export default function PublicZoomGuidePage() {
  return <ZoomGuideBody variant="public" />;
}
