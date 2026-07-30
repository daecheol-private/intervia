/**
 * 대면 면접 질문지 — 조회(GET) / 생성·재생성(POST). `?round=round1|round2` (기본 round1).
 *   round1 = 1차 실무 면접 (직무·기술 검증 중심)
 *   round2 = 2차 임원 면접 (컬쳐핏·인재상·가치관 중심 — 법인 컬쳐핏 기준 반영)
 *
 * 게이트: 해당 라운드 면접 일정이 확정된 경우에만 생성 가능
 *   (interview_schedules 에 round 일치 · status='selected' row 존재).
 *
 * 생성 입력: 이력서(마스킹) + 서류평가(screeningReport) + AI 면접 평가(있으면)
 *   + 법인 컬쳐핏 기준(organizations.culture_fit_profile, 있으면 — 두 라운드 공통).
 * 면접관(같은 법인 누구나) 이 버튼을 누르면 LLM 이 질문지를 만들어 후보자당 라운드별 1건 저장.
 *
 * 비동기(백그라운드) 생성 — MCQ 생성과 동일 패턴:
 *   POST 는 row 를 status='generating' 으로 표시하고 즉시 202 반환한 뒤, `after()` 가
 *   백그라운드에서 LLM 호출·저장·과금을 수행한다. 그래서 사용자가 생성 중 페이지를 닫거나
 *   새로고침해도 진행이 유지되고(상태는 DB 영속), 완료되면 GET 이 status='ready' 로 응답해
 *   클라이언트 폴링이 자동으로 질문지를 표시한다. 실패는 status='failed'(+gen_error).
 *   questions 는 status='ready' 가 되기 전엔 placeholder 이며 UI 에 노출하지 않는다.
 *
 * 과금: 생성 성공마다(after 안에서) interview_question_gen(기본 5토큰) **후차감** — 라운드 구분 없이
 *   동일 단가. chargeRepeatable 로 회차를 분리(refId=후보자, 라운드·재생성 합산 회차)하므로 성공
 *   1회당 1건 과금. (멱등이 아님 — 단가표에 interview_question_gen 이 없어도 DEFAULT_PRICING=5 폴백.)
 */
