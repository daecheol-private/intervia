"use client";

import Link from "next/link";

/**
 * 알림 목록 항목 링크 — 클릭 시 읽음 처리 후 이동.
 *
 * 이동은 <Link> 가 담당하고, 클릭 순간 읽음 처리 POST 를 함께 쏜다.
 * keepalive:true — 클릭 즉시 네비게이션이 시작돼(soft/hard 무관) 페이지가
 * 언로드돼도 요청이 취소되지 않고 완료된다. 완료 후 좌측 레일 배지가 즉시
 * 줄도록 refresh 이벤트를 브로드캐스트(AppShell 의 NavNotifications 가 수신).
 */
export function NotificationLink({
  id,
  href,
  isUnread,
  className,
  children,
}: {
  id: number;
  href: string;
  isUnread: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const onClick = () => {
    if (!isUnread) return;
    fetch(`/api/notifications/${id}/read`, { method: "POST", keepalive: true })
      .then(() => {
        window.dispatchEvent(new Event("intervia:notifications-refresh"));
      })
      .catch(() => {
        /* 읽음 처리 실패해도 이동은 진행 — 다음 방문/폴링에서 재동기화 */
      });
  };
  return (
    <Link href={href} onClick={onClick} className={className}>
      {children}
    </Link>
  );
}
