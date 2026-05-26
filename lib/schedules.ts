/**
 * 1차 면접 스케쥴 헬퍼 — 토큰 생성·메일 템플릿·시간 포맷.
 */
import crypto from "node:crypto";
import { EMAIL_BRAND, wrapEmailCard } from "./mailer";

export const SCHEDULE_EXPIRY_DAYS = 14;

export function generateScheduleToken(): string {
  return "sch_" + crypto.randomBytes(20).toString("hex");
}

export function scheduleExpiresAt(from = new Date()): string {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + SCHEDULE_EXPIRY_DAYS);
  return d.toISOString();
}

export type Slot = { start: string; end: string };

/** 슬롯 검증 — 시작이 미래, end > start, 최대 30일 후까지. */
export function validateSlots(slots: unknown): {
  ok: true;
  slots: Slot[];
} | { ok: false; error: string } {
  if (!Array.isArray(slots) || slots.length === 0)
    return { ok: false, error: "면접 가능 시간 후보가 비어 있습니다." };
  if (slots.length > 10)
    return { ok: false, error: "한 번에 최대 10개 슬롯까지 제시할 수 있습니다." };
  const now = Date.now();
  const max = now + 60 * 24 * 60 * 60 * 1000;
  const out: Slot[] = [];
  for (const s of slots) {
    if (
      typeof s !== "object" ||
      s == null ||
      typeof (s as Slot).start !== "string" ||
      typeof (s as Slot).end !== "string"
    )
      return { ok: false, error: "슬롯 형식 오류." };
    const start = new Date((s as Slot).start).getTime();
    const end = new Date((s as Slot).end).getTime();
    if (Number.isNaN(start) || Number.isNaN(end))
      return { ok: false, error: "시작/종료 시각이 올바르지 않습니다." };
    if (end <= start)
      return { ok: false, error: "종료 시각은 시작 시각보다 뒤여야 합니다." };
    if (start < now)
      return { ok: false, error: "과거 시각은 제시할 수 없습니다." };
    if (start > max)
      return { ok: false, error: "60일 이내의 시각만 제시 가능합니다." };
    out.push({ start: (s as Slot).start, end: (s as Slot).end });
  }
  return { ok: true, slots: out };
}

