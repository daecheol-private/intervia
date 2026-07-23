import { ZoomGuideBody } from "@/app/components/ZoomGuideBody";

export const metadata = { title: "줌 연동 가이드 — Intervia" };

/**
 * 줌(Zoom) 연동 설명서 — 로그인한 법인 담당자용. /org/zoom 에서 링크.
 * 본문은 ZoomGuideBody 로 공유하고, 계정 없는 담당자용 공개판은 /zoom-guide.
 */
export default function ZoomGuidePage() {
  return <ZoomGuideBody variant="admin" />;
}
