/**
 * 공고 객관식 사전 문항 세트 — 조회(HR 검토용, 정답 포함) / 확정 저장 / 비우기.
 *
 * 생성은 ./generate (POST) 가 담당하고 결과는 클라이언트가 검토(불필요 문항 삭제)한 뒤
 * 이 PUT 으로 확정 저장한다. 빈 배열 저장 = 객관식 끄기(mcqSet=null).
 */
import { db } from "@/lib/db";
import { jobPostings } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { isJobUnlocked } from "@/lib/job-lock";
import { sanitizeMcqSet, MCQ_GEN_STALE_MS } from "@/lib/mcq";

export const runtime = "nodejs";

async function authorize(idParam: string) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return { error: guard as Response };
  const jobId = Number(idParam);
  const [job] = await db
    .select()
    .from(jobPostings)
    .where(eq(jobPostings.id, jobId));
  if (!job) return { error: new Response("Not found", { status: 404 }) };
  if (!ownsOrg(me!, job.orgId))
    return { error: new Response("Not found", { status: 404 }) };
  if (
    me!.role !== "system_admin" &&
    job.passwordHash &&
    !(await isJobUnlocked(jobId))
  ) {
    return {
      error: new Response("잠긴 공고입니다. 먼저 잠금을 해제하세요.", {
        status: 403,
      }),
    };
  }
  return { me: me!, job, jobId };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const a = await authorize(id);
  if ("error" in a) return a.error;
  const set = a.job.mcqSet ?? [];
  const genAt = a.job.mcqGeneratingAt ? Date.parse(a.job.mcqGeneratingAt) : 0;
  const generating = !!genAt && Date.now() - genAt < MCQ_GEN_STALE_MS;
  return Response.json({
    questions: set,
    count: set.length,
    generating,
    enabled: a.job.mcqEnabled,
  });
}

// AI 면접 적용 on/off 토글 — 문항은 그대로 두고 출제 여부만 바꾼다.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const a = await authorize(id);
  if ("error" in a) return a.error;
  const body = (await req.json()) as { enabled?: unknown };
  const enabled = body.enabled === true;
  await db
    .update(jobPostings)
    .set({ mcqEnabled: enabled })
    .where(eq(jobPostings.id, a.jobId));
  return Response.json({ enabled, count: (a.job.mcqSet ?? []).length });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const a = await authorize(id);
  if ("error" in a) return a.error;

  const body = (await req.json()) as { questions?: unknown };
  const set = sanitizeMcqSet(body.questions);
  const empty = set.length === 0;
  // 비어있지 않으면 그 세트로 확정(토글 상태는 유지). 모두 삭제하면 null + 적용도 자동 off.
  await db
    .update(jobPostings)
    .set({
      mcqSet: empty ? null : set,
      mcqGeneratingAt: null,
      ...(empty ? { mcqEnabled: false } : {}),
    })
    .where(eq(jobPostings.id, a.jobId));

  return Response.json({ questions: set, count: set.length, generating: false });
}