export function formatSlotKst(slot: Slot): string {
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  };
  // 같은 날이면 종료는 시간만 표시
  const s = new Date(slot.start);
  const e = new Date(slot.end);
  const sameDay =
    s.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" }) ===
    e.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });
  const endShort = sameDay
    ? e.toLocaleTimeString("ko-KR", {
        timeZone: "Asia/Seoul",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : fmt(slot.end);
  return `${fmt(slot.start)} ~ ${endShort}`;
}

/** 스케쥴 제시 메일 (면접관 → 후보자) */
export function buildScheduleProposalEmail(opts: {
  candidateName: string;
  jobTitle: string;
  orgName: string;
  url: string;
  expiresAt: string;
  slots: Slot[];
  modeOnline: boolean;
  address?: string | null;
}): { subject: string; html: string; text: string } {
  const { candidateName, jobTitle, orgName, url, expiresAt, slots, modeOnline, address } =
    opts;
  const expDate = new Date(expiresAt).toLocaleDateString("ko-KR");
  const slotLines = slots.map((s) => `· ${formatSlotKst(s)}`).join("\n");
  const subject = `[Intervia] ${jobTitle} 1차 면접 일정 안내 — 시간 선택 부탁드립니다`;
  const text = `${candidateName}님,

${orgName}의 ${jobTitle} 포지션 1차 면접 일정 안내드립니다.

다음 시간 중 가능하신 시간을 선택해 주세요:
${slotLines}

면접 방식: ${modeOnline ? "온라인" : `오프라인 (${address ?? "주소 별도 안내"})`}

아래 링크에서 시간을 선택하거나, 가능한 시간이 없으시면 다른 시간을 역제시해 주세요.
${url}

· 링크 유효기간: ${expDate}

감사합니다.
Intervia 채용팀`;
  const esc = (s: string) =>
    s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
  const slotsHtml = slots
    .map((s) => `<li style="padding:4px 0;">${esc(formatSlotKst(s))}</li>`)
    .join("");
  const html = wrapEmailCard({
    innerHtml: `
      <h1 style="font-size:20px;margin:24px 0 8px;color:#0f172a;">1차 면접 일정 안내</h1>
      <p style="font-size:14px;color:#475569;line-height:1.7;margin:0 0 20px;">
        ${esc(candidateName)}님, <strong style="color:#0f172a;">${esc(orgName)}</strong>의 <strong style="color:#0f172a;">${esc(jobTitle)}</strong> 포지션 1차 면접 일정 안내드립니다.<br>
        아래 후보 시간 중 가능한 시간을 선택해 주세요.
      </p>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin:0 0 20px;">
        <div style="color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">면접 후보 시간</div>
        <ul style="font-size:13px;color:#0f172a;line-height:1.7;margin:0;padding-left:18px;">${slotsHtml}</ul>
        <div style="margin-top:12px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:13px;color:#475569;">
          면접 방식: <strong style="color:#0f172a;">${modeOnline ? "온라인" : "오프라인"}</strong>
          ${!modeOnline && address ? `<br>주소: ${esc(address)}` : ""}
        </div>
      </div>
      <p style="text-align:center;margin:0 0 12px;">
        <a href="${url}" style="display:inline-block;background:${EMAIL_BRAND.primary};color:#fff;text-decoration:none;font-weight:600;padding:12px 28px;border-radius:10px;font-size:14px;">시간 선택하기</a>
      </p>
      <p style="font-size:12px;color:#64748b;margin:0 0 0;text-align:center;line-height:1.6;">
        가능한 시간이 없으시면 링크에서 다른 시간을 역제시하실 수 있습니다.<br>
        링크 유효기간: <strong>${expDate}</strong>
      </p>
    `,
    footer: "본 메일은 Intervia 채용 플랫폼에서 발송되었습니다.",
  });
  return { subject, html, text };
}

/** 온라인 미팅 링크 URL 최소 검증 — https:// 시작 + 100자 이내 + 공백 없음. */
export function isValidMeetingUrl(url: string): boolean {
  const t = url.trim();
  if (t.length === 0 || t.length > 100) return false;
  if (!/^https:\/\//.test(t)) return false;
  if (/\s/.test(t)) return false;
  try {
    new URL(t);
    return true;
  } catch {
    return false;
  }
}

/** ICS 캘린더 invite — 한 슬롯 → .ics 본문 문자열. */
export function buildIcsInvite(opts: {
  uid: string;
  slot: Slot;
  title: string;
  description: string;
  location: string;
  organizerEmail?: string;
  organizerName?: string;
}): string {
  const { uid, slot, title, description, location, organizerEmail, organizerName } =
    opts;
  const fmt = (iso: string) =>
    new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  const now = fmt(new Date().toISOString());
  const organizerLine =
    organizerEmail && organizerName
      ? `ORGANIZER;CN=${esc(organizerName)}:mailto:${organizerEmail}`
      : organizerEmail
        ? `ORGANIZER:mailto:${organizerEmail}`
        : "";
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Intervia//Interview Schedule//KO",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${fmt(slot.start)}`,
    `DTEND:${fmt(slot.end)}`,
    `SUMMARY:${esc(title)}`,
    `DESCRIPTION:${esc(description)}`,
    `LOCATION:${esc(location)}`,
    ...(organizerLine ? [organizerLine] : []),
    "STATUS:CONFIRMED",
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

/** 미팅 링크 안내 메일 — 확정 일정 + 미팅 URL + 안내문 + ICS 첨부 분리(라우트에서). */
export function buildMeetingLinkEmail(opts: {
  candidateName: string;
  jobTitle: string;
  orgName: string;
  slot: Slot;
  meetingUrl: string;
  note?: string | null;
  forInterviewer?: boolean;
}): { subject: string; html: string; text: string } {
  const { candidateName, jobTitle, orgName, slot, meetingUrl, note, forInterviewer } =
    opts;
  const slotStr = formatSlotKst(slot);
  const subject = forInterviewer
    ? `[Intervia] ${candidateName} 후보자 온라인 면접 링크 안내`
    : `[Intervia] ${jobTitle} 1차 면접 — 온라인 미팅 링크`;
  const greeting = forInterviewer
    ? `${candidateName} 후보자에게 안내된 온라인 미팅 링크입니다.`
    : `${candidateName}님, ${orgName}의 ${jobTitle} 포지션 1차 면접 온라인 미팅 정보입니다.`;
  const noteText = note?.trim() ? `\n\n· 추가 안내:\n${note.trim()}` : "";
  const text = `${greeting}

· 일시: ${slotStr}
· 미팅 링크: ${meetingUrl}${noteText}

Intervia 채용팀`;
  const esc = (s: string) =>
    s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
  const noteHtml = note?.trim()
    ? `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin-top:14px;">
         <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">추가 안내</div>
         <div style="font-size:13px;color:#0f172a;line-height:1.6;white-space:pre-wrap;">${esc(note.trim())}</div>
       </div>`
    : "";
  const html = wrapEmailCard({
    innerHtml: `
      <h1 style="font-size:20px;margin:24px 0 8px;color:#0f172a;">🎥 온라인 면접 미팅 안내</h1>
      <p style="font-size:14px;color:#475569;line-height:1.7;margin:0 0 20px;">${esc(greeting)}</p>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin:0 0 16px;">
        <p style="margin:0 0 4px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">일시</p>
        <p style="margin:0 0 14px;font-size:15px;font-weight:600;color:#0f172a;">${esc(slotStr)}</p>
        <p style="margin:0 0 4px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">미팅 링크</p>
        <p style="margin:0;font-size:13px;color:#0f172a;word-break:break-all;">
          <a href="${esc(meetingUrl)}" style="color:${EMAIL_BRAND.primary};text-decoration:underline;">${esc(meetingUrl)}</a>
        </p>
      </div>
      <p style="text-align:center;margin:0 0 8px;">
        <a href="${esc(meetingUrl)}" style="display:inline-block;background:${EMAIL_BRAND.primary};color:#fff;text-decoration:none;font-weight:600;padding:12px 28px;border-radius:10px;font-size:14px;">미팅 참여하기</a>
      </p>
      ${noteHtml}
      <p style="font-size:12px;color:#64748b;margin:14px 0 0;text-align:center;line-height:1.6;">
        첨부된 캘린더 파일(.ics) 을 열어 본인 캘린더에 등록하실 수 있습니다.
      </p>
    `,
    footer: "본 메일은 Intervia 채용 플랫폼에서 발송되었습니다.",
  });
  return { subject, html, text };
}

/** 면접 확정 통보 메일 (지원자가 시간 선택 후 → 본인에게 + 면접관에게) */
export function buildScheduleConfirmedEmail(opts: {
  candidateName: string;
  jobTitle: string;
  orgName: string;
  slot: Slot;
  modeOnline: boolean;
  address?: string | null;
  forInterviewer?: boolean;
}): { subject: string; html: string; text: string } {
  const { candidateName, jobTitle, orgName, slot, modeOnline, address, forInterviewer } = opts;
  const slotStr = formatSlotKst(slot);
  const subject = forInterviewer
    ? `[Intervia] ${candidateName} 후보자 1차 면접 시간 확정`
    : `[Intervia] ${jobTitle} 1차 면접 시간 확정`;
  const greeting = forInterviewer
    ? `${candidateName} 후보자가 ${jobTitle} 1차 면접 시간을 다음과 같이 선택했습니다.`
    : `${candidateName}님, ${orgName}의 ${jobTitle} 포지션 1차 면접 시간이 확정되었습니다.`;
  const text = `${greeting}

· 일시: ${slotStr}
· 방식: ${modeOnline ? "온라인" : `오프라인 (${address ?? "주소 별도 안내"})`}

Intervia 채용팀`;
  const esc = (s: string) =>
    s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
  const html = wrapEmailCard({
    innerHtml: `
      <h1 style="font-size:20px;margin:24px 0 8px;color:#0f172a;">✅ 1차 면접 시간 확정</h1>
      <p style="font-size:14px;color:#475569;line-height:1.7;margin:0 0 20px;">${esc(greeting)}</p>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin:0 0 8px;">
        <p style="margin:0 0 4px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">일시</p>
        <p style="margin:0 0 14px;font-size:15px;font-weight:600;color:#0f172a;">${esc(slotStr)}</p>
        <p style="margin:0 0 4px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">방식</p>
        <p style="margin:0;font-size:14px;color:#0f172a;">
          ${modeOnline ? "온라인" : "오프라인"}
          ${!modeOnline && address ? `<br><span style="font-size:13px;color:#475569;">${esc(address)}</span>` : ""}
        </p>
      </div>
    `,
    footer: "본 메일은 Intervia 채용 플랫폼에서 발송되었습니다.",
  });
  return { subject, html, text };
}
