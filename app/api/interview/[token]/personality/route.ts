/**
 * 인성검사(컬처핏 사전 문항) 응답 제출 — AI 면접 채팅 시작 전 1회.
 * 채점은 서버 결정적 코드 (lib/personality.ts). LLM 미관여.
 */
import { db } from "@/lib/db";
import {
  interviewSessions,
  candidates,
  jobPostings,
  organizations,
} from "@/lib/schema";
import { eq } from "drizzle-orm";
import { hasValidConsent } from "@/lib/consent";
import { rateLimit } from "@/lib/rate-limit";
import {
  buildItemSet,
  parseTraitProfile,
  validateResponses,
  scoreResponses,
  type PersonalityResponse,
} from "@/lib/personality";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const limited = await rateLimit(req, "interview.personality", {
    limit: 5,
    windowSec: 60,
    identifier: `t:${token}`,
  });
  if (limited) return limited;

  const [session] = await db
    .select()
    .from(interviewSessions)
    .where(eq(interviewSessions.accessToken, token));
  if (!session) return new Response("세션 없음", { status: 404 });
  if (session.status === "completed")
    return new Response("이미 완료된 면접", { status: 400 });
  if (new Date(session.expiresAt) < new Date())
    return new Response("만료된 링크", { status: 400 });
  // 멱등 — 새로고침 후 재제출 등은 최초 결과 유지
  if (session.personalityProfile) return Response.json({ ok: true, already: true });

  if (!(await hasValidConsent(session.id, session.candidateId))) {
    return Response.json(
      { error: "검사 시작 전 개인정보 처리 동의가 필요합니다.", code: "consent_required" },
      { status: 403 }
    );
  }

  const [row] = await db
    .select({
      cultureFitProfile: organizations.cultureFitProfile,
      jobTraitProfile: jobPostings.traitProfile,
    })
    .from(candidates)
    .innerJoin(jobPostings, eq(jobPostings.id, candidates.jobId))
    .leftJoin(organizations, eq(organizations.id, jobPostings.orgId))
    .where(eq(candidates.id, session.candidateId));
  // 법인 컬처핏 설정 존재 = 인성검사 활성 (출제 세트는 공고 프로필 기준).
  // GET 출제 게이트와 동일하게 손상 JSON 은 미설정으로 취급.
  let personalityEnabled = false;
  if (row?.cultureFitProfile) {
    try { personalityEnabled = !!JSON.parse(row.cultureFitProfile); } catch { /* ignore */ }
  }
  if (!personalityEnabled)
    return new Response("이 면접에는 인성검사가 없습니다.", { status: 400 });

  const { responses, elapsedMs } = (await req.json()) as {
    responses?: PersonalityResponse[];
    elapsedMs?: number;
  };
  if (!Array.isArray(responses) || responses.length === 0)
    return new Response("응답이 없습니다.", { status: 400 });

  const items = buildItemSet(parseTraitProfile(row.jobTraitProfile));
  const invalid = validateResponses(items, responses);
  if (invalid) return new Response(invalid, { status: 400 });

  const profile = scoreResponses(
    items,
    responses,
    typeof elapsedMs === "number" && elapsedMs > 0 ? elapsedMs : undefined
  );

  await db
    .update(interviewSessions)
    .set({ personalityResponses: responses, personalityProfile: profile })
    .where(eq(interviewSessions.id, session.id));

  // 채점 결과·특성 점수는 후보자에게 비노출 — 완료 사실만 반환
  return Response.json({ ok: true });
}
