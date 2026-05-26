import { db } from "@/lib/db";
import {
  interviewSessions,
  candidates,
  jobPostings,
  organizations,
  type InterviewMessage,
} from "@/lib/schema";
import { eq } from "drizzle-orm";
import { createChat, startChatStreamWithRetry } from "@/lib/gemini";
import { buildSystemPrompt } from "@/lib/prompts";
import { hasValidConsent } from "@/lib/consent";
import { sanitizeUserInput, detectSystemPromptLeak } from "@/lib/prompt-safety";
import { maskText } from "@/lib/mask";
import { log } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // Rate limit — LLM 비용 DoS 방지.
  // 세션 토큰 기준 분당 20턴 (자연스러운 대화 한계의 약 2배), IP 기준 분당 60턴.
  // 세션 토큰을 식별자로 쓰므로, 같은 토큰을 안 후보자(또는 공격자)가 무한 호출 못 함.
  const ratePerSession = await rateLimit(
    req,
    "interview.chat.session",
    { limit: 20, windowSec: 60, identifier: `t:${token}` }
  );
  if (ratePerSession) return ratePerSession;
  const ratePerIp = await rateLimit(req, "interview.chat.ip", {
    limit: 60,
    windowSec: 60,
  });
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

  // 동의 가드 — 동의 없으면 면접 진행 차단
  if (!(await hasValidConsent(session.id))) {
    return Response.json(
      { error: "면접 시작 전 개인정보 처리 동의가 필요합니다.", code: "consent_required" },
      { status: 403 }
    );
  }

  const [candidate] = await db
    .select()
    .from(candidates)
    .where(eq(candidates.id, session.candidateId));
  const [job] = await db
    .select()
    .from(jobPostings)
    .where(eq(jobPostings.id, candidate!.jobId));
  // 회사명 — 공고가 속한 법인 이름. AI 면접관 자기소개에 사용.
  const orgRow = job?.orgId
    ? (
        await db
          .select({ name: organizations.name })
          .from(organizations)
          .where(eq(organizations.id, job.orgId))
      )[0]
    : null;
  const companyName = orgRow?.name ?? null;

  const isFirstTurn = session.messages.length === 0;
  const rawContent = userMessage ?? (isFirstTurn ? "면접을 시작해주세요." : "");
  const sanitized = sanitizeUserInput(rawContent);
  if (sanitized.injectionAttempt) {
    log.warn("prompt_injection_attempt", {
      sessionId: session.id,
      candidateId: candidate?.id,
      hadEndToken: sanitized.hadEndToken,
      sample: rawContent.slice(0, 200),
    });
  }
  // PIPA — 면접 중 후보자가 자가 발화한 PII (이름·전화·이메일·주소·회사·학교 등) 도 LLM 전달 전 마스킹.
  // 이력서 본문과 동일한 maskText 사용. 트랜스크립트(DB)도 마스킹본만 보관 → 평가 시점 재사용.
  const maskedContent = maskText(sanitized.text, {
    level: "standard",
    known: {
      name: candidate?.name ?? null,
      emails: candidate?.email ? [candidate.email] : [],
      phones: candidate?.phone ? [candidate.phone] : [],
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
        position: job!.position,
        level: job!.level,
        employmentType: job!.employmentType,
        responsibilities: job!.responsibilities,
        requirements: job!.requirements,
        idealProfile: job!.idealProfile,
        tone: job!.tone,
        interviewDurationMinutes: job!.interviewDurationMinutes,
      },
      // LLM 에는 항상 마스킹된 텍스트만 전달
      candidate!.resumeMaskedText ?? "",
      candidate!.screeningReport ?? null
    ),
    history: history.slice(0, -1).map((m) => ({
      role: m.role,
      parts: [{ text: m.content }],
    })),
  });

  if (session.status === "pending") {
    await db
      .update(interviewSessions)
      .set({ status: "in_progress", startedAt: new Date().toISOString() })
      .where(eq(interviewSessions.id, session.id));
  }

  try {
    // 스트리밍 시작 단계 transient 503/429 자동 재시도 2회.
    // stream 첫 토큰 도달 후 발생하는 에러는 재시도 안 함 (부분 토큰이 이미 클라이언트에 갔을 수 있음).
    const stream = await startChatStreamWithRetry(() =>
      chat.sendMessageStream({ message: newUserMessage.content })
    );

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
        await db
          .update(interviewSessions)
          .set({ messages: finalHistory })
          .where(eq(interviewSessions.id, session.id));
        if (truncated) {
          log.warn("interview_stream_truncated", {
            sessionId: session.id,
            candidateId: candidate?.id,
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
              candidateId: candidate?.id,
              sample: acc.slice(0, 300),
            });
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
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(`Gemini API 오류: ${msg}`, { status: 500 });
  }
}
