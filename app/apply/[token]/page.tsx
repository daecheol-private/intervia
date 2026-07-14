import { db } from "@/lib/db";
import { jobPostings, organizations } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isJobExpired } from "@/lib/job-lifecycle";
import {
  subdomainFromHost,
  subdomainApplyEnabled,
  applyUrlFor,
} from "@/lib/subdomain";
import { PoweredByIntervia } from "@/app/components/Logo";
import ApplyForm from "./ApplyForm";

export const runtime = "nodejs";

// 공개(비로그인) 지원 페이지 — 사람인 등에서 "지원하기" 로 넘어온 후보자가 이력서를 직접 올린다.
// 토큰으로 공고를 찾는다 (공개 URL = 사실상의 인증). proxy.ts 에서 /apply/* 는 인증 면제.

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface-alt flex flex-col items-center justify-start px-4 py-6">
      <div className="w-full max-w-xl">{children}</div>
      {/* AI 면접 화면과 동일한 하단 브랜드 서명 — 콘텐츠 카드 오른쪽 끝에 맞춘다 */}
      <PoweredByIntervia className="max-w-xl mt-4 mb-2" />
    </div>
  );
}

function Notice({ title, message }: { title: string; message: string }) {
  return (
    <Shell>
      <div className="rounded-2xl bg-card shadow-sm border border-border-default p-8 text-center">
        <h1 className="text-lg font-semibold text-ink">{title}</h1>
        <p className="mt-3 text-sm text-ink-soft leading-relaxed">{message}</p>
      </div>
    </Shell>
  );
}

export default async function ApplyPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const [job] = await db
    .select({
      id: jobPostings.id,
      title: jobPostings.title,
      position: jobPostings.position,
      status: jobPostings.status,
      closesAt: jobPostings.closesAt,
      closedAt: jobPostings.closedAt,
      orgName: organizations.name,
      logoFileKey: organizations.logoFileKey,
      brandColor: organizations.brandColor,
      orgSubdomain: organizations.subdomain,
    })
    .from(jobPostings)
    .leftJoin(organizations, eq(organizations.id, jobPostings.orgId))
    .where(eq(jobPostings.applyToken, token));

  if (!job) {
    return (
      <Notice
        title="유효하지 않은 지원 링크입니다"
        message="링크가 잘못되었거나 만료되었습니다. 채용 공고의 지원 방법을 다시 확인해 주세요."
      />
    );
  }

  // 정본 호스트 강제 — 법인 서브도메인이 있으면 {sub}.intervia.kr 로, 없으면 apex 로.
  // 다른 법인 서브도메인에서 이 토큰을 여는 사칭 조합을 차단하고, 기존 apex 링크는
  // 자동으로 브랜드 주소로 승격된다. 기능 OFF(운영 기본) 땐 apex 만 정본.
  const currentSub = subdomainFromHost((await headers()).get("host"));
  const canonicalSub = subdomainApplyEnabled() ? job.orgSubdomain : null;
  if (currentSub !== canonicalSub) redirect(applyUrlFor(canonicalSub, token));

  if (job.status === "closed" || isJobExpired(job)) {
    return (
      <Notice
        title="지원이 마감되었습니다"
        message="해당 공고의 지원 접수가 종료되었습니다. 다른 공고를 확인해 주세요."
      />
    );
  }

  return (
    <Shell>
      <ApplyForm
        token={token}
        companyName={job.orgName ?? "채용 기업"}
        jobTitle={job.title}
        logoUrl={job.logoFileKey ? `/api/apply/${encodeURIComponent(token)}/logo` : null}
        brandColor={job.brandColor}
      />
    </Shell>
  );
}
