/**
 * 종결 취소 — 종결된 후보자를 다시 진행 상태로 되돌린다.
 *
 * 사람은 실수하고, 링크 만료 자동 종결은 애초에 "판단"이 아니라 "무응답"이다.
 * 그래서 자동/수동·결과 종류를 가리지 않고 되살릴 수 있게 한다(권한은 종결과 동일).
 *
 * ⚠️ 되돌릴 수 없는 것들 — 호출 전에 UI 가 경고한다:
 *   - 이력서 본문·파일·첨부·사진은 종결 시 purgeOnDecision 이 이미 삭제했다(복구 불가).
 *   - 이미 나간 불합격 통보 메일·확정 면접 취소 통지는 회수할 수 없다.
 *   - AI 세션(expired)·진행 중이던 일정(cancelled)은 되살아나지 않는다 — 새로 발급해야 한다.
 */
import { db } from "@/lib/db";
import { candidates } from "@/lib/schema";
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { guardCandidate } from "@/lib/candidate-guard";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { id } = await params;
  const cid = Number(id);

  const g = await guardCandidate(me!, cid);
  if (!g.ok) return g.res;
  const { candidate } = g;

  if (!candidate.outcome) {
    // 클라이언트가 응답 본문을 그대로 사용자에게 보여주므로 평문으로 답한다.
    return new Response("종결된 후보자가 아닙니다.", { status: 400 });
  }

  // 낙관적 잠금 — 읽은 뒤 UPDATE 하기까지 사이에 다른 사람이 결정을 바꿨다면
  // (예: 불합격 → 최종합격) 그 결정을 조용히 지우지 않고 실패시킨다.
  const updated = await db
    .update(candidates)
    .set({
      outcome: null,
      outcomeReason: null,
      decidedAt: null,
      decidedByUserId: null,
      decisionFromStage: null,
      // 이번 종결에 남긴 내부 메모 — 되살린 뒤에도 남으면 다음 결정의 메모로 오해된다.
      decisionNote: null,
      // 대량 종결 통보 대기 플래그. 남겨두면 나중에 다시 종결할 때 저녁 드레인이
      // 예상 못 한 메일을 보낸다(되살린 동안은 outcome 조건에 걸려 안 나가지만 플래그는 잔존).
      decisionNotifyQueued: false,
      // '이미 통보함' 표시만 해제 — 다시 종결하면 새로 통보해야 하므로.
      // decisionEmailCount(실제 발송 건수·한도)는 이력이라 유지한다.
      decisionNotifiedExternallyAt: null,
    })
    .where(and(eq(candidates.id, cid), eq(candidates.outcome, candidate.outcome)))
    .returning({ id: candidates.id });

  if (updated.length === 0) {
    return new Response(
      "다른 사용자가 방금 이 후보자의 결정을 변경했습니다. 새로고침 후 다시 시도해 주세요.",
      { status: 409 }
    );
  }

  // cron 과 달리 응답까지 살아있는 요청 컨텍스트라 await 하지 않아도 되지만,
  // 결정 번복은 §37의2 분쟁 입증 대상이라 기록 실패를 응답보다 앞세운다.
  await logAudit(req, {
    actor: me!,
    action: "candidate.reopen",
    resourceType: "candidate",
    resourceId: cid,
    orgId: candidate.orgId,
    jobId: candidate.jobId,
    metadata: {
      name: candidate.name,
      prev_outcome: candidate.outcome,
      prev_reason: candidate.outcomeReason,
      prev_decided_at: candidate.decidedAt,
      prev_decided_by_user_id: candidate.decidedByUserId,
      // 되살린 시점의 "이미 알려진 사실" — 나중에 분쟁 시 무엇을 알고 되돌렸는지 추적.
      decision_emails_sent: candidate.decisionEmailCount,
      was_notified_externally: candidate.decisionNotifiedExternallyAt != null,
      // 메모 내용은 자유서술이라 감사에 평문으로 남기지 않는다(후보자 PII 혼입 가능).
      // 무엇이 지워졌는지 추적할 수 있게 존재 여부만 기록.
      prev_note_present: !!candidate.decisionNote,
      resume_purged: !candidate.resumeFilePath && !candidate.resumeMaskedText,
      stage: candidate.stage,
    },
  });

  return Response.json({ ok: true, stage: candidate.stage });
}
