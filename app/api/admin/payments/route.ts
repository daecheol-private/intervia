import { desc, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser, requirePasswordChanged } from "@/lib/tenant";
import { db } from "@/lib/db";
import { organizations, paymentOrders, users } from "@/lib/schema";
import { withVat } from "@/lib/beta";
import { parseDbTimestamp } from "@/lib/utils";

export const runtime = "nodejs";

const VIEWS = ["paid", "invoice", "all"] as const;
type View = (typeof VIEWS)[number];

/** "2026-09" — KST 기준 연·월. */
const kstMonth = (d: Date) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).format(d);

/**
 * 전 법인 결제(충전) 통합 목록 — system_admin. 월(KST) 단위.
 *  view=paid(기본) 결제 완료(카드 승인·계좌이체 입금확인) + 그 뒤 환불된 건
 *  view=invoice    세금계산서 발행 대상 = 입금확인된 계좌이체. 미발행은 달과 무관하게 전부(놓치지 않게), 미발행 먼저
 *  view=all        대기·실패 포함 전체 주문
 * 결제 시점: 계좌이체는 입금확인 시각, 카드는 주문 시각(승인 직후 paid 로 바뀌며 별도 시각 없음).
 * 건수가 작아 최근 3,000건을 읽어 월로 거른다(날짜 포맷이 컬럼마다 달라 SQL 비교를 피함).
 */
export async function GET(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role !== "system_admin")
    return new Response("권한 없음 (시스템 관리자 전용)", { status: 403 });
  const pw = requirePasswordChanged(me);
  if (pw) return pw;

  const params = new URL(req.url).searchParams;
  const monthParam = params.get("month") ?? "";
  const month = /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : kstMonth(new Date());
  const viewParam = params.get("view") as View | null;
  const view: View = viewParam && VIEWS.includes(viewParam) ? viewParam : "paid";

  const rows = await db
    .select({
      id: paymentOrders.id,
      orgId: paymentOrders.orgId,
      orgName: organizations.name,
      orgBizNo: organizations.bizRegistrationNo,
      amountKrw: paymentOrders.amountKrw,
      tokens: paymentOrders.tokens,
      status: paymentOrders.status,
      provider: paymentOrders.provider,
      createdAt: paymentOrders.createdAt,
      depositNotifiedAt: paymentOrders.depositNotifiedAt,
      confirmedAt: paymentOrders.confirmedAt,
      confirmedBy: paymentOrders.confirmedBy,
      taxInvoiceIssuedAt: paymentOrders.taxInvoiceIssuedAt,
      byName: users.name,
      byEmail: users.email,
    })
    .from(paymentOrders)
    .leftJoin(organizations, eq(organizations.id, paymentOrders.orgId))
    .leftJoin(users, eq(users.id, paymentOrders.createdByUserId))
    .orderBy(desc(paymentOrders.id))
    .limit(3000);

  const all = rows.map((r) => {
    const transfer = r.provider === "transfer";
    const paidAt = transfer
      ? r.confirmedAt
      : r.status === "paid" || r.status === "cancelled"
        ? r.createdAt
        : null;
    return {
      ...r,
      payKrw: withVat(r.amountKrw),
      vatKrw: withVat(r.amountKrw) - r.amountKrw,
      paidAt,
      month: kstMonth(parseDbTimestamp(paidAt ?? r.createdAt)),
    };
  });
  type Row = (typeof all)[number];

  const inMonth = all.filter((r) => r.month === month);
  const paid = inMonth.filter((r) => r.paidAt != null);
  const settled = paid.filter((r) => r.status === "paid");
  const sum = (list: Row[], f: (r: Row) => number) => list.reduce((s, r) => s + f(r), 0);
  const invoiceTodo = (r: Row) =>
    r.provider === "transfer" && r.status === "paid" && r.paidAt != null && !r.taxInvoiceIssuedAt;

  const totals = {
    count: settled.length,
    payKrw: sum(settled, (r) => r.payKrw),
    supplyKrw: sum(settled, (r) => r.amountKrw),
    vatKrw: sum(settled, (r) => r.vatKrw),
    cardPayKrw: sum(settled.filter((r) => r.provider !== "transfer"), (r) => r.payKrw),
    transferPayKrw: sum(settled.filter((r) => r.provider === "transfer"), (r) => r.payKrw),
    refundedCount: paid.filter((r) => r.status === "cancelled").length,
    invoicePending: inMonth.filter(invoiceTodo).length,
    invoicePendingAll: all.filter(invoiceTodo).length,
  };

  const orders =
    view === "all"
      ? inMonth
      : view === "invoice"
        ? all
            .filter(
              (r) =>
                r.provider === "transfer" &&
                r.paidAt != null &&
                (invoiceTodo(r) || r.month === month)
            )
            .sort((a, b) => Number(!invoiceTodo(a)) - Number(!invoiceTodo(b)))
        : paid;

  return Response.json({ month, view, totals, orders });
}
