/**
 * 공고 객관식 사전 문항 **생성** — LLM 으로 JD 기반 4지선다 생성 + 자가검증.
 *
 * 결과는 저장하지 않고 반환만 한다. HR 이 검토(불필요 문항 삭제) 후 PUT(../mcq)으로 확정 저장.
 * 과금 없음 — 객관식은 AI 면접에 포함되는 부가 기능(공고 생성·면접 과금에 흡수).
 */
import { db } from "@/lib/db";
import { jobPostings, organizations } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { isJobUnlocked } from "@/lib/job-lock";
import { after } from "next/server";
import { generateMcqSet } from "@/lib/mcq-generate";
import { MCQ_TARGET_COUNT, MCQ_GEN_STALE_MS } from "@/lib/mcq";
import { rateLimit } from "@/lib/rate-limit";
import { log } from "@/lib/logger";

export const runtime = "nodejs";
// LLM 2회 호출(생성+검증) — Vertex 서울 기준 수십 초 소요 가능.
export const maxDuration = 120;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { id } = await params;
  const jobId = Number(id);

  // LLM 비용 DoS 방지 — 사용자/공고당 분당 호출 제한.
  const limited = await rateLimit(req, "job.mcq.generate", {
    limit: 5,
    windowSec: 60,
    identifier: `u:${me!.id}`,
  });
  if (limited) return limited;

  const [job] = await db
    .select()
    .from(jobPostings)
    .where(eq(jobPostings.id, jobId));
  if (!job) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, job.orgId))
    return new Response("Not found", { status: 404 });
  if (
    me!.role !== "system_admin" &&
    job.passwordHash &&
    !(await isJobUnlocked(jobId))
  ) {
    return new Response("잠긴 공고입니다. 먼저 잠금을 해제하세요.", {
      status: 403,
    });
  }

  // 생성에는 JD 본문이 필요 — 임시 공고/빈 JD 는 거부.
  if (job.isDraft || !job.responsibilities?.trim() || !job.requirements?.trim()) {
    return new Response(
      "공고 내용(주요 업무·자격 요건)을 먼저 채워야 문제를 생성할 수 있습니다.",
      { status: 400 }
    );
  }

  // 이미 생성 진행 중(stale 아님)이면 중복 생성 방지 — 폴링 그대로 진행시킨다.
  const genAt = job.mcqGeneratingAt ? Date.parse(job.mcqGeneratingAt) : 0;
  if (genAt && Date.now() - genAt < MCQ_GEN_STALE_MS) {
    return Response.json({ generating: true });
  }

  let companyName: string | null = null;
  if (job.orgId) {
    const [org] = await db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, job.orgId));
    companyName = org?.name ?? null;
  }

  const jobInput = {
    company: companyName,
    position: job.position,
    level: job.level,
    employmentType: job.employmentType,
    responsibilities: job.responsibilities,
    requirements: job.requirements,
    idealProfile: job.idealProfile,
  };

  // 진행 표시 세팅 후 즉시 응답 — 실제 생성은 백그라운드(after). 새로고침해도 GET 이 generating 으로
  // 응답하고, 완료되면 mcqSet 이 저장돼 "문제 보기"로 바뀐다. 기존 세트는 완료 직전까지 보존.
  await db
    .update(jobPostings)
    .set({ mcqGeneratingAt: new Date().toISOString() })
    .where(eq(jobPostings.id, jobId));

  after(async () => {
    try {
      const questions = await generateMcqSet(jobInput, MCQ_TARGET_COUNT);
      // 생성 성공 → 세트 저장 + 기본 적용(ON). HR 이 토글로 끌 수 있다.
      await db
        .update(jobPostings)
        .set({
          mcqSet: questions,
          mcqGeneratingAt: null,
          mcqEnabled: true,
          // 재생성된 문항이므로 영어 번역 캐시 무효화 — 다음 영어 지원자 진입 시 재번역.
          mcqSetEn: null,
          mcqEnTranslatingAt: null,
        })
        .where(eq(jobPostings.id, jobId));
    } catch (e) {
      log.error("mcq_generate_failed", {
        jobId,
        error: e instanceof Error ? e.message : String(e),
      });
      // 진행 표시만 해제 — 기존 mcqSet 은 보존(재생성 가능).
      await db
        .update(jobPostings)
        .set({ mcqGeneratingAt: null })
        .where(eq(jobPostings.id, jobId));
    }
  });

  return Response.json({ generating: true }, { status: 202 });
}
