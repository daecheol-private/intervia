/**
 * Slack 버튼 알림 — 계좌이체 입금확인처럼 Slack 에서 바로 처리하는 운영 흐름용.
 *
 * 보내기는 기존 Incoming Webhook(SLACK_WEBHOOK_URL). 버튼 클릭은 그 웹훅을 만든 Slack 앱의
 * Interactivity Request URL(/api/slack/interactions)로 들어오며 SLACK_SIGNING_SECRET 서명으로 검증한다.
 * 클릭해 처리할 수 있는 사람은 SLACK_APPROVER_USER_IDS 에 적힌 Slack member ID 뿐이다.
 * Slack 은 국외 서비스라 이름·이메일 같은 개인정보는 싣지 않는다(inquiry-notify 원칙).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type SlackMessage = { text: string; blocks?: unknown[] };

export async function postSlack(msg: SlackMessage): Promise<boolean> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(msg),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** 버튼 클릭을 받을 준비(서명 키)가 됐는지 — 안 됐으면 버튼 대신 관리자 화면 링크를 보낸다. */
export function isSlackInteractive(): boolean {
  return !!process.env.SLACK_SIGNING_SECRET;
}

/** 서명 시각이 이보다 오래된 요청은 재전송 공격으로 보고 거부한다(Slack 권장 5분). */
const MAX_SKEW_SEC = 5 * 60;

/** Slack 요청 서명 검증 — `v0=` + HMAC_SHA256(secret, `v0:{timestamp}:{rawBody}`). */
export function verifySlackSignature(opts: {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
}): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret || !opts.timestamp || !opts.signature) return false;
  const ts = Number(opts.timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > MAX_SKEW_SEC) return false;
  const expected =
    "v0=" +
    createHmac("sha256", secret).update(`v0:${opts.timestamp}:${opts.rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(opts.signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 처리 권한이 있는 Slack 사용자인지. 목록이 비어 있으면 아무도 처리할 수 없다. */
export function isSlackApprover(slackUserId: string | undefined): boolean {
  if (!slackUserId) return false;
  return (process.env.SLACK_APPROVER_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(slackUserId);
}

/** 버튼 클릭에 대한 응답(원본 메시지 교체·본인에게만 보이는 안내). Slack 주소로만 보낸다. */
export async function respondSlack(
  responseUrl: string | undefined,
  body: Record<string, unknown>
): Promise<void> {
  if (!responseUrl?.startsWith("https://hooks.slack.com/")) return;
  try {
    await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    /* 응답 실패는 무시 — 처리 결과는 DB·관리자 화면에 남는다 */
  }
}

/** mrkdwn 에서 특수 의미를 갖는 문자 이스케이프(법인명 등 사용자 입력). */
export function slackEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
