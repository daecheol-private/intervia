import type { ReactNode } from "react";
import { ShieldAlert, FileQuestion, Clock } from "lucide-react";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { sharedReports } from "@/lib/schema";
import {
  collectSharedReportData,
  shareState,
  type ShareState,
} from "@/lib/shared-report";
import { sqliteTimestamp } from "@/lib/utils";
import { logAudit } from "@/lib/audit";
import { SharedReportView } from "./shared-report-view";

export const runtime = "nodejs";
// 항상 최신 평가·상태를 반영 (캐시 금지).
export const dynamic = "force-dynamic";

export const metadata = {
  title: "평가 리포트 · Intervia",
  robots: { index: false, follow: false },
};

function StateShell({
  icon,
  title,
  desc,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <main className="mx-auto max-w-lg px-4 py-20 sm:py-28 text-center">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-surface-alt text-ink-muted mb-4">
        {icon}
      </div>
      <h1 className="text-xl font-bold text-ink">{title}</h1>
      <p className="text-sm text-ink-muted mt-2 leading-relaxed">{desc}</p>
    </main>
  );
}

function BlockedView({ state }: { state: ShareState }) {
  if (state === "revoked") {
    return (
      <StateShell
        icon={<ShieldAlert className="w-7 h-7" />}
        title="폐기된 공유 링크입니다."
        desc="이 링크는 담당자가 접근을 종료했습니다. 평가를 공유한 담당자에게 문의하세요."
      />
    );
  }
  return (
    <StateShell
      icon={<Clock className="w-7 h-7" />}
      title="만료된 공유 링크입니다."
      desc="유효 기간이 지났습니다. 평가를 공유한 담당자에게 재발급을 요청하세요."
    />
  );
}

export default async function SharedReportPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [row] = await db
    .select()
    .from(sharedReports)
    .where(eq(sharedReports.token, token));

  if (!row) {
    return (
      <StateShell
        icon={<FileQuestion className="w-7 h-7" />}
        title="링크를 찾을 수 없습니다."
        desc="주소가 정확한지 확인하거나, 평가를 공유한 담당자에게 문의하세요."
      />
    );
  }

  const state = shareState(row);
  if (state !== "active") return <BlockedView state={state} />;

  const data = await collectSharedReportData(row.candidateId);
  if (!data) {
    return (
      <StateShell
        icon={<FileQuestion className="w-7 h-7" />}
        title="링크를 찾을 수 없습니다."
        desc="공유 대상 후보자를 찾을 수 없습니다. 담당자에게 문의하세요."
      />
    );
  }

  // 조회 기록(누적 열람 수 + 최근 열람) + 감사 로그 — fire-and-forget (화면 지연 X).
  db
    .update(sharedReports)
    .set({
      viewCount: row.viewCount + 1,
      lastViewedAt: sqliteTimestamp(new Date()),
    })
    .where(eq(sharedReports.id, row.id))
    .then(
      () => {},
      () => {}
    );
  logAudit(null, {
    action: "shared_report.view",
    actorRole: "anonymous",
    resourceType: "candidate",
    resourceId: row.candidateId,
    orgId: row.orgId,
    metadata: { shareId: row.id },
  });

  if (!data.hasAny) {
    return (
      <StateShell
        icon={<Clock className="w-7 h-7" />}
        title="아직 공유할 평가가 없습니다."
        desc={`${data.candidate.name} 님의 평가가 완료되면 이 링크에 표시됩니다.`}
      />
    );
  }

  return <SharedReportView data={data} />;
}
