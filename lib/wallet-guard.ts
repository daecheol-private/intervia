/**
 * 유료 행위 가드 — 토큰 잔액이 0 이하면 신규 유료 요청 차단.
 *
 * 후차감(성공 시 차감) 구조라, 잔액이 양수일 때 시작한 작업(서류 평가·AI 면접 등)은
 * 도중에 잔액이 모자라도 완료되고, 그 차감으로 마이너스 진입은 허용한다(후불).
 * 단 잔액이 0 이하인 동안은 충전 전까지 신규 유료 요청을 받지 않는다.
 *
 * 차단 대상: 공고 생성, 이력서 업로드, 이력서 평가, 이메일 발송(면접링크/결정통보), 면접 시작, 일정 제시
 * 허용: 데이터 수정·삭제, stage 변경, 단순 조회
 *
 * system_admin 은 항상 통과 (운영 액세스). orgId 가 null 이면 통과 (단일테넌트 호환).
 */
import { getBalance } from "./tokens";

export type GuardOk = { ok: true; balance: number };
export type GuardDenied = { ok: false; code: "insufficient_tokens"; balance: number; message: string };

export async function requireSpendableBalance(
  orgId: number | null,
  opts: { isSystemAdmin?: boolean } = {}
): Promise<GuardOk | GuardDenied> {
  if (orgId == null || opts.isSystemAdmin) return { ok: true, balance: Infinity };
  const balance = await getBalance(orgId);
  if (balance <= 0) {
    return {
      ok: false,
      code: "insufficient_tokens",
      balance,
      message: `토큰 잔액이 부족합니다 (현재 ${balance} 토큰). 시스템관리자에게 충전을 요청해 주세요. 충전 전까지 공고 생성·이력서 업로드·평가·면접·이메일 발송·일정 제시가 차단됩니다.`,
    };
  }
  return { ok: true, balance };
}

export function insufficientTokensResponse(g: GuardDenied): Response {
  return Response.json(
    { code: g.code, balance: g.balance, message: g.message },
    { status: 402 } // Payment Required
  );
}
