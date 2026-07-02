/**
 * 카카오 알림톡 발송 (중계사: 알리고).
 *
 * 설계 원칙 — SMTP(mailer.ts) 와 동일하게 "게이트 + 베스트에포트":
 *  - env 미설정이면 발송을 조용히 skip (isAlimtalkConfigured=false). 이메일은 항상 별도로 나가므로
 *    알림톡은 "병행 보강"일 뿐, 실패해도 핵심 통지(이메일)는 유지된다.
 *  - 절대 throw 하지 않음. 호출부는 `void sendCandidateAlimtalk(...)` 로 fire-and-forget.
 *  - 후보자 전화번호가 없으면(이력서에서 미추출) skip.
 *  - 알림톡 실패 시 failover=Y 로 SMS 대체발송 (fallbackText 제공 시).
 *
 * ⚠️ 실제 발송을 켜려면 (사용자 작업):
 *  1) 알리고 가입 → ALIGO_API_KEY / ALIGO_USER_ID
 *  2) 카카오 비즈니스 채널 + 발신프로필 등록 → ALIGO_SENDER_KEY(senderkey), ALIGO_SENDER(발신번호)
 *  3) 메시지 종류별 템플릿 사전 승인 → tpl_code 를 아래 TEMPLATE_ENV 의 각 env 에 등록
 *     (승인 템플릿 본문은 buildMessage 의 텍스트와 글자까지 일치해야 함 — KAKAO 가 패턴 매칭)
 *
 * API 규격(알리고): 토큰 발급 → 발송. 성공 판정 code===0. form-urlencoded POST.
 *   token:  POST https://kakaoapi.aligo.in/akv10/token/create/{초}/s  (apikey, userid)
 *   send:   POST https://kakaoapi.aligo.in/akv10/alimtalk/send/
 */

const TOKEN_URL = "https://kakaoapi.aligo.in/akv10/token/create/600/s";
const SEND_URL = "https://kakaoapi.aligo.in/akv10/alimtalk/send/";

/** 병행 발송 대상 — 사용자 확정 "권장 5종". */
export type AlimtalkType =
  | "interview_invite" // AI 면접 초대(링크)
  | "interview_reminder" // AI 면접 미응답 리마인더(24h/48h)
  | "schedule_propose" // 대면 면접 일정 제안(슬롯 선택 요청)
  | "interview_day_reminder" // 대면 면접 D-1 리마인더
  | "decision_pass"; // 합격 통보

/** 종류별 승인 템플릿 코드(tpl_code)를 담는 env 변수명. 승인 후 사용자가 채움. */
const TEMPLATE_ENV: Record<AlimtalkType, string> = {
  interview_invite: "ALIGO_TPL_INTERVIEW_INVITE",
  interview_reminder: "ALIGO_TPL_INTERVIEW_REMINDER",
  schedule_propose: "ALIGO_TPL_SCHEDULE_PROPOSE",
  interview_day_reminder: "ALIGO_TPL_INTERVIEW_DAY",
  decision_pass: "ALIGO_TPL_DECISION_PASS",
};

export type AlimtalkVars = {
  orgName?: string | null;
  candidateName: string;
  jobTitle: string;
  url?: string; // 링크 버튼/본문용 (초대·리마인더·일정·미팅)
  expiresAt?: string; // 만료 안내
  slotLabel?: string; // 대면 D-1 일시
};

/**
 * 종류별 알림톡 본문. ⚠️ 카카오 승인 템플릿 본문과 글자까지 일치해야 발송 성공한다.
 * 승인 신청 시 변수 자리는 `#{변수}` 로 등록하고(예: `#{이름}님`), 발송 시 이 함수가 실제 값을 채운다.
 * (승인 템플릿을 수정하면 이 텍스트도 동일하게 맞출 것.)
 */
