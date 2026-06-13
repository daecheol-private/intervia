import { db } from "@/lib/db";
import { after } from "next/server";
import {
  jobPostings,
  candidates,
  jobInterviewers,
} from "@/lib/schema";
import { desc, eq, count, sql, and } from "drizzle-orm";
import { getCurrentUser, hashPassword } from "@/lib/auth";
import { getEmailDomain } from "@/lib/email-domain";
import { validateRecruitingContactEmail } from "@/lib/job-contact";
import { jobOrgFilter, requireUser } from "@/lib/tenant";
import { isValidPin } from "@/lib/job-lock";
import { rateLimit } from "@/lib/rate-limit";
import { chargeFeature } from "@/lib/tokens";
import { requireSpendableBalance, insufficientTokensResponse } from "@/lib/wallet-guard";
import { defaultClosesAt } from "@/lib/job-lifecycle";
import { stripBiasedLines } from "@/lib/job-bias-filter";
import {
  generateRequirementChecklist,
  serializeChecklist,
} from "@/lib/job-checklist";
import { traitProfileInputToJson } from "@/lib/personality";

export const runtime = "nodejs";

export async function GET() {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  // 내가 면접관인 공고 ID — 정렬 1순위 (로그인 계정이 면접관인 공고를 위로)
  const interviewerRows = await db
    .select({ jobId: jobInterviewers.jobId })
    .from(jobInterviewers)
    .where(eq(jobInterviewers.userId, me!.id));
  const interviewerSet = new Set(interviewerRows.map((r) => r.jobId));

  const rows = await db
    .select({
      id: jobPostings.id,
      title: jobPostings.title,
      position: jobPostings.position,
      level: jobPostings.level,
      employmentType: jobPostings.employmentType,
      createdAt: jobPostings.createdAt,
      passwordHash: jobPostings.passwordHash,
      status: jobPostings.status,
      publishedAt: jobPostings.publishedAt,
      closesAt: jobPostings.closesAt,
      closedAt: jobPostings.closedAt,
      extensionCount: jobPostings.extensionCount,
      candidateCount: count(candidates.id),
      screenedCount: sql<number>`COALESCE(SUM(CASE WHEN ${candidates.screeningScore} IS NOT NULL THEN 1 ELSE 0 END), 0)`,
      interviewedCount: sql<number>`COALESCE(SUM(CASE WHEN ${candidates.stage} IN ('round1_candidate','round1_scheduling','round1_waiting','round1_passed','round2_passed') THEN 1 ELSE 0 END), 0)`,
    })
    .from(jobPostings)
    .leftJoin(candidates, eq(candidates.jobId, jobPostings.id))
    .where(and(jobOrgFilter(me!)))
    .groupBy(jobPostings.id)
    .orderBy(desc(jobPostings.createdAt));

  // 정렬: 내가 면접관(1) → 최신 등록순(SQL desc 유지)
  const sorted = [...rows].sort((a, b) => {
    const ai = interviewerSet.has(a.id) ? 1 : 0;
    const bi = interviewerSet.has(b.id) ? 1 : 0;
    if (ai !== bi) return bi - ai;
    return 0;
  });

  return Response.json(
    sorted.map(({ passwordHash, ...r }) => ({
      ...r,
      hasPassword: passwordHash != null,
    }))
  );
}

