/**
 * 고객센터 문의함 — system_admin 전용 (운영자 지원 데스크).
 *
 * 셸 자체도 비인가 접근을 차단하기 위해 서버 컴포넌트에서 역할 가드.
 * (org_admin·member 는 /support 로 문의를 "제출"만 하고, 인박스는 보지 못함.)
 */
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { InquiriesInbox } from "./InquiriesInbox";

export const dynamic = "force-dynamic";

export default async function AdminInquiriesPage() {
  const me = await getCurrentUser();
  if (!me || me.role !== "system_admin") {
    redirect("/");
  }
  return <InquiriesInbox />;
}
