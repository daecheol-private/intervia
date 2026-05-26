/**
 * 국세청 사업자등록정보 진위확인 API (data.go.kr / odcloud.kr).
 *
 * 두 가지 모드:
 *   1) status — 사업자번호만으로 영업 상태 확인
 *   2) validate — 사업자번호 + 개업일자 + 대표자명 + (상호) 모두 일치하는지 확인
 *
 * 운영자가 data.go.kr 에서 "국세청 사업자등록정보 진위확인 및 상태조회" API
 * 활용신청을 해서 키를 발급받고 `BUSINESS_REGISTRY_API_KEY` 환경변수에 설정.
 * 키 없으면 기능 비활성 — 호출자가 `available=false` 받고 검증 단계 skip.
 *
 * API 한도: 일 1000건 (개발용), 운영용은 별도 신청.
 */

const STATUS_URL =
  "https://api.odcloud.kr/api/nts-businessman/v1/status";

export type BusinessStatus = {
  // 1: 계속사업자, 2: 휴업, 3: 폐업
  active: boolean;
  status: string; // 원문 (계속사업자 / 휴업자 / 폐업자)
  taxType: string | null; // 과세유형
  closedAt?: string | null; // 폐업일자
};

export function isBusinessRegistryConfigured(): boolean {
  return !!process.env.BUSINESS_REGISTRY_API_KEY;
}

/** 사업자번호 형식: 10자리 숫자 (000-00-00000 hyphen 허용). */
export function normalizeBizNo(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 10) return null;
  return digits;
}

export function formatBizNo(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 10) return raw;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

/** 사업자번호 상태 조회. 키 미설정이면 null 반환. */
export async function lookupBusinessStatus(
  bizNo: string
): Promise<BusinessStatus | null> {
  const apiKey = process.env.BUSINESS_REGISTRY_API_KEY;
  if (!apiKey) return null;
  const cleaned = normalizeBizNo(bizNo);
  if (!cleaned) return null;

  const url = `${STATUS_URL}?serviceKey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ b_no: [cleaned] }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    throw new Error(`사업자 조회 실패 (HTTP ${res.status})`);
  }
  const data = (await res.json()) as {
    data?: Array<{
      b_no: string;
      b_stt?: string;
      b_stt_cd?: string;
      tax_type?: string;
      end_dt?: string;
    }>;
  };
  const row = data.data?.[0];
  if (!row) return null;
  // b_stt_cd: 01=계속사업자, 02=휴업자, 03=폐업자, "" = 미등록
  const code = row.b_stt_cd ?? "";
  return {
    active: code === "01",
    status: row.b_stt ?? "알 수 없음",
    taxType: row.tax_type ?? null,
    closedAt: row.end_dt && row.end_dt !== "" ? row.end_dt : null,
  };
}
