/**
 * 초대 정보 조회 — 랜딩 페이지가 토큰 유효성·법인명·공고 확인용으로 호출.
 * 비로그인도 호출 가능 (이메일은 마스킹).
 */
import { db } from "@/lib/db";
import { orgInvites, organizations, jobPostings } from "@/lib/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const head = local.slice(0, 2);
  return `${head}${"*".repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const [inv] = await db
    .select()
    .from(orgInvites)
    .where(eq(orgInvites.token, token));
  if (!inv)
    return Response.json(
      { code: "not_found", message: "유효하지 않은 초대 링크입니다." },
      { status: 404 }
    );
  if (inv.usedAt)
    return Response.json(
      { code: "used", message: "이미 사용된 초대 링크입니다." },
      { status: 410 }
    );
  if (new Date(inv.expiresAt) < new Date())
    return Response.json(
      { code: "expired", message: "만료된 초대 링크입니다." },
      { status: 410 }
    );

  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, inv.orgId));
  const [job] = inv.jobId
    ? await db
        .select({
          id: jobPostings.id,
          title: jobPostings.title,
          position: jobPostings.position,
        })
        .from(jobPostings)
        .where(eq(jobPostings.id, inv.jobId))
    : [];

  return Response.json({
    token: inv.token,
    orgId: inv.orgId,
    orgName: org?.name ?? "법인",
    emailMasked: maskEmail(inv.email),
    job,
    expiresAt: inv.expiresAt,
  });
}