function buildMessage(type: AlimtalkType, v: AlimtalkVars): string {
  const org = v.orgName?.trim() || "채용";
  switch (type) {
    case "interview_invite":
      return `[${org}] AI 면접 안내\n\n${v.candidateName}님, ${v.jobTitle} 포지션 AI 면접을 안내드립니다.\n아래 버튼으로 면접을 진행해 주세요. (약 10~30분, 채팅 방식)\n\n링크 만료: ${v.expiresAt ?? "-"}\n\n※ 본 면접은 비밀번호·결제·금융정보를 절대 요구하지 않습니다.`;
    case "interview_reminder":
      // 카카오 알림톡 검수: "미완료 재촉"은 광고·공지성으로 반려됨(2026-06-30, UJ_0795).
      // → "링크 유효기간 안내"라는 정보성 이벤트로 프레이밍 전환(거래 관계 기반 정보 고지).
      return `[${org}] AI 면접 링크 유효기간 안내\n\n${v.candidateName}님, 지원하신 ${v.jobTitle} 포지션 AI 면접 링크의 유효기간을 안내드립니다.\n면접을 아직 완료하지 않으신 경우, 만료 전 아래 버튼에서 진행하실 수 있습니다.\n\n링크 만료: ${v.expiresAt ?? "-"}`;
    case "schedule_propose":
      return `[${org}] 면접 일정 선택 안내\n\n${v.candidateName}님, ${v.jobTitle} 면접 일정을 선택해 주세요.\n아래 버튼에서 가능한 시간을 골라 회신해 주시면 일정이 확정됩니다.`;
    case "interview_day_reminder":
      return `[${org}] 내일 면접 안내\n\n${v.candidateName}님, ${v.jobTitle} 면접이 내일 예정되어 있습니다.\n\n일시: ${v.slotLabel ?? "-"}\n\n부득이하게 참석이 어려우시면 채용 담당자에게 미리 연락 부탁드립니다.`;
    case "decision_pass":
      return `[${org}] 합격 안내\n\n${v.candidateName}님, 축하드립니다. ${v.jobTitle} 전형에 합격하셨습니다.\n자세한 다음 절차는 채용 담당자가 별도로 안내드릴 예정입니다.`;
  }
}

/** 링크 버튼이 필요한 종류엔 웹링크 버튼 JSON 을 구성. (없으면 undefined) */
function buildButton(type: AlimtalkType, v: AlimtalkVars): string | undefined {
  if (!v.url) return undefined;
  const label =
    type === "interview_invite"
      ? "면접 시작하기"
      : type === "interview_reminder"
        ? "면접 진행하기"
        : type === "schedule_propose"
          ? "면접 일정 선택하기"
          : null;
  if (!label) return undefined;
  return JSON.stringify({
    button: [
      { name: label, linkType: "WL", linkTypeName: "웹링크", linkMo: v.url, linkPc: v.url },
    ],
  });
}

export function isAlimtalkConfigured(): boolean {
  return !!(
    process.env.ALIGO_API_KEY &&
    process.env.ALIGO_USER_ID &&
    process.env.ALIGO_SENDER_KEY &&
    process.env.ALIGO_SENDER
  );
}

/** "010-1234-5678" / "+82 10..." 등 → "01012345678". 유효 휴대폰 아니면 null. */
function normalizeMobile(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("82")) d = "0" + d.slice(2); // 국가코드 → 로컬
  if (/^01[016789]\d{7,8}$/.test(d)) return d;
  return null;
}

/**
 * 로컬/비운영 강제 리다이렉트 수신번호 (mailer 의 LOCAL_DEV_FALLBACK 과 동일 정책).
 * NODE_ENV != production(로컬 dev·테스트 스크립트) 이면 실제 후보자 번호 대신 항상 이 번호로만 발송한다.
 * → 로컬 테스트 중 실제 지원자에게 알림톡이 나가는 사고를 원천 차단. 운영에선 null(실번호 발송).
 */
