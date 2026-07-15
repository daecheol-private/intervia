import { db } from "./db";
import {
  interviewSessions,
  interviewSchedules,
  candidates,
} from "./schema";
import { and, eq, lt, sql, isNull, inArray } from "drizzle-orm";
import { purgeOnDecision } from "./candidate-stage";

/**
 * 만료 시점이 지난 면접 세션 정리.
 * - status='pending' (미시작) 만 환불 대상. in_progress/completed는 그대로 expired 처리만.
 * - 환불은 candidate.org_id 기준 (interview_session에는 org_id 없음).
 *
 * 면접관 통지: 개별 메일 없음 — cron 이 24시간 돌아 야간·주말 메일의 유일한 소스였고,
 * 자동 종결분은 다음 daily digest 의 '자동 종결' 블록(outcomeReason 기반)이 요약한다.
 */
export async function expireInterviewSessions(): Promise<{
  expiredCount: number;
  refundedCount: number;
  aiAutoRejected: number;
  scheduleAutoRejected: number;
}> {
  // 만료 세션 정리. 면접은 후차감 모델이라 만료 환불은 없다(미시작/미평가는 과금된 적 없음).
  // pending(AI 미시작) 만료는 자동 불합격 처리 대상이라 in_progress 와 분리해 전이시킨다.
  //
  // ⚠️ expiresAt 는 toISOString()(T 구분자 + Z) 로 저장된다. SQLite CURRENT_TIMESTAMP 는
  // 공백 구분자라 둘을 lexicographic 비교하면(' ' < 'T') 만료 당일분이 다음 날까지 안 잡힌다
  // (GOTCHAS §0-0). expiresAt 와 같은 ISO 포맷의 now 와 비교해 사전순=시간순을 보장한다.
  const nowIso = new Date().toISOString();
  const expiredPending = await db
    .update(interviewSessions)
    .set({ status: "expired" })
    .where(
      and(
        eq(interviewSessions.status, "pending"),
        lt(interviewSessions.expiresAt, nowIso)
      )
    )
    .returning({ id: interviewSessions.id });

  // in_progress 만료는 expired 처리만 (환불 X — 면접을 시작했으므로).
  const expiredInProgress = await db
    .update(interviewSessions)
    .set({ status: "expired" })
    .where(
      and(
        eq(interviewSessions.status, "in_progress"),
        lt(interviewSessions.expiresAt, nowIso)
      )
    )
    .returning({ id: interviewSessions.id });

  // AI면접 미시작 만료 → 후보자 자동 불합격 처리 (outcome=rejected, reason=ai_link_expired).
  // 이미 outcome 이 설정된 후보는 제외 (멱등). (변수명은 세션 id 목록 — 이후 inArray 로 조인)
  const expiredSessionCandidateIds = expiredPending.map((r) => r.id);

  // 면접은 후차감 모델 — 미시작/미평가 세션은 과금된 적이 없어 환불 대상이 없다.
  const refundedCount = 0;
  let aiAutoRejected = 0;
  if (expiredSessionCandidateIds.length > 0) {
    const cands = await db
      .select({
        id: candidates.id,
        outcome: candidates.outcome,
        sessionCandidateId: interviewSessions.candidateId,
      })
      .from(interviewSessions)
      .innerJoin(candidates, eq(candidates.id, interviewSessions.candidateId))
      .where(
        and(
          inArray(interviewSessions.id, expiredSessionCandidateIds),
          isNull(candidates.outcome)
        )
      );
    for (const c of cands) {
      // 후보 1건 처리 실패가 배치 전체를 끊지 않도록 격리. 세션은 이미 expired 로 전이됐으므로
      // (위 batch UPDATE) 여기서 throw 가 루프를 중단시키면 나머지 후보는 다음 cron 에서
      // 재검출되지 않아(status!='pending') 영구 미처리로 남는다.
      try {
        await db
          .update(candidates)
          .set({
            outcome: "rejected",
            outcomeReason: "ai_link_expired",
            decidedAt: new Date().toISOString(),
            decisionFromStage: sql`stage`,
          })
          .where(and(eq(candidates.id, c.id), isNull(candidates.outcome)));
        await purgeOnDecision(c.id).catch((e) =>
          console.error("purgeOnDecision after ai expire failed", e)
        );
        aiAutoRejected++;
      } catch (e) {
        console.error("ai expire auto-reject failed", { candidateId: c.id, e });
      }
    }
  }

  // 1차 면접 일정 링크 만료 → 후보자 자동 불합격 처리.
  // status='pending'|'counter_proposed' 인 schedule 이 만료되면 적용.
  const expiredScheds = await db
    .select({
      id: interviewSchedules.id,
      candidateId: interviewSchedules.candidateId,
    })
    .from(interviewSchedules)
    .where(
      and(
        lt(interviewSchedules.expiresAt, nowIso),
        sql`${interviewSchedules.status} IN ('pending', 'counter_proposed')`
      )
    );
  let scheduleAutoRejected = 0;
  if (expiredScheds.length > 0) {
    await db
      .update(interviewSchedules)
      .set({ status: "cancelled", updatedAt: new Date().toISOString() })
      .where(
        inArray(
          interviewSchedules.id,
          expiredScheds.map((s) => s.id)
        )
      );
    const candidateIds = Array.from(new Set(expiredScheds.map((s) => s.candidateId)));
    const candsToReject = await db
      .select({ id: candidates.id })
      .from(candidates)
      .where(
        and(inArray(candidates.id, candidateIds), isNull(candidates.outcome))
      );
    for (const c of candsToReject) {
      // 후보 1건 실패가 배치 전체를 끊지 않도록 격리(위 AI 만료 루프와 동일 이유).
      try {
        await db
          .update(candidates)
          .set({
            outcome: "rejected",
            outcomeReason: "schedule_link_expired",
            decidedAt: new Date().toISOString(),
            decisionFromStage: sql`stage`,
          })
          .where(and(eq(candidates.id, c.id), isNull(candidates.outcome)));
        await purgeOnDecision(c.id).catch((e) =>
          console.error("purgeOnDecision after schedule expire failed", e)
        );
        scheduleAutoRejected++;
      } catch (e) {
        console.error("schedule expire auto-reject failed", { candidateId: c.id, e });
      }
    }
  }

  return {
    expiredCount: expiredPending.length + expiredInProgress.length,
    refundedCount,
    aiAutoRejected,
    scheduleAutoRejected,
  };
}
