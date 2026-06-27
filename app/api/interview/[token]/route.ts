import { db } from "@/lib/db";
import {
  interviewSessions,
  candidates,
  jobPostings,
  organizations,
} from "@/lib/schema";
import { eq } from "drizzle-orm";
import { hasValidConsent, getConsentItems, CONSENT_VERSION } from "@/lib/consent";
import type { CultureFitProfile } from "@/lib/prompts";
import {
  buildItemSet,
  parseTraitProfile,
  toPublicItems,
} from "@/lib/personality";
import { hasMcqQuestions, toPublicMcq, type PublicMcqQuestion } from "@/lib/mcq";
import { isAiInterviewSuperseded } from "@/lib/stage-meta";
import { after } from "next/server";
import { ensureMcqTranslated } from "@/lib/mcq-translate";

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

  // 종결은 아니지만 후보자가 AI 단계를 지나 다음 전형으로 진행됨 → 이 AI 면접 링크 무효화.
  // (수동 단계 전진은 pending 세션을 정리하지 않으므로 파생 판정으로 차단 — 불필요한 응시·과금 방지.)
  if (isAiInterviewSuperseded({ stage: candidate.stage, outcome: candidate.outcome })) {
    return Response.json(
      { session, superseded: true, expired: false },
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
  // 회사명(name)도 함께 조회 — 후보자 화면에 "어느 회사의 AI 면접인지" 맥락 표시용.
  let cultureFit: CultureFitProfile | null = null;
  let orgName: string | null = null;
  if (job.orgId) {
    const [orgRow] = await db
      .select({
        name: organizations.name,
        cultureFitProfile: organizations.cultureFitProfile,
      })
      .from(organizations)
      .where(eq(organizations.id, job.orgId));
    if (orgRow) {
      orgName = orgRow.name;
      if (orgRow.cultureFitProfile) {
        try { cultureFit = JSON.parse(orgRow.cultureFitProfile) as CultureFitProfile; } catch { /* ignore */ }
      }
    }
  }
  const personalityCompleted = !!session.personalityProfile;
  const personalityRequired =
    !!cultureFit &&
    !personalityCompleted &&
    session.messages.length === 0 &&
    session.status !== "completed";

  // 객관식 사전 문항 단계 — 공고에 확정된 세트가 있고, 아직 미응시이며, 채팅 미시작 세션만 출제.
  // (도입 전 시작된 진행 중 세션은 소급 차단하지 않음.) 인성검사와 독립 — 둘 다 있으면 순차 진행.
  const mcqHasSet = job.mcqEnabled && hasMcqQuestions(job.mcqSet);
  const mcqRequired =
    mcqHasSet &&
    !session.mcqResponses &&
    session.messages.length === 0 &&
    session.status !== "completed";

  // 세션 원본에는 인성검사·객관식 응답/점수가 포함 — 후보자에게 점수류는 비노출
  const {
    personalityResponses: _pr,
    personalityProfile: _pp,
    mcqResponses: _mr,
    mcqScore: _ms,
    ...safeSession
  } = session;

  // 객관식 단계 표시 데이터 — 영어 면접이면 번역 캐시(mcqSetEn)를 쓰고, 아직 없으면
  // translating 신호를 주고 백그라운드 번역을 (재)트리거한다(PATCH prefetch 의 백업).
  let mcqField: {
    required: boolean;
    items?: PublicMcqQuestion[];
    translating?: boolean;
  };
  if (!mcqRequired) {
    mcqField = { required: false };
  } else if (session.language === "en") {
    if (hasMcqQuestions(job.mcqSetEn)) {
      mcqField = { required: true, items: toPublicMcq(job.mcqSetEn ?? []) };
    } else {
      mcqField = { required: true, translating: true };
      after(() => ensureMcqTranslated(job.id));
    }
  } else {
    mcqField = { required: true, items: toPublicMcq(job.mcqSet ?? []) };
  }

  return Response.json({
    session: safeSession,
    candidate: { id: candidate.id, name: candidate.name },
    organization: orgName ? { name: orgName } : null,
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
    // 면접 진행 언어 — 지원자가 시작 화면에서 고른 값. 동의 항목도 이 언어로 내려준다.
    language: session.language,
    consentRequired: !consented,
    consentVersion: CONSENT_VERSION,
    consentItems: getConsentItems(session.language),
    // 면접 전체 단계 구성 — required(미완료 여부)와 무관하게 이 면접에 어떤 단계가
    // 있는지. 채팅이 시작되면 personalityRequired/mcqRequired 가 false 로 내려가므로,
    // 면접 단계에서도 프로그레스바가 전체 흐름을 그릴 수 있도록 별도로 전달.
    // (완료했거나 앞으로 해야 하는 단계 = 이 면접에 구성된 단계)
    flow: {
      hasPersonality: personalityRequired || personalityCompleted,
      hasMcq: mcqRequired || !!session.mcqResponses,
    },
    personality: personalityRequired
      ? {
          required: true,
          // 강제선택형 — 문항당 진술 2개(a/b), 특성 태그는 비노출.
          // 출제 세트는 공고의 선호 특성 프로필 기준 (법인 컬처핏 설정은 출제 여부만 결정)
          items: toPublicItems(
            buildItemSet(parseTraitProfile(job.traitProfile), session.language)
          ),
        }
      : { required: false },
    // 객관식 사전 문항 — 정답·검증플래그는 비노출(toPublicMcq). 인성검사 다음 단계로 출제.
    mcq: mcqField,
  });
}