const LOCAL_DEV_MOBILE = "01074962696";
function resolveAlimtalkOverride(): string | null {
  return process.env.NODE_ENV !== "production" ? LOCAL_DEV_MOBILE : null;
}

// 토큰 캐시 — 발송마다 토큰을 새로 받으면 느리고 한도 낭비. 유효시간(600s) 내 재사용.
let tokenCache: { token: string; expiresAtMs: number } | null = null;

async function getToken(): Promise<string | null> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAtMs > now + 30_000) return tokenCache.token;
  const body = new URLSearchParams({
    apikey: process.env.ALIGO_API_KEY!,
    userid: process.env.ALIGO_USER_ID!,
  });
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const json = (await res.json()) as { code?: number; token?: string; message?: string };
    if (Number(json.code) !== 0 || !json.token) {
      console.error("[alimtalk] token 발급 실패:", json.message ?? json.code);
      return null;
    }
    tokenCache = { token: json.token, expiresAtMs: now + 600_000 };
    return json.token;
  } catch (e) {
    console.error("[alimtalk] token 요청 오류:", e instanceof Error ? e.message : e);
    return null;
  }
}

export type AlimtalkResult =
  | { ok: true }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; skipped: false; reason: string };

/**
 * 후보자에게 알림톡 1건 발송 (베스트에포트, throw 안 함).
 * @param fallbackText 알림톡 실패 시 SMS 대체발송 본문. 미지정이면 failover 안 함.
 */
export async function sendCandidateAlimtalk(
  type: AlimtalkType,
  args: { phone: string | null | undefined; vars: AlimtalkVars; fallbackText?: string }
): Promise<AlimtalkResult> {
  if (!isAlimtalkConfigured()) return { ok: false, skipped: true, reason: "not_configured" };

  const tplCode = process.env[TEMPLATE_ENV[type]];
  if (!tplCode) return { ok: false, skipped: true, reason: "template_not_set" };

  const realMobile = normalizeMobile(args.phone);
  if (!realMobile) return { ok: false, skipped: true, reason: "no_phone" };
  // 로컬/비운영: 실제 후보자 번호로 알림톡이 나가는 사고 방지 — 항상 본인 번호로 리다이렉트.
  const override = resolveAlimtalkOverride();
  if (override && override !== realMobile) {
    console.warn(`[alimtalk] 로컬 리다이렉트: ${realMobile} → ${override} (type=${type})`);
  }
  const mobile = override ?? realMobile;

  const token = await getToken();
  if (!token) return { ok: false, skipped: false, reason: "token_failed" };

  const message = buildMessage(type, args.vars);
  const button = buildButton(type, args.vars);

  const body = new URLSearchParams({
    apikey: process.env.ALIGO_API_KEY!,
    userid: process.env.ALIGO_USER_ID!,
    token,
    senderkey: process.env.ALIGO_SENDER_KEY!,
    tpl_code: tplCode,
    sender: process.env.ALIGO_SENDER!,
    receiver_1: mobile,
    subject_1: "Intervia 채용 안내",
    message_1: message,
    testMode: process.env.ALIGO_TEST_MODE === "1" ? "Y" : "N",
  });
  if (button) body.set("button_1", button);
  if (args.fallbackText) {
    body.set("failover", "Y");
    body.set("fsubject_1", "채용 안내");
    body.set("fmessage_1", args.fallbackText);
  }

  try {
    const res = await fetch(SEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const json = (await res.json()) as { code?: number; message?: string };
    if (Number(json.code) !== 0) {
      console.error(`[alimtalk] 발송 실패 (type=${type}):`, json.message ?? json.code);
      return { ok: false, skipped: false, reason: String(json.message ?? json.code) };
    }
    return { ok: true };
  } catch (e) {
    console.error(`[alimtalk] 발송 오류 (type=${type}):`, e instanceof Error ? e.message : e);
    return { ok: false, skipped: false, reason: "request_failed" };
  }
}
