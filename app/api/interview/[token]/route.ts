import { db } from "@/lib/db";
import {
  interviewSessions,
  candidates,
  jobPostings,
  organizations,
} from "@/lib/schema";
import { eq } from "drizzle-orm";
import { hasValidConsent, CONSENT_ITEMS, CONSENT_VERSION } from "@/lib/consent";
import type { CultureFitProfile } from "@/lib/prompts";
import { buildItemSet, toPublicItems } from "@/lib/personality";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const [session] = await db
    .select()
    .from(interviewSessions)
    .where(eq(interviewSessions.accessToken, token));
  if (!session) return new Response("세션 없음", { status: 404 });

  if (new Date(session.expiresAt) < new Date()) {
    return Response.json({ session, expired: true }, { status: 200 });
  }

  const [candidate] = await db
    .select()
    .from(candidates)
    .where(eq(candidates.id, session.candidateId));
  if (!candidate) return new Response("후보자 없음", { status: 404 });

  // 지원자가 지원취소했거나 종결된 후보 — 토큰이 살아있어도 재진입 차단.
  // (AI면접 지원취소는 세션도 expired 처리하지만, 1차면접 스케쥴 지원취소는
  //  세션을 건드리지 않으므로 outcome 으로 일관되게 판별.)
  if (candidate.outcome) {
    return Response.json(
      {
        session,
        withdrawn: candidate.outcome === "withdrawn",
        terminated: true,
        expired: false,
      },
      { status: 200 }
    );
  }

  const [job] = await db
    .select()
    .from(jobPostings)
    .where(eq(jobPostings.id, candidate.jobId));
  if (!job) return new Response("공고 없음", { status: 404 });

  const consented = await hasValidConsent(session.id);

  // 인성검사 단계 — 법인 컬처핏 설정이 있고, 아직 미실시이며, 채팅이 시작되지 않은
  // 세션만 출제 (도입 전 시작된 진행 중 세션은 소급 차단하지 않음).
  let cultureFit: CultureFitProfile | null = null;
  if (job.orgId) {
    const [orgRow] = await db
      .select({ cultureFitProfile: organizations.cultureFitProfile })
      .from(organizations)
      .where(eq(organizations.id, job.orgId));
    if (orgRow?.cultureFitProfile) {
      try { cultureFit = JSON.parse(orgRow.cultureFitProfile) as CultureFitProfile; } catch { /* ignore */ }
    }
  }
  const personalityCompleted = !!session.personalityProfile;
  const personalityRequired =
    !!cultureFit &&
    !personalityCompleted &&
    session.messages.length === 0 &&
    session.status !== "completed";

  // 세션 원본에는 인성검사 응답·프로필이 포함 — 후보자에게 점수류는 비노출
  const { personalityResponses: _pr, personalityProfile: _pp, ...safeSession } =
    session;

  return Response.json({
    session: safeSession,
    candidate: { id: candidate.id, name: candidate.name },
    job: {
      id: job.id,
      title: job.title,
      position: job.position,
      level: job.level,
      employmentType: job.employmentType,
      tone: job.tone,
      interviewDurationMinutes: job.interviewDurationMinutes,
    },
    expired: false,
    consentRequired: !consented,
    consentVersion: CONSENT_VERSION,
    consentItems: CONSENT_ITEMS,
    personality: personalityRequired
      ? {
          required: true,
          // 강제선택형 — 문항당 진술 2개(a/b), 특성 태그는 비노출
          items: toPublicItems(buildItemSet(cultureFit!.traitProfile)),
        }
      : { required: false },
  });
}
