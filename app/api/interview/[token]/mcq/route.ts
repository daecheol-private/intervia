/**
 * AI 면접 객관식 사전 문항 응답 제출 — 채팅 시작 전 1회.
 * 채점은 서버 결정적 코드 (lib/mcq.ts scoreMcq). LLM 미관여. 점수는 후보자에게 비노출.
 */
import { db } from "@/lib/db";
import { interviewSessions, candidates, jobPostings } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { hasValidConsent } from "@/lib/consent";
import { rateLimit } from "@/lib/rate-limit";
import {
  hasMcqQuestions,
  validateMcqResponses,
  gradeMcq,
  type McqResponse,
} from "@/lib/mcq";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const limited = await rateLimit(req, "interview.mcq", {
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
  if (session.mcqResponses) return Response.json({ ok: true, already: true });

  if (!(await hasValidConsent(session.id, session.candidateId))) {
    return Response.json(
      { error: "문제 풀이 전 개인정보 처리 동의가 필요합니다.", code: "consent_required" },
      { status: 403 }
    );
  }

  const [row] = await db
    .select({ mcqSet: jobPostings.mcqSet })
    .from(candidates)
    .innerJoin(jobPostings, eq(jobPostings.id, candidates.jobId))
    .where(eq(candidates.id, session.candidateId));
  const set = row?.mcqSet ?? [];
  if (!hasMcqQuestions(set))
    return new Response("이 면접에는 객관식 문제가 없습니다.", { status: 400 });

  const { responses } = (await req.json()) as { responses?: McqResponse[] };
  if (!Array.isArray(responses) || responses.length === 0)
    return new Response("응답이 없습니다.", { status: 400 });

  const invalid = validateMcqResponses(set, responses);
  if (invalid) return new Response(invalid, { status: 400 });

  // 채점 + 응시 스냅샷(문항·정답·선택) 저장 — 이후 공고 문제 수정과 무관하게 리포트가 정확.
  const { score, records } = gradeMcq(set, responses);

  await db
    .update(interviewSessions)
    .set({ mcqResponses: records, mcqScore: score })
    .where(eq(interviewSessions.id, session.id));

  // 채점 결과는 후보자에게 비노출 — 완료 사실만 반환
  return Response.json({ ok: true });
}
