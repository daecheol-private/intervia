import { SITE_INFO } from "@/lib/site-info";
import { GuideView } from "./GuideView";

export const metadata = {
  title: `사용 가이드 — ${SITE_INFO.serviceName}`,
  description:
    "Intervia 사용 가이드 — 공고 등록부터 채용 프로세스, 모든 기능·버튼·상태·용어까지 전부 안내합니다.",
};

export default function FeaturesPage() {
  return <GuideView />;
}
