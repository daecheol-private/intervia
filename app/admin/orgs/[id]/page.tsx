import { redirect } from "next/navigation";

// 법인 상세 페이지 없음 — 과거 알림 href(/admin/orgs/:id) 호환용 리다이렉트
export default function AdminOrgDetailRedirect() {
  redirect("/admin/orgs");
}
