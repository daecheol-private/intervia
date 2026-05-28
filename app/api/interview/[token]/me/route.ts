/**
 * 후보자 본인 정보 열람 / 삭제 (PIPA §35, §36).
 *
 * 인증: 면접 토큰 + 본인 이메일 (POST/DELETE body 또는 GET 쿼리).
 *
 * GET: 본인 보유 데이터 요약 (이름/이메일/전화/이력서 파일 보유/평가 점수 등)
 * DELETE: 본인 데이터 즉시 폐기 — resume_text/masked/file 모두 즉시 삭제
 *         평가 결과 (점수·추천) 은 채용 통계 목적으로 1년 보존 (처리방침 명시)
 */
import { db } from "@/lib/db";
import { interviewSessions, candidates } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { deleteFile } from "@/lib/storage";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

async function authBody(
  token: string,
  emailFromInput: string | null
): Promise<
  | { ok: true; candidate: typeof candidates.$inferSelect; sessionId: number }
  | { ok: false; res: Response }
> {
  const [session] = await db
    .select()
    .from(interviewSessions)
    .where(eq(interviewSessions.accessToken, token));
  if (!session) return { ok: false, res: new Response("세션 없음", { status: 404 }) };

  const [candidate] = await db
    .select()
    .from(candidates)
    .where(eq(candidates.id, session.candidateId));
  if (!candidate)
    return { ok: false, res: new Response("후보자 없음", { status: 404 }) };

  // 본인 확인 — candidates.email 존재 시 입력값과 매칭. 미존재 시 토큰만으로 통과 (관용).
  if (candidate.email) {
    if (!emailFromInput || emailFromInput.toLowerCase() !== candidate.email.toLowerCase()) {
      return {
        ok: false,
        res: new Response(
          "본인 확인 실패: 면접 안내 메일을 받으신 이메일을 입력해 주세요.",
          { status: 403 }
        ),
      };
    }
  }
  return { ok: true, candidate, sessionId: session.id };
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const limited = await rateLimit(req, "self-view", { limit: 5, windowSec: 60 });
  if (limited) return limited;

  const { token } = await params;
  const body = (await req.json().catch(() => null)) as { email?: string } | null;
  const auth = await authBody(token, body?.email?.trim() ?? null);
  if (!auth.ok) return auth.res;

  const c = auth.candidate;
  // Low — 후보자 본인 열람에는 점수·추천 등 평가 결과 미노출. 후보자가 점수를 보고
  // 이의제기 통계 분쟁을 유발하지 않도록 보유 항목 요약만 제공. 평가 설명 요청은
  // PIPA §37의2 의 이의제기 채널 (/api/interview/[token]/appeal) 로 별도 안내.
  const safe = {
    name: c.name,
    email: c.email,
    phone: c.phone,
    age: c.age,
    careerYears: c.careerYears,
    careerSummary: c.careerSummary,
    resumeStored: !!c.resumeFilePath,
    maskedTextLength: c.resumeMaskedText?.length ?? 0,
    // 진행 상태 — stage 한글 라벨 + outcome (종결 시)
    stage: c.stage,
    outcome: c.outcome,
    createdAt: c.createdAt,
  };

  logAudit(req, {
    actorRole: "candidate",
    action: "candidate.self_view",
    resourceType: "candidate",
    resourceId: c.id,
    orgId: c.orgId,
  });

  return Response.json(safe);
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const limited = await rateLimit(req, "self-delete", {
    limit: 3,
    windowSec: 60,
  });
  if (limited) return limited;

  const { token } = await params;
  const body = (await req.json().catch(() => null)) as { email?: string } | null;
  const auth = await authBody(token, body?.email?.trim() ?? null);
  if (!auth.ok) return auth.res;

  const c = auth.candidate;
  // 본문·파일 즉시 폐기. 평가 결과·이름은 채용 통계 목적으로 일부 보존 (처리방침 §3).
  if (c.resumeFilePath) await deleteFile(c.resumeFilePath).catch(() => null);
  await db
    .update(candidates)
    .set({
      resumeText: "",
      resumeMaskedText: null,
      resumeFilePath: "",
      phone: null,
      // email/name 은 평가 결과와 매칭 위해 보존 (필요 시 후속 옵션)
    })
    .where(eq(candidates.id, c.id));

  logAudit(req, {
    actorRole: "candidate",
    action: "candidate.self_delete",
    resourceType: "candidate",
    resourceId: c.id,
    orgId: c.orgId,
  });

  return Response.json({ ok: true });
}
