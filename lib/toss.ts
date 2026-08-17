// 토스페이먼츠 서버 연동 — 카드 단건결제 승인(confirm)만.
// 결제창 호출은 클라이언트(/org/tokens)에서 CDN SDK(window.TossPayments)로 하고,
// 여기서는 승인 API(REST) 한 곳만 다룬다 — npm SDK 의존 없음.
//
// 보안: 승인 시 amount 는 반드시 서버 DB(payment_orders.amount_krw)에서 가져온 값을 쓴다.
// 토스가 "실제 결제된 금액"과 대조하므로, 클라이언트가 보낸 금액을 신뢰하지 않는다.

const TOSS_CONFIRM_URL = "https://api.tosspayments.com/v1/payments/confirm";

/** 결제 승인 실패 — code(토스 에러코드)/message 를 라우트가 그대로 사용자에게 전달. */
export class TossError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "TossError";
    this.code = code;
  }
}

/** 서버 비밀키. 미설정이면 결제 자체가 불가 — 명확히 throw. */
function secretKey(): string {
  const k = process.env.TOSS_SECRET_KEY?.trim();
  if (!k) {
    throw new TossError(
      "CONFIG",
      "결제가 설정되지 않았습니다 (TOSS_SECRET_KEY 누락). 관리자에게 문의해 주세요."
    );
  }
  return k;
}

export type TossPaymentResult = {
  paymentKey: string;
  orderId: string;
  status: string; // 정상 승인 시 "DONE"
  totalAmount: number;
  method?: string;
  approvedAt?: string;
};

/**
 * 결제 승인. paymentKey + orderId + amount 를 토스에 보내 실제 결제를 확정한다.
 * - amount 는 호출자가 서버 DB 값을 넘긴다 (위변조 방지).
 * - 성공: status="DONE" 결제 객체 반환. 실패: TossError(code, message) throw.
 * - 같은 paymentKey 로 두 번 승인하면 토스가 거부(ALREADY_PROCESSED 등) — 호출자가
 *   이미 paid 인 주문이면 승인 호출 전에 단락시켜 이 경로를 타지 않게 한다.
 */
export async function confirmTossPayment(args: {
  paymentKey: string;
  orderId: string;
  amount: number;
}): Promise<TossPaymentResult> {
  const auth = Buffer.from(`${secretKey()}:`).toString("base64");
  let res: Response;
  try {
    res = await fetch(TOSS_CONFIRM_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        paymentKey: args.paymentKey,
        orderId: args.orderId,
        amount: args.amount,
      }),
      // 응답 지연에 무한 대기(함수 hang) 방지. abort 시 아래 catch 가 NETWORK 로 변환하고,
      // confirm 라우트는 이를 '승인 여부 불확실'로 처리해 주문을 pending 으로 유지한다
      // (failed 확정 금지) → reconcile 워커가 토스 조회로 DONE 이면 자가치유.
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    // 네트워크 장애 — 결제 미확정. 멱등이라 사용자가 재시도하면 됨.
    throw new TossError(
      "NETWORK",
      "결제 승인 요청 중 네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."
    );
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = typeof data.code === "string" ? data.code : "UNKNOWN";
    const message =
      typeof data.message === "string"
        ? data.message
        : "결제 승인에 실패했습니다.";
    throw new TossError(code, message);
  }

  return {
    paymentKey: String(data.paymentKey ?? args.paymentKey),
    orderId: String(data.orderId ?? args.orderId),
    status: String(data.status ?? ""),
    totalAmount: Number(data.totalAmount ?? args.amount),
    method: typeof data.method === "string" ? data.method : undefined,
    approvedAt:
      typeof data.approvedAt === "string" ? data.approvedAt : undefined,
  };
}

const TOSS_LOOKUP_URL = (orderId: string) =>
  `https://api.tosspayments.com/v1/payments/orders/${encodeURIComponent(orderId)}`;

export type TossPaymentLookup = {
  paymentKey: string;
  orderId: string;
  status: string; // READY / IN_PROGRESS / WAITING_FOR_DEPOSIT / DONE / CANCELED / PARTIAL_CANCELED / ABORTED / EXPIRED
  totalAmount: number;
};

/**
 * orderId 로 결제 상태 조회 — reconciliation(미아 주문 자가치유) 전용. 출금을 일으키지 않는 읽기.
 * - 토스에 해당 orderId 결제가 존재하면 객체, 아예 없으면(결제창 이탈 등) null.
 * - confirm 과 달리 승인 API 가 아니라 **조회**이므로 호출만으로 돈이 빠지지 않는다.
 * - 일시 네트워크/5xx 오류는 TossError throw — 호출자가 다음 회차에 재시도.
 */
