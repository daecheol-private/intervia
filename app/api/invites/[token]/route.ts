/**
 * 초대 정보 조회 — 랜딩 페이지가 토큰 유효성·법인명·공고 확인용으로 호출.
 * 비로그인도 호출 가능 (이메일은 마스킹).
 */
import { db } from "@/lib/db";
import { orgInvites, organizations, jobPostings, users } from "@/lib/schema";
import { eq, sql } from "drizzle-orm";

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

  // 모든 초대는 공고 공유로 발급된다(jobId 항상 세팅). 공고 삭제 시 FK set null 로
  // jobId 가 비므로, jobId 가 null = 공유된 공고가 삭제됨. 랜딩에서 안내 배너용.
  const jobDeleted = inv.jobId == null;

  // 이미 이 이메일로 가입한 계정이 있으면 상태를 알려준다. 초대는 승인 시점에야
  // consume 되므로(usedAt), 가입 후 승인 전 구간엔 토큰이 살아 있다. 그때 재방문하면
  // 가입 폼을 다시 보여주는 대신 "이미 가입됨" 안내를 띄우기 위함(랜딩에서 분기).
  // 토큰 소유자 = 초대받은 본인이므로 자기 이메일 가입 여부 노출은 위험 없음.
  const [acct] = await db
    .select({ status: users.status })
    .from(users)
    .where(sql`lower(${users.email}) = lower(${inv.email})`);

  return Response.json({
    token: inv.token,
    orgId: inv.orgId,
    orgName: org?.name ?? "법인",
    emailMasked: maskEmail(inv.email),
    job,
    jobDeleted,
    expiresAt: inv.expiresAt,
    account: acct ? { status: acct.status } : null,
  });
}
