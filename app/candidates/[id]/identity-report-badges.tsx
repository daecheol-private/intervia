"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldAlert, Link2, UserCheck } from "lucide-react";
import { Badge } from "@/app/components/ui";
import { formatKstDateTime } from "@/lib/utils";

type Info = {
  reportedAt: string | null;
  newApplication: { id: number; name: string } | null;
  related: { id: number; name: string }[];
  sameName: boolean;
};

/**
 * 후보 상세 헤더 — 명의도용 신고 표시.
 *  - 신고된 지원서: "명의도용 신고됨" (+ 신고와 함께 접수된 새 지원서 링크)
 *  - 신고로 접수된 새 지원서: "관련 지원서 N건" 링크 (+ 이름이 같으면 "동일인 의심")
 */
export function IdentityReportBadges({
  candidateId,
  reportedAt,
  reportOf,
  reportNewId,
}: {
  candidateId: number;
  reportedAt?: string | null;
  reportOf?: number | null;
  reportNewId?: number | null;
}) {
  const [info, setInfo] = useState<Info | null>(null);
  const relevant = !!reportedAt || reportOf != null || reportNewId != null;

  useEffect(() => {
    if (!relevant) return;
    let alive = true;
    fetch(`/api/candidates/${candidateId}/identity-report`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Info | null) => {
        if (alive) setInfo(j);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [candidateId, relevant, reportedAt, reportOf, reportNewId]);

  if (!relevant) return null;
  const related = info?.related ?? [];
  const target = related[0] ?? info?.newApplication ?? null;
  return (
    <>
      {reportedAt && (
        <Badge
          tone="danger"
          icon={ShieldAlert}
          title={`${formatKstDateTime(reportedAt)} 휴대폰 번호 소유자가 본인 제출이 아니라고 신고했습니다. 자동 진행이 멈췄고 서류평가 차감은 환불됐습니다.`}
        >
          명의도용 신고됨
        </Badge>
      )}
      {related.length > 0 && target && (
        <Link href={`/candidates/${target.id}`}>
          <Badge tone="neutral" icon={Link2} className="hover:bg-border-default">
            관련 지원서 {related.length}건
          </Badge>
        </Link>
      )}
      {reportedAt && info?.newApplication && (
        <Link href={`/candidates/${info.newApplication.id}`}>
          <Badge tone="neutral" icon={Link2} className="hover:bg-border-default">
            새로 접수된 지원서
          </Badge>
        </Link>
      )}
      {info?.sameName && (
        <Badge
          tone="warning"
          icon={UserCheck}
          title="신고된 지원서와 이름이 같습니다. 같은 사람이 다시 지원했을 수 있습니다."
        >
          동일인 의심
        </Badge>
      )}
    </>
  );
}