export async function getTossPaymentByOrderId(
  orderId: string
): Promise<TossPaymentLookup | null> {
  const auth = Buffer.from(`${secretKey()}:`).toString("base64");
  let res: Response;
  try {
    res = await fetch(TOSS_LOOKUP_URL(orderId), {
      method: "GET",
      headers: { Authorization: `Basic ${auth}` },
      // 조회 hang 방지 — reconcile 워커 경로. abort 는 NETWORK 로 변환돼 다음 회차 재시도.
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new TossError(
      "NETWORK",
      "결제 조회 중 네트워크 오류가 발생했습니다."
    );
  }
  // 토스에 결제가 없음 — 결제창에서 인증 전 이탈해 결제 객체가 생성되지 않은 경우.
  if (res.status === 404) return null;
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = typeof data.code === "string" ? data.code : "UNKNOWN";
    if (code === "NOT_FOUND_PAYMENT" || code === "NOT_FOUND_PAYMENT_SESSION")
      return null;
    const message =
      typeof data.message === "string" ? data.message : "결제 조회에 실패했습니다.";
    throw new TossError(code, message);
  }
  return {
    paymentKey: String(data.paymentKey ?? ""),
    orderId: String(data.orderId ?? orderId),
    status: String(data.status ?? ""),
    totalAmount: Number(data.totalAmount ?? 0),
  };
}

const TOSS_CANCEL_URL = (paymentKey: string) =>
  `https://api.tosspayments.com/v1/payments/${encodeURIComponent(paymentKey)}/cancel`;

/**
 * 결제 취소(전액 환불) — 카드사로 실제 환불. 멱등 키로 중복 취소도 안전.
 * - 성공: 취소된 결제 객체(status="CANCELED") 반환.
 * - 실패: TossError(code, message) throw. 이미 취소된 결제는 code="ALREADY_CANCELED_PAYMENT".
 * 호출자(라우트)가 토큰 회수까지 멱등 처리한다.
 */
export async function cancelTossPayment(args: {
  paymentKey: string;
  cancelReason: string;
  idempotencyKey?: string;
}): Promise<{ status: string }> {
  const auth = Buffer.from(`${secretKey()}:`).toString("base64");
  let res: Response;
  try {
    res = await fetch(TOSS_CANCEL_URL(args.paymentKey), {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        ...(args.idempotencyKey
          ? { "Idempotency-Key": args.idempotencyKey }
          : {}),
      },
      body: JSON.stringify({ cancelReason: args.cancelReason }),
      // 취소(환불) hang 방지. Idempotency-Key 로 abort 후 재시도해도 중복 취소 안전.
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new TossError(
      "NETWORK",
      "결제 취소 요청 중 네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."
    );
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = typeof data.code === "string" ? data.code : "UNKNOWN";
    const message =
      typeof data.message === "string"
        ? data.message
        : "결제 취소에 실패했습니다.";
    throw new TossError(code, message);
  }
  return { status: String(data.status ?? "") };
}

// ──────────────── orderId ↔ payment_orders.id ────────────────
// 토스 orderId 는 6~64자 유니크 문자열이어야 한다. payment_orders.id(autoincrement PK)가
// 곧 전역 유니크 주문번호이므로 별도 컬럼/마이그레이션 없이 PK 를 박는다.
// 매 "결제하기"가 새 pending 주문(새 id)을 만들어 orderId 재사용 충돌도 없다.
//
// ⚠️ 단, 토스 orderId 유니크는 **상점 단위**다. 로컬 DB 와 운영 DB 는 각자 1번부터 PK 를 매기는데
// 둘이 같은 테스트 상점을 쓰면 IV-00000001 이 정면 충돌한다 (2026-08-18 실제 발생 — 로컬 검증분
// 1~8번이 이미 승인/취소돼 있어 운영 첫 결제가 "이미 승인 및 취소가 진행된 중복 주문번호"로 거부).
// 그래서 접두어로 네임스페이스를 가른다 — 운영 IVP / 프리뷰 IVPRE / 로컬 IVL. 접두어는 실행
// 환경에서 결정되는 고정값이라, payment-reconcile 이 DB 의 id 만으로 orderId 를 재구성하는
// 경로도 그대로 유효하다. TOSS_ORDER_PREFIX 로 덮어쓸 수 있다(상점을 새로 파는 경우 등).
function orderPrefix(): string {
  const p = process.env.TOSS_ORDER_PREFIX?.trim().toUpperCase();
  if (p && /^[A-Z]{2,8}$/.test(p)) return p;
  if (process.env.VERCEL_ENV === "production") return "IVP";
  return process.env.VERCEL ? "IVPRE" : "IVL";
}

export function makeTossOrderId(paymentOrderId: number): string {
  return `${orderPrefix()}-${String(paymentOrderId).padStart(8, "0")}`;
}

/** orderId → payment_orders.id. 형식이 틀리면 null. 구 형식(IV-)도 그대로 파싱된다. */
export function parseTossOrderId(orderId: string): number | null {
  const m = /^[A-Z]{2,8}-(\d{1,12})$/.exec(orderId);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
