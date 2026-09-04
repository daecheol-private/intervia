import { db } from "@/lib/db";
import { after } from "next/server";
import {
  jobPostings,
  candidates,
  jobInterviewers,
  organizations,
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
import { logAudit } from "@/lib/audit";
import {
  generateRequirementChecklist,
  serializeChecklist,
} from "@/lib/job-checklist";
import { traitProfileInputToJson } from "@/lib/personality";
import { normalizeSourceUrl } from "@/lib/job-source";
import { MCQ_TARGET_COUNT } from "@/lib/mcq";
import { log } from "@/lib/logger";

export const runtime = "nodejs";
// mcqAutoGenerate 시 after() 에서 LLM 2회 호출(생성+검증) — 수십 초 소요. 넉넉히 잡는다.
export const maxDuration = 120;

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

  // "지원링크 생성"으로 미리 발급한 토큰이 있으면 이 정식 공고에 붙인다(같은 링크 유지).
  const applyToken =
    typeof body.applyToken === "string" && /^ap_[A-Za-z0-9_-]{10,60}$/.test(body.applyToken)
      ? body.applyToken
      : null;

  // 공고 생성과 함께 역량평가(객관식) 자동 생성·적용 여부. true 면 아래 after() 가 LLM 으로
  // 문항을 생성해 저장하고 mcqEnabled=true 로 켠다(HR 검토 없이 바로 적용, 불일치는 버튼색 경고).
  const wantMcq = body.mcqAutoGenerate === true;

  // 원본 공고 URL — 자동 채우기로 가져왔거나, 입력칸에 주소만 적어 저장한 경우 둘 다 기록.
  const sourceUrl = normalizeSourceUrl(body.sourceUrl);
  // "가져오기"로 본문까지 실제로 불러왔을 때만 true. URL 만 적어 저장한 경우 링크만 남기고
  // 불러온 시각은 비운다(불러온 적 없는데 시각이 찍히는 것을 막는다).
  const sourceImported = body.sourceImported === true;

  const now = new Date();
  const [row] = await db
    .insert(jobPostings)
    .values({
      orgId,
      applyToken,
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
      sourceUrl,
      sourceImportedAt: sourceUrl && sourceImported ? now.toISOString() : null,
      publishedAt: now.toISOString(),
      closesAt: defaultClosesAt(now),
      createdByUserId: me!.id,
      // 역량평가 자동 생성 요청 시 진행 표시 — 공고 상세 진입 시 McqPanel 이 "생성 중"으로 폴링.
      mcqGeneratingAt: wantMcq ? now.toISOString() : null,
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

  logAudit(req, {
    actor: me!,
    action: "job.create",
    resourceType: "job",
    resourceId: row.id,
    orgId,
    jobId: row.id,
    metadata: { title: row.title },
  });

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

  // 역량평가 자동 생성 — 요청 시에만. LLM 2회 호출(생성+검증)이라 응답 후 백그라운드로 처리하고,
  // 그동안 상세 페이지의 McqPanel 이 "생성 중"으로 폴링한다. 실패해도 공고 자체는 정상.
  if (wantMcq) {
    after(async () => {
      try {
        // 무거운 LLM 모듈은 여기서만 lazy load — 라우트 top-level 번들에 gemini(@google/genai)를
        // 끌어들이지 않는다. (dev 컴파일 그래프 비대화로 인한 테스트 서버 소켓 플레이크 회피 +
        // mcqAutoGenerate=false 인 대다수 공고 생성에서 미사용 모듈 로딩 절약.)
        const { generateMcqSet } = await import("@/lib/mcq-generate");
        let companyName: string | null = null;
        if (orgId) {
          const [org] = await db
            .select({ name: organizations.name })
            .from(organizations)
            .where(eq(organizations.id, orgId));
          companyName = org?.name ?? null;
        }
        const questions = await generateMcqSet(
          {
            company: companyName,
            position: body.position,
            level: body.level,
            employmentType: body.employmentType,
            responsibilities: body.responsibilities,
            requirements: body.requirements,
            idealProfile: body.idealProfile ?? "",
          },
          MCQ_TARGET_COUNT
        );
        // 생성 성공 → 세트 저장 + 기본 적용(ON). HR 이 상세에서 검토·토글로 조정 가능.
        await db
          .update(jobPostings)
          .set({ mcqSet: questions, mcqGeneratingAt: null, mcqEnabled: true })
          .where(eq(jobPostings.id, row.id));
      } catch (e) {
        log.error("mcq_autogenerate_failed", {
          jobId: row.id,
          error: e instanceof Error ? e.message : String(e),
        });
        // 진행 표시만 해제 — 공고 상세에서 "문제 생성"으로 재시도 가능(기존 세트 없음).
        await db
          .update(jobPostings)
          .set({ mcqGeneratingAt: null })
          .where(eq(jobPostings.id, row.id));
      }
    });
  }

  return Response.json(row);
}
