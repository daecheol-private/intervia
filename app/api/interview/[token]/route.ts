import { db } from "@/lib/db";
import { interviewSessions, candidates, jobPostings } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { hasValidConsent, CONSENT_ITEMS, CONSENT_VERSION } from "@/lib/consent";

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

  const [job] = await db
    .select()
    .from(jobPostings)
    .where(eq(jobPostings.id, candidate.jobId));
  if (!job) return new Response("공고 없음", { status: 404 });

  const consented = await hasValidConsent(session.id);

  return Response.json({
    session,
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
  });
}