export async function POST(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role !== "system_admin" && me!.orgId == null)
    return new Response("법인이 지정되지 않은 계정입니다.", { status: 403 });

  // 생성 직후 LLM 체크리스트 호출이 따라붙으므로 무제한 생성은 비용 공격이 된다.
  const limited = await rateLimit(
    req,
    "job-create",
    { limit: 10, windowSec: 600 },
    me!.id
  );
  if (limited) return limited;

  const body = await req.json();
  const required = ["title", "position", "level", "employmentType", "responsibilities", "requirements"];
  for (const k of required) {
    if (!body[k]) return new Response(`${k} 필수`, { status: 400 });
  }

  let passwordHash: string | null = null;
  if (body.password) {
    if (!isValidPin(body.password))
      return new Response("비밀번호는 4자리 숫자여야 합니다.", { status: 400 });
    passwordHash = await hashPassword(body.password);
  }

  const trait = traitProfileInputToJson(body.traitProfile);
  if (trait.error) return new Response(trait.error, { status: 400 });

  const orgId =
    me!.role === "system_admin"
      ? Number(body.orgId ?? me!.orgId ?? 0) || null
      : me!.orgId;

  // 채용 담당자 이메일 — §37의2 안내문에 공개될 연락처(지원자의 거부·이의제기 채널).
  // 미입력 시 작성자 이메일로 폴백(빈칸 방지). 회사 도메인 외 이메일은 거부.
  const expectedDomain =
    me!.role === "system_admin" ? null : getEmailDomain(me!.email);
  const contact = validateRecruitingContactEmail(
    body.recruitingContactEmail || me!.email,
    expectedDomain
  );
  if (!contact.ok) return new Response(contact.message, { status: 400 });

  // 잔액 가드 — 0 이하면 차단 (공고 생성도 토큰 차감 대상)
  const balanceGuard = await requireSpendableBalance(orgId, {
    isSystemAdmin: me!.role === "system_admin",
  });
  if (!balanceGuard.ok) return insufficientTokensResponse(balanceGuard);

  const now = new Date();
  const [row] = await db
    .insert(jobPostings)
    .values({
      orgId,
      title: body.title,
      position: body.position,
      level: body.level,
      employmentType: body.employmentType,
      responsibilities: body.responsibilities,
      requirements: body.requirements,
      // JD 요건 체크리스트는 LLM 호출이라 느리다 → 응답 후 after() 백그라운드 생성.
      // 그 사이 체크리스트는 "" 라 이력서 평가는 기존 즉석 분해로 폴백 (정상 동작).
      requirementChecklist: "",
      idealProfile: (body.idealProfile ?? "").toString().slice(0, 3000),
      traitProfile: trait.json,
      // 차별 금지 항목(성별·나이·결혼 등) 포함 라인은 저장 전 제거 (채용절차법 §4의3)
      evaluationFocus: stripBiasedLines(
        (body.evaluationFocus ?? "").toString().slice(0, 3000)
      ).cleaned,
      tone: body.tone ?? "중립적인",
      interviewDurationMinutes: body.interviewDurationMinutes ?? 20,
      passwordHash,
      recruitingContactEmail: contact.email,
      publishedAt: now.toISOString(),
      closesAt: defaultClosesAt(now),
      createdByUserId: me!.id,
    })
    .returning();

  // 공고 생성자 자동 면접관 등록 (system_admin 도 포함)
  await db
    .insert(jobInterviewers)
    .values({
      jobId: row.id,
      userId: me!.id,
      assignedByUserId: me!.id,
    })
    .onConflictDoNothing();

  if (orgId) {
    await chargeFeature({
      orgId,
      feature: "job_post",
      refType: "job",
      refId: row.id,
      userId: me!.id,
      memo: row.title,
    });
  }

  // 응답을 먼저 돌려주고(공고 즉시 등록 + 페이지 이동), JD 요건 체크리스트는
  // 백그라운드에서 생성해 행을 업데이트한다. 실패해도 평가는 폴백되므로 무시.
  after(async () => {
    try {
      const checklist = serializeChecklist(
        await generateRequirementChecklist({
          responsibilities: body.responsibilities,
          requirements: body.requirements,
        })
      );
      if (checklist) {
        await db
          .update(jobPostings)
          .set({ requirementChecklist: checklist })
          .where(eq(jobPostings.id, row.id));
      }
    } catch {
      // 체크리스트는 보조 데이터 — 실패 시 즉석 분해 폴백으로 충분.
    }
  });

  return Response.json(row);
}