import { db } from "@/lib/db";
import {
  organizations,
  interviewSessions,
  interviewSchedules,
  interviewQuestionSheets,
  users,
  type InterviewQuestionSheet,
} from "@/lib/schema";
import { and, desc, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { guardCandidate } from "@/lib/candidate-guard";
import { candidateAllowsPiiFallback } from "@/lib/consent";
import { generateJSON } from "@/lib/gemini";
import {
  buildInterviewQuestionsPrompt,
  buildExecutiveInterviewQuestionsPrompt,
  hasCultureFit,
  QUESTION_SHEET_SCHEMA,
  type CultureFitProfile,
} from "@/lib/prompts";
import { logAudit } from "@/lib/audit";
import { chargeRepeatable } from "@/lib/tokens";
import { after } from "next/server";

export const runtime = "nodejs";
// 백그라운드(after) 생성이 maxDuration 안에 끝나야 함 — Vertex 서울 기준 LLM 1회 수십 초.
// 질문지 분량을 2배로 늘린 뒤(1차 48~64문항 / 2차 24~36문항) 출력 토큰도 2배라 300 으로 상향.
// stale 판정(QUESTION_GEN_STALE_MS=5분)과 같은 값이라, 함수가 죽으면 곧바로 failed 로 노출된다.
export const maxDuration = 300;

// generating 표시가 이 시간을 넘으면 함수 중단 등으로 간주 → GET 이 failed 로 노출(재생성 허용).
const QUESTION_GEN_STALE_MS = 5 * 60 * 1000;
function genIsStale(updatedAt: string | null | undefined): boolean {
  if (!updatedAt) return true;
  const t = Date.parse(updatedAt);
  return Number.isFinite(t) ? Date.now() - t > QUESTION_GEN_STALE_MS : true;
}

type Round = "round1" | "round2";

function parseRound(req: Request): Round | null {
  const r = new URL(req.url).searchParams.get("round") ?? "round1";
  return r === "round1" || r === "round2" ? r : null;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const userGuard = requireUser(me);
  if (userGuard) return userGuard;

  const { id } = await params;
  const cid = Number(id);
  if (!Number.isFinite(cid))
    return new Response("잘못된 candidate id", { status: 400 });
  const round = parseRound(req);
  if (!round) return new Response("잘못된 round", { status: 400 });

  const g = await guardCandidate(me!, cid);
  if (!g.ok) return g.res;

  const [sheet] = await db
    .select()
    .from(interviewQuestionSheets)
    .where(
      and(
        eq(interviewQuestionSheets.candidateId, cid),
        eq(interviewQuestionSheets.round, round)
      )
    );

  // 해당 라운드 일정 확정 여부 — 버튼 활성/비활성 판단용
  const [confirmed] = await db
    .select({ id: interviewSchedules.id })
    .from(interviewSchedules)
    .where(
      and(
        eq(interviewSchedules.candidateId, cid),
        eq(interviewSchedules.round, round),
        eq(interviewSchedules.status, "selected")
      )
    );

  // 생성 상태 — generating/ready/failed. generating 이 너무 오래(함수 중단 등)면 failed 로 노출.
  let status: "generating" | "ready" | "failed" | null = sheet?.status ?? null;
  let error: string | null =
    status === "failed" ? (sheet?.genError ?? "생성에 실패했습니다.") : null;
  if (status === "generating" && genIsStale(sheet?.updatedAt)) {
    status = "failed";
    error = "생성이 시간 내에 완료되지 않았습니다. 다시 시도해 주세요.";
  }
  // questions 는 status='ready' 일 때만 실제 질문지 — generating placeholder 는 노출하지 않는다.
  const ready = status === "ready" && !!sheet;

  let generatedByName: string | null = null;
  if (ready && sheet!.generatedByUserId) {
    const [u] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, sheet!.generatedByUserId));
    generatedByName = u?.name ?? null;
  }

  return Response.json({
    scheduleConfirmed: !!confirmed,
    status,
    error,
    sheet: ready
      ? {
          questions: sheet!.questions,
          basedOnScreening: sheet!.basedOnScreening,
          basedOnInterview: sheet!.basedOnInterview,
          basedOnCultureFit: sheet!.basedOnCultureFit,
          generatedByName,
          createdAt: sheet!.createdAt,
          updatedAt: sheet!.updatedAt,
        }
      : null,
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const userGuard = requireUser(me);
  if (userGuard) return userGuard;

  const { id } = await params;
  const cid = Number(id);
  if (!Number.isFinite(cid))
    return new Response("잘못된 candidate id", { status: 400 });
  const round = parseRound(req);
  if (!round) return new Response("잘못된 round", { status: 400 });

  const g = await guardCandidate(me!, cid);
  if (!g.ok) return g.res;
  const { candidate, job } = g;

  // 게이트: 해당 라운드 면접 일정이 확정돼야 생성 가능
  const [confirmed] = await db
    .select({ id: interviewSchedules.id })
    .from(interviewSchedules)
    .where(
      and(
        eq(interviewSchedules.candidateId, cid),
        eq(interviewSchedules.round, round),
        eq(interviewSchedules.status, "selected")
      )
    );
  if (!confirmed)
    return new Response(
      `${round === "round2" ? "2차" : "1차"} 면접 일정이 확정된 후에 면접 문제를 생성할 수 있습니다.`,
      { status: 409 }
    );

  const resume = candidate.resumeMaskedText ?? "";
  if (!resume.trim())
    return new Response("이력서 내용이 없어 질문지를 생성할 수 없습니다.", {
      status: 400,
    });

  if (!job) return new Response("공고를 찾을 수 없습니다.", { status: 404 });

  // 동시/중복 생성 가드 — 이미 생성 중(stale 아님)이면 새 생성을 띄우지 않고 폴링 그대로 진행시킨다.
  const [existing] = await db
    .select({
      status: interviewQuestionSheets.status,
      updatedAt: interviewQuestionSheets.updatedAt,
    })
    .from(interviewQuestionSheets)
    .where(
      and(
        eq(interviewQuestionSheets.candidateId, cid),
        eq(interviewQuestionSheets.round, round)
      )
    );
  if (existing?.status === "generating" && !genIsStale(existing.updatedAt))
    return Response.json({ status: "generating" }, { status: 202 });

  // 진행 표시(generating) 세팅 후 즉시 202 — 실제 생성은 백그라운드(after).
  // 새로고침/재방문해도 GET 이 generating 으로 응답하고, 완료되면 status='ready' 로 바뀌어
  // 클라이언트 폴링이 자동으로 질문지를 표시한다 (MCQ 생성과 동일한 패턴).
  // questions 는 placeholder — status='ready' 가 되기 전에는 UI 에 노출하지 않는다.
  const startedAt = new Date().toISOString();
  const placeholder: InterviewQuestionSheet = { strategy: "", sections: [] };
  await db
    .insert(interviewQuestionSheets)
    .values({
      candidateId: cid,
      round,
      jobId: candidate.jobId,
      orgId: candidate.orgId,
      basedOnScreening: false,
      basedOnInterview: false,
      basedOnCultureFit: false,
      questions: placeholder,
      status: "generating",
      genError: null,
      generatedByUserId: me!.id,
      createdAt: startedAt,
      updatedAt: startedAt,
    })
    .onConflictDoUpdate({
      target: [
        interviewQuestionSheets.candidateId,
        interviewQuestionSheets.round,
      ],
      set: {
        status: "generating",
        genError: null,
        generatedByUserId: me!.id,
        updatedAt: startedAt,
      },
    });

  // 백그라운드 생성 — 입력 수집 → LLM → 저장/과금/감사. 실패 시 status='failed'.
  after(async () => {
    try {
      const org = candidate.orgId
        ? (
            await db
              .select({
                name: organizations.name,
                cultureFitProfile: organizations.cultureFitProfile,
              })
              .from(organizations)
              .where(eq(organizations.id, candidate.orgId))
          )[0]
        : null;
      let cultureFit: CultureFitProfile | null = null;
      if (org?.cultureFitProfile) {
        try {
          cultureFit = JSON.parse(org.cultureFitProfile) as CultureFitProfile;
        } catch {
          /* 손상된 JSON 은 미설정으로 취급 */
        }
      }

      // 가장 최근 완료된 AI 면접 평가 (있으면)
      const [latestCompleted] = await db
        .select({ evaluation: interviewSessions.evaluation })
        .from(interviewSessions)
        .where(
          and(
            eq(interviewSessions.candidateId, cid),
            eq(interviewSessions.status, "completed")
          )
        )
        .orderBy(desc(interviewSessions.completedAt))
        .limit(1);
      const interviewEval = latestCompleted?.evaluation ?? null;
      const screening = candidate.screeningReport ?? null;

      const jobInfo = {
        company: org?.name ?? undefined,
        position: job.position,
        level: job.level,
        employmentType: job.employmentType,
        responsibilities: job.responsibilities,
        requirements: job.requirements,
        idealProfile: job.idealProfile,
        evaluationFocus: job.evaluationFocus,
        tone: job.tone,
      };
      const prompt =
        round === "round2"
          ? buildExecutiveInterviewQuestionsPrompt(
              jobInfo,
              resume,
              screening,
              interviewEval,
              cultureFit
            )
          : buildInterviewQuestionsPrompt(
              jobInfo,
              resume,
              screening,
              interviewEval,
              cultureFit
            );

      // 후보자의 최신 동의가 도쿄 폴백 고지(1.9.0+)를 포함할 때만 폴백 —
      // AI 면접 동의 이력이 없는 후보(수동 등록 등)는 서울 전용.
      const allowFallback = await candidateAllowsPiiFallback(cid);
      // responseSchema 필수 — 분량 2배 이후 자유서술이 길어져 스키마 없이는 간헐적으로
      // 깨진 JSON 이 나온다(실측 3회 중 1회 파싱 실패). Vertex 가 유효 JSON 을 보장한다.
      const sheet = await generateJSON<InterviewQuestionSheet>(prompt, {
        task: "questionGen",
        responseSchema: QUESTION_SHEET_SCHEMA,
        allowFallback,
      });
      if (!sheet || !Array.isArray(sheet.sections) || sheet.sections.length === 0)
        throw new Error("생성 결과가 비어 있습니다.");

      const basedOnCultureFit = hasCultureFit(cultureFit);
      const doneAt = new Date().toISOString();
      await db
        .update(interviewQuestionSheets)
        .set({
          questions: sheet,
          basedOnScreening: !!screening,
          basedOnInterview: !!interviewEval,
          basedOnCultureFit,
          status: "ready",
          genError: null,
          updatedAt: doneAt,
        })
        .where(
          and(
            eq(interviewQuestionSheets.candidateId, cid),
            eq(interviewQuestionSheets.round, round)
          )
        );

      // 후차감 — 생성 성공마다 매번 과금 (재생성·라운드 추가 생성도 chargeRepeatable 회차 분리).
      if (candidate.orgId) {
        await chargeRepeatable({
          orgId: candidate.orgId,
          feature: "interview_question_gen",
          baseRefType: "candidate",
          refId: cid,
          userId: me!.id,
          memo: `${round === "round2" ? "2차(임원) " : ""}면접 문제 생성 - ${candidate.name ?? ""}`.trim(),
        });
      }

      logAudit(req, {
        actor: me!,
        action: "interview_questions.generate",
        resourceType: "candidate",
        resourceId: cid,
        orgId: candidate.orgId,
        jobId: candidate.jobId,
        metadata: {
          round,
          basedOnScreening: !!screening,
          basedOnInterview: !!interviewEval,
          basedOnCultureFit,
          sections: sheet.sections.length,
        },
      });
    } catch (e) {
      console.error("[interview-questions] background generation failed", e);
      await db
        .update(interviewQuestionSheets)
        .set({
          status: "failed",
          genError: "면접 문제 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.",
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(interviewQuestionSheets.candidateId, cid),
            eq(interviewQuestionSheets.round, round)
          )
        );
    }
  });

  return Response.json({ status: "generating" }, { status: 202 });
}
