import type { Round1ScheduleItem } from "./types";

/** 같은 차수·같은 시각·같은 방식(온/오프라인)·같은 장소의 일정을 하나로 묶음. */
type Round1ScheduleGroup = {
  key: string;
  round: "round1" | "round2";
  selectedSlot: { start: string; end: string };
  modeOnline: boolean;
  address: string | null;
  addressDetail: string | null;
  members: Round1ScheduleItem[];
};

export function groupRound1Schedule(
  items: Round1ScheduleItem[]
): Round1ScheduleGroup[] {
  const map = new Map<string, Round1ScheduleGroup>();
  for (const s of items) {
    const key = [
      s.round,
      s.selectedSlot.start,
      s.selectedSlot.end,
      s.modeOnline ? "on" : "off",
      s.address ?? "",
      s.addressDetail ?? "",
    ].join("|");
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        round: s.round,
        selectedSlot: s.selectedSlot,
        modeOnline: s.modeOnline,
        address: s.address,
        addressDetail: s.addressDetail,
        members: [],
      };
      map.set(key, g);
    }
    g.members.push(s);
  }
  // items 가 이미 시간순 → Map 삽입순(시간순) 유지.
  return Array.from(map.values());
}

/** 팝업용 슬롯 포맷 — "2026. 06. 03. (수) 13:30 ~ 14:30" (KST). */
export function fmtSlotRange(slot: { start: string; end: string }): string {
  const s = new Date(slot.start);
  const e = new Date(slot.end);
  const datePart = s.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const endTime = e.toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${datePart} ~ ${endTime}`;
}
