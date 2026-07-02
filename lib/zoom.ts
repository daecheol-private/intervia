/**
 * Zoom 연동 — Server-to-Server OAuth 기반 회의 생성.
 *
 * 법인이 줌 마켓플레이스에서 직접 만든 "Server-to-Server OAuth" 앱의
 * Account ID / Client ID / Client Secret 으로 토큰을 발급받아 회의를 만든다.
 * 자격증명은 orgZoomConfigs 테이블에 법인별 1개 저장 (clientSecret 은 암호화).
 *
 * 흐름: getAccessToken() → createMeeting() → join_url 반환.
 * 설정 가이드: docs/ZOOM_SETUP_GUIDE.md
 */
import { db } from "./db";
import { orgZoomConfigs } from "./schema";
import { eq } from "drizzle-orm";
import { decrypt } from "./crypto";
import type { Slot } from "./schedules";

const ZOOM_OAUTH_URL = "https://zoom.us/oauth/token";
const ZOOM_API_BASE = "https://api.zoom.us/v2";

export type ZoomCredentials = {
  accountId: string;
  clientId: string;
  clientSecret: string;
};

export type ZoomMeeting = {
  meetingId: string;
  joinUrl: string;
  startUrl: string;
  password: string | null;
};

/** 법인의 줌 자격증명 로드 (clientSecret 복호화). 미설정 시 null. */
export async function getZoomCredentials(
  orgId: number | null | undefined
): Promise<ZoomCredentials | null> {
  if (!orgId) return null;
  const [cfg] = await db
    .select()
    .from(orgZoomConfigs)
    .where(eq(orgZoomConfigs.orgId, orgId));
  if (!cfg) return null;
  return {
    accountId: cfg.accountId,
    clientId: cfg.clientId,
    clientSecret: decrypt(cfg.clientSecret),
  };
}

/** 법인에 줌 연동이 설정돼 있는지 (자동 회의 생성 가능 여부). */
export async function isZoomConfigured(
  orgId: number | null | undefined
): Promise<boolean> {
  return (await getZoomCredentials(orgId)) !== null;
}

/**
 * Server-to-Server OAuth 액세스 토큰 발급.
 * grant_type=account_credentials, Basic 인증(clientId:clientSecret).
 */
async function getAccessToken(creds: ZoomCredentials): Promise<string> {
  const basic = Buffer.from(
    `${creds.clientId}:${creds.clientSecret}`
  ).toString("base64");
  const url = `${ZOOM_OAUTH_URL}?grant_type=account_credentials&account_id=${encodeURIComponent(
    creds.accountId
  )}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    // 토큰 발급 hang 방지 — 호출부(schedule-zoom·verifyZoomCredentials)가 실패를 폴백 처리.
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ZoomError(
      `토큰 발급 실패 (HTTP ${res.status})`,
      res.status,
      body
    );
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token)
    throw new ZoomError("토큰 응답에 access_token 이 없습니다.", 500, "");
  return data.access_token;
}

export class ZoomError extends Error {
  status: number;
  body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "ZoomError";
    this.status = status;
    this.body = body;
  }
}

/**
 * 자격증명 유효성 검증 — 토큰 발급만 시도 (회의는 만들지 않음).
 * 연결 테스트 버튼에서 사용.
 */
export async function verifyZoomCredentials(
  creds: ZoomCredentials
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await getAccessToken(creds);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: zoomErrorMessage(e) };
  }
}

/**
 * 예약 회의 생성. 슬롯 시작 시각에 맞춰 type=2(예약) 회의 생성.
 * host = 'me' (S2S 앱 계정 소유자).
 */
export async function createMeeting(opts: {
  creds: ZoomCredentials;
  topic: string;
  slot: Slot;
  timezone?: string;
  agenda?: string;
}): Promise<ZoomMeeting> {
  const { creds, topic, slot, timezone = "Asia/Seoul", agenda } = opts;
  const token = await getAccessToken(creds);

  const startMs = new Date(slot.start).getTime();
  const endMs = new Date(slot.end).getTime();
  const durationMin = Math.max(
    15,
    Math.round((endMs - startMs) / 60000) || 60
  );

  const res = await fetch(`${ZOOM_API_BASE}/users/me/meetings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    // 회의 생성 hang 방지 — tryAutoCreateZoomMeeting 이 실패 시 확정 메일로 폴백.
    signal: AbortSignal.timeout(10000),
    body: JSON.stringify({
      topic: topic.slice(0, 200),
      type: 2, // scheduled meeting
      start_time: slot.start,
      duration: durationMin,
      timezone,
      agenda: agenda?.slice(0, 2000),
      settings: {
        join_before_host: true,
        waiting_room: false,
        approval_type: 2, // no registration required
        audio: "both",
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ZoomError(`회의 생성 실패 (HTTP ${res.status})`, res.status, body);
  }
  const data = (await res.json()) as {
    id?: number | string;
    join_url?: string;
    start_url?: string;
    password?: string;
  };
  if (!data.join_url)
    throw new ZoomError("회의 응답에 join_url 이 없습니다.", 500, "");
  return {
    meetingId: String(data.id ?? ""),
    joinUrl: data.join_url,
    startUrl: data.start_url ?? data.join_url,
    password: data.password ?? null,
  };
}

/** ZoomError → 사용자용 한국어 메시지. */
export function zoomErrorMessage(e: unknown): string {
  if (e instanceof ZoomError) {
    if (e.status === 400 || e.status === 401)
      return "줌 자격증명이 올바르지 않습니다. Account ID / Client ID / Client Secret 을 다시 확인하세요.";
    if (e.status === 403)
      return "줌 앱 권한(Scope)이 부족합니다. 줌 앱에 회의 생성(meeting write) 권한을 추가한 뒤 다시 활성화하세요.";
    return e.message;
  }
  if (e instanceof Error) return e.message;
  return "알 수 없는 오류";
}
