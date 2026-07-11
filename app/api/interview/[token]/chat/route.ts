import { db } from "@/lib/db";
import {
  interviewSessions,
  candidates,
  jobPostings,
  organizations,
  type InterviewMessage,
} from "@/lib/schema";
import { and, eq, sql } from "drizzle-orm";
import { createChat, startChatStreamWithRetry } from "@/lib/gemini";
import {
  buildSystemPrompt,
  type CultureFitProfile,
  type PersonalityAnchor,
} from "@/lib/prompts";
import {
  buildItemSet,
  notableResponses,
  parseTraitProfile,
} from "@/lib/personality";
import { hasMcqQuestions } from "@/lib/mcq";
import { hasValidConsent } from "@/lib/consent";
import { logAudit } from "@/lib/audit";
import { sanitizeUserInput, detectSystemPromptLeak } from "@/lib/prompt-safety";
import { maskText } from "@/lib/mask";
import { newErrorRef, transientErrorMessage } from "@/lib/error-ref";
import { log } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
// 면접 대화 매 턴이 LLM 스트리밍(재시도 포함) — 기본 타임아웃(~15s)이면 긴 응답·재시도에서 잘린다.
export const maxDuration = 120;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // Rate limit — LLM 비용 DoS 방지.
  // 세션 토큰 기준 분당 20턴 (자연스러운 대화 한계의 약 2배), IP 기준 분당 60턴.
  // 세션 토큰을 식별자로 쓰므로, 같은 토큰을 안 후보자(또는 공격자)가 무한 호출 못 함.
  const [ratePerSession, ratePerIp] = await Promise.all([
    rateLimit(req, "interview.chat.session", {
      limit: 20,
      windowSec: 60,
      identifier: `t:${token}`,
    }),
    rateLimit(req, "interview.chat.ip", { limit: 60, windowSec: 60 }),
  ]);
  if (ratePerSession) return ratePerSession;
  if (ratePerIp) return ratePerIp;

  const { userMessage, inputSignals } = (await req.json()) as {
    userMessage?: string;
    inputSignals?: InterviewMessage["inputSignals"];
  };

  // 사용자 입력 길이 가드 — 8KB 초과 차단 (정상 답변은 보통 1~2KB)
  if (userMessage && userMessage.length > 8000) {
    return new Response("메시지가 너무 깁니다. 8000자 이내로 작성해 주세요.", {
      status: 413,
    });
  }

  const [session] = await db
    .select()
    .from(interviewSessions)
    .where(eq(interviewSessions.accessToken, token));
  if (!session) return new Response("세션 없음", { status: 404 });
  if (session.status === "completed")
    return new Response("이미 완료된 면접", { status: 400 });
  if (new Date(session.expiresAt) < new Date())
    return new Response("만료된 링크", { status: 400 });

  // 동의 확인 ∥ 후보자·공고·법인 로드 — 상호 독립이라 병렬. 후보자/공고/법인은 JOIN 1쿼리
  // (기존 3회 순차 왕복). 컬럼도 사용분만 — 전체 select() 는 비마스킹 이력서 원문(수십 KB)
  // 까지 매 턴 끌어왔다. 매 턴 실행되는 first-token 핫패스.
  const [consentOk, ctxRows] = await Promise.all([
    hasValidConsent(session.id, session.candidateId),
    db
      .select({
        candidate: {
          id: candidates.id,
          jobId: candidates.jobId,
          orgId: candidates.orgId,
          name: candidates.name,
          email: candidates.email,
          phone: candidates.phone,
          resumeMaskedText: candidates.resumeMaskedText,
          screeningReport: candidates.screeningReport,
        },
        job: {
          position: jobPostings.position,
          level: jobPostings.level,
          employmentType: jobPostings.employmentType,
          responsibilities: jobPostings.responsibilities,
          requirements: jobPostings.requirements,
          idealProfile: jobPostings.idealProfile,
          tone: jobPostings.tone,
          interviewDurationMinutes: jobPostings.interviewDurationMinutes,
          traitProfile: jobPostings.traitProfile,
          mcqSet: jobPostings.mcqSet,
          mcqEnabled: jobPostings.mcqEnabled,
        },
        // 회사명 — 공고가 속한 법인 이름. AI 면접관 자기소개에 사용.
        orgName: organizations.name,
        orgCultureFit: organizations.cultureFitProfile,
      })
      .from(candidates)
      .innerJoin(jobPostings, eq(jobPostings.id, candidates.jobId))
      .leftJoin(organizations, eq(organizations.id, jobPostings.orgId))
      .where(eq(candidates.id, session.candidateId)),
  ]);

  // 동의 가드 — 동의 없으면 면접 진행 차단
  if (!consentOk) {
    return Response.json(
      { error: "면접 시작 전 개인정보 처리 동의가 필요합니다.", code: "consent_required" },
      { status: 403 }
    );
  }

  const ctx = ctxRows[0];
  if (!ctx) return new Response("후보자 없음", { status: 404 });
  const { candidate, job } = ctx;
  const companyName = ctx.orgName ?? null;

  let cultureFit: CultureFitProfile | null = null;
  if (ctx.orgCultureFit) {
    try { cultureFit = JSON.parse(ctx.orgCultureFit) as CultureFitProfile; } catch { /* ignore */ }
  }

  const isFirstTurn = session.messages.length === 0;

  // 인성검사 게이트 — 법인 컬처핏이 설정된 면접은 검사 완료 후에만 채팅 시작.
  // 첫 턴에만 적용 (검사 도입 전 시작된 진행 중 세션은 소급 차단하지 않음).
  if (isFirstTurn && cultureFit && !session.personalityProfile) {
    return Response.json(
      { error: "면접 시작 전 사전 문항 응답이 필요합니다.", code: "personality_required" },
      { status: 403 }
    );
  }

  // 객관식 사전 문항 게이트 — 공고에 확정된 세트가 있으면 응시 완료 후에만 채팅 시작.
  // 인성검사와 독립(둘 다 있으면 인성→객관식 순서로 클라이언트가 진행). 첫 턴에만 적용(소급 X).
  if (isFirstTurn && job.mcqEnabled && hasMcqQuestions(job.mcqSet) && !session.mcqResponses) {
    return Response.json(
      { error: "면접 시작 전 객관식 문제 풀이가 필요합니다.", code: "mcq_required" },
      { status: 403 }
    );
  }

  // 인성검사 앵커 — 주목할 자가응답을 면접관 프롬프트에 행동 검증 단서로 제공
  let personalityAnchors: PersonalityAnchor[] | null = null;
  let personalityReliabilityNote: string | null = null;
  if (cultureFit && session.personalityProfile && session.personalityResponses) {
    // 출제·앵커 모두 공고의 선호 특성 프로필 기준 (검사 출제 세트와 동일해야 함)
    const jobTrait = parseTraitProfile(job.traitProfile);
    const items = buildItemSet(jobTrait, session.language);
    personalityAnchors = notableResponses(
      items,
      session.personalityResponses,
      jobTrait
    ).map((n) => ({
      question: n.statement,
      answer: n.answerLabel,
      why: n.whyNotable,
    }));
    const flags = session.personalityProfile.flags;
    const notes: string[] = [];
    if (flags.straightLining) notes.push("한쪽 선택지 위치만 반복 선택(무성의 의심)");
    if (flags.inconsistent) notes.push("같은 특성 쌍 재질문에서 선택 다수 뒤집힘(무작위 응답 의심)");
    if (flags.rushed) notes.push("비정상적으로 빠른 응답 속도");
    personalityReliabilityNote = notes.length > 0 ? notes.join(" · ") : null;
  }
  const rawContent = userMessage ?? (isFirstTurn ? "면접을 시작해주세요." : "");
  const sanitized = sanitizeUserInput(rawContent);
  if (sanitized.injectionAttempt) {
    log.warn("prompt_injection_attempt", {
      sessionId: session.id,
      candidateId: candidate.id,
      hadEndToken: sanitized.hadEndToken,
      sample: rawContent.slice(0, 200),
    });
  }
  // PIPA — 면접 중 후보자가 자가 발화한 PII (이름·전화·이메일·주소·회사·학교 등) 도 LLM 전달 전 마스킹.
  // 이력서 본문과 동일한 maskText 사용. 트랜스크립트(DB)도 마스킹본만 보관 → 평가 시점 재사용.
  const maskedContent = maskText(sanitized.text, {
    level: "standard",
    known: {
      name: candidate.name ?? null,
      emails: candidate.email ? [candidate.email] : [],
      phones: candidate.phone ? [candidate.phone] : [],
    },
  });
  const newUserMessage: InterviewMessage = {
    role: "user",
    content: maskedContent,
    inputSignals: inputSignals ?? undefined,
  };
  const history = [...session.messages, newUserMessage];

  const chat = createChat({
    task: "interview",
    systemInstruction: buildSystemPrompt(
      {
        company: companyName ?? undefined,
        position: job.position,
        level: job.level,
        employmentType: job.employmentType,
        responsibilities: job.responsibilities,
        requirements: job.requirements,
        idealProfile: job.idealProfile,
        tone: job.tone,
        interviewDurationMinutes: job.interviewDurationMinutes,
      },
      // LLM 에는 항상 마스킹된 텍스트만 전달
      candidate.resumeMaskedText ?? "",
      candidate.screeningReport ?? null,
      cultureFit,
      personalityAnchors,
      personalityReliabilityNote,
      // 지원자가 시작 화면에서 고른 면접 언어 — en 이면 면접관이 영어로 진행(평가 리포트는 한국어 유지).
      session.language
    ),
    history: history.slice(0, -1).map((m) => ({
      role: m.role,
      parts: [{ text: m.content }],
    })),
  });

  // 첫 턴 상태 전환 — LLM 스트림 시작과 병렬로 처리해 first-token 지연에서 DB 왕복 제거.
  const markStarted =
    session.status === "pending"
      ? db
          .update(interviewSessions)
          .set({ status: "in_progress", startedAt: new Date().toISOString() })
          .where(eq(interviewSessions.id, session.id))
      : null;
  if (session.status === "pending") {
    logAudit(req, {
      actorRole: "candidate",
      action: "interview.start",
      resourceType: "interview_session",
      resourceId: session.id,
      orgId: candidate.orgId,
      jobId: candidate.jobId,
      metadata: { candidateId: candidate.id },
    });
  }

  try {
    // 스트리밍 시작 단계 transient 503/429 자동 재시도 2회.
    // stream 첫 토큰 도달 후 발생하는 에러는 재시도 안 함 (부분 토큰이 이미 클라이언트에 갔을 수 있음).
    const [stream] = await Promise.all([
      startChatStreamWithRetry(() =>
        chat.sendMessageStream({ message: newUserMessage.content })
      ),
      markStarted,
    ]);

    const encoder = new TextEncoder();
    let acc = "";
    let persisted = false;
    // 부분 응답이라도 보존. 클라이언트 단절·서버 예외 어떤 경우든 1회만 저장.
    const persist = async (truncated: boolean) => {
      if (persisted) return;
      persisted = true;
      if (!acc) return; // 빈 응답이면 저장 안 함 — 다음 턴이 동일 user message 로 재시도 가능
      const content = truncated ? acc + "\n\n[응답이 중단되었습니다]" : acc;
      const finalHistory: InterviewMessage[] = [
        ...history,
        { role: "model", content },
      ];
      try {
        // 낙관적 잠금 — 요청 시작 시 읽은 메시지 개수(session.messages.length)가 그대로일 때만
        // 덮어쓴다. 동시 턴(다중 탭·재시도·병렬 호출)이 먼저 저장해 개수가 늘었으면 이 쓰기는
        // 앞 턴을 통째로 지우게 되므로 저장을 포기한다(이 턴만 유실, 저장된 대화는 보존).
        // messages 를 쓰는 경로는 이 라우트뿐이라 개수 변화 = 동시 턴 충돌로 판정 가능.
        const saved = await db
          .update(interviewSessions)
          .set({ messages: finalHistory })
          .where(
            and(
              eq(interviewSessions.id, session.id),
              sql`json_array_length(messages) = ${session.messages.length}`
            )
          )
          .returning({ id: interviewSessions.id });
        if (saved.length === 0) {
          log.warn("interview_persist_conflict", {
            sessionId: session.id,
            candidateId: candidate.id,
            expectedLen: session.messages.length,
          });
          return;
        }
        if (truncated) {
          log.warn("interview_stream_truncated", {
            sessionId: session.id,
            candidateId: candidate.id,
            partialLen: acc.length,
          });
        }
      } catch (e) {
        log.error("interview_persist_failed", {
          sessionId: session.id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    };

    const responseStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const text = chunk.text;
            if (text) {
              acc += text;
              controller.enqueue(encoder.encode(text));
            }
          }
          if (detectSystemPromptLeak(acc)) {
            log.warn("system_prompt_leak_suspected", {
              sessionId: session.id,
              candidateId: candidate.id,
              sample: acc.slice(0, 300),
            });
            // M10 — 검출 시 DB 저장 본문을 보호 메시지로 치환하여 다음 LLM 평가
            // 단계 (interviewEval) 가 누출된 시스템 프롬프트로 오염되지 않도록 차단.
            // 스트림에 이미 흘러간 chunk 는 회수 불가하나, 후속 영향만은 격리.
            acc = "[시스템 응답 보호 — 본 답변은 검수가 필요합니다. 채용 담당자에게 문의해 주세요.]";
          }
          await persist(false);
          controller.close();
        } catch (e) {
          // 스트림 도중 예외 — 누적분 저장 후 에러 전달
          await persist(true);
          controller.error(e);
        }
      },
      // 클라이언트가 연결 끊으면(예: 새로고침/취소) cancel 호출됨 — 누적분 저장
      async cancel() {
        await persist(true);
      },
    });

    return new Response(responseStream, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (e: unknown) {
    // 스트림 시작 전 LLM 실패(429/503 등) — 내부 오류 원문 대신 오류 코드 기반 안내로 통일.
    // 같은 코드를 로그에 남겨 고객센터 문의 시 역추적 가능.
    const ref = newErrorRef();
    const msg = e instanceof Error ? e.message : String(e);
    log.error("interview_chat_llm_failed", {
      ref,
      sessionId: session.id,
      error: msg.slice(0, 300),
    });
    return new Response(transientErrorMessage(ref), { status: 503 });
  }
}
