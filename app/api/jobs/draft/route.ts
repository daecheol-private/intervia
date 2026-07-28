import { db } from "@/lib/db";
import { jobPostings, jobInterviewers } from "@/lib/schema";
import { getCurrentUser, hashPassword } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { isValidPin } from "@/lib/job-lock";
import { rateLimit } from "@/lib/rate-limit";
import { defaultClosesAt } from "@/lib/job-lifecycle";
import { generateApplyToken } from "@/lib/apply-link";
import { stripBiasedLines } from "@/lib/job-bias-filter";
import { traitProfileInputToJson } from "@/lib/personality";
import { normalizeSourceUrl } from "@/lib/job-source";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

const TONES = new Set(["친절한", "중립적인", "엄격한"]);
const str = (v: unknown, max = 3000) =>
  typeof v === "string" ? v.slice(0, max) : "";

/**
 * 임시 공고 생성 — "URL 먼저, 공고 내용 나중" 시나리오.
 *
 * 지원 링크(apply_token)만 즉시 발급해 사람인 등에 등록할 수 있게 하고, JD 는 비워둔다.
 * - job_post 미과금 (정식 전환 시 과금).
 * - 들어온 이력서는 파싱·마스킹만 되고 LLM 평가는 hold (worker 가 isDraft 면 평가 skip).
 * 이후 공고 수정 화면에서 내용을 채워 저장하면 정식 공고로 전환된다(PUT /api/jobs/[id]).
 */
export async function POST(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role !== "system_admin" && me!.orgId == null)
    return new Response("법인이 지정되지 않은 계정입니다.", { status: 403 });

  const limited = await rateLimit(req, "job-create", { limit: 10, windowSec: 600 }, me!.id);
  if (limited) return limited;

  // 폼에서 작성 중이던 내용이 있으면 함께 저장(유실 방지). 전부 선택 — 비면 placeholder.
  // 임시 상태에선 미과금 + 검증 느슨(정식 전환 PUT 에서 필수항목·도메인·과금 처리).
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    /* 본문 없이 호출 가능 — 빈 임시공고 */
  }

  // 클라이언트가 미리 발급한 지원 토큰이 있으면 사용(저장 전 링크를 먼저 보여준 경우), 없으면 생성.
  const providedToken =
    typeof body.applyToken === "string" && /^ap_[A-Za-z0-9_-]{10,60}$/.test(body.applyToken)
      ? body.applyToken
      : null;

  const trait = traitProfileInputToJson(body.traitProfile);
  let passwordHash: string | null = null;
  if (typeof body.password === "string" && body.password.length > 0 && isValidPin(body.password)) {
    passwordHash = await hashPassword(body.password);
  }
  const tone = TONES.has(body.tone as string) ? (body.tone as string) : "친절한";
  const durationRaw = Number(body.interviewDurationMinutes);
  const duration = [10, 20, 30].includes(durationRaw) ? durationRaw : 20;

  const orgId = me!.orgId;
  const now = new Date();
  // 임시공고도 URL 자동 채우기 출처를 남긴다 — 정식 전환 때 "다시 불러오기"로 이어진다.
  const sourceUrl = normalizeSourceUrl(body.sourceUrl);

  const [row] = await db
    .insert(jobPostings)
    .values({
      orgId,
      isDraft: true,
      applyToken: providedToken ?? generateApplyToken(),
      // 비면 placeholder(NOT NULL 충족). 입력했으면 그대로 저장 → 정식 전환 때 이어서 작성.
      title: str(body.title, 200).trim() || "(작성 중인 임시 공고)",
      position: str(body.position, 200),
      level: str(body.level, 100),
      employmentType: str(body.employmentType, 50),
      responsibilities: str(body.responsibilities),
      requirements: str(body.requirements),
      requirementChecklist: "",
      idealProfile: str(body.idealProfile),
      evaluationFocus: stripBiasedLines(str(body.evaluationFocus)).cleaned,
      traitProfile: trait.error ? null : trait.json,
      tone: tone as "친절한" | "중립적인" | "엄격한",
      interviewDurationMinutes: duration,
      passwordHash,
      recruitingContactEmail: str(body.recruitingContactEmail, 200).trim() || me!.email,
      sourceUrl,
      sourceImportedAt: sourceUrl ? now.toISOString() : null,
      publishedAt: now.toISOString(),
      closesAt: defaultClosesAt(now),
      createdByUserId: me!.id,
    })
    .returning();

  // 생성자 자동 면접관 등록 (정식 공고 생성과 동일).
  await db
    .insert(jobInterviewers)
    .values({ jobId: row.id, userId: me!.id, assignedByUserId: me!.id })
    .onConflictDoNothing();

  logAudit(req, {
    actor: me!,
    action: "job.draft_create",
    resourceType: "job",
    resourceId: row.id,
    orgId,
  });

  return Response.json({
    id: row.id,
    token: row.applyToken,
    path: `/apply/${row.applyToken}`,
  });
}
