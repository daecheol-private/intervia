import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PaymentsLedger } from "./PaymentsLedger";

export const dynamic = "force-dynamic";

/** 시스템 관리자 — 전 법인 결제 통합 목록 + 계좌이체 세금계산서 발행 체크. */
export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const me = await getCurrentUser();
  if (!me || me.role !== "system_admin") redirect("/");
  const { view } = await searchParams;
  return <PaymentsLedger initialView={view === "invoice" || view === "all" ? view : "paid"} />;
}
