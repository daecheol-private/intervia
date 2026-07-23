/**
 * 감사 로깅. fire-and-forget — 본 흐름 영향 X.
 *
 * 사용:
 *   import { logAudit } from "@/lib/audit";
 *   logAudit(req, {
 *     actor: me,
 *     action: "candidate.delete",
 *     resourceType: "candidate",
 *     resourceId: cid,
 *     orgId: candidate.orgId,
 *     metadata: { name: candidate.name },
 *   });
 *
 * 호출은 await 안 함 (응답 지연 X). 실패는 console.error.
 */
import { db } from "./db";
import { auditLogs } from "./schema";
import { extractIp } from "./auth-attempts";
import type { CurrentUser } from "./auth";
import { captureCritical } from "./error-reporter";
import { and, eq, inArray, or } from "drizzle-orm";

export type AuditAction =
  | "login.success"
  | "logout"
  | "session.revoke"
  | "session.revoke_others"
  | "candidate.view"
  | "candidate.download_resume"
  | "candidate.delete"
  | "candidate.bulk_delete"
  | "candidate.self_view"
  | "candidate.self_delete"
  | "screen.trigger"
  | "screen.bulk_trigger"
  | "interview.create"
  | "interview.send_email"
  | "consent.submit"
  | "appeal.submit"
  | "appeal.status_change"
  // §37의2 조치 결과 통지 — resolved/rejected 전환 시 후보자 답변 메일 발송 여부 입증용.
  | "appeal.response_sent"
  | "appeal.response_send_failed"
  | "inquiry.submit"
  | "inquiry.status_change"
  | "user.role_change"
  | "user.status_change"
  | "user.email_verify"
  | "org.smtp_update"
  | "org.smtp_delete"
  | "job.create"
  | "job.update"
  | "job.delete"
  | "tokens.refund"
  | "tokens.adjust"
  | "coupon.create"
  | "coupon.redeem"
  | "coupon.disable"
  | "org.update"
  | "org.suspend"
  | "org.resume"
  // 공고 타임라인 이벤트 (2026-07)
  | "candidate.stage_change"
  | "interview.start"
  | "interview.complete"
  | "job.close"
  | "job.extend"
  | "job.interviewer_add"
  | "job.interviewer_remove"
  | "schedule.select"
  | "schedule.counter"
  | "schedule.withdraw"
  | "session.force_logout"
  | "user.password_reset_email"
  | "candidate.admin_delete"
  | "org.delete"
  | "user.delete"
  | "org.admin_transfer"
  | "candidate.upload_with_consent"
  // 본인 계정 탈퇴 — 되돌릴 수 없는 자가 삭제.
  | "account.self_delete"
  // 스캔 PDF OCR — 마스킹 전 원본 이력서가 AI 수탁자(Vertex)로 전송됨. PII 외부전송이라 critical.
  | "candidate.scan_ocr"
  // 평가 리포트 외부 공유 링크 — Intervia 계정 없는 제3자에게 평가 결과 노출. 발급/열람/폐기 추적.
  | "shared_report.create"
  | "shared_report.view"
  | "shared_report.revoke";

export type AuditEntry = {
  actor?: CurrentUser | null;
  actorRole?: string; // 명시 — 비로그인 actor (candidate / system)
  action: AuditAction | string;
  resourceType?: string;
  resourceId?: number;
  orgId?: number | null;
  // 관련 공고 — 공고 단위 활동 타임라인(GET /api/jobs/[id]/timeline)에 노출하려면 필수.
  jobId?: number | null;
  metadata?: Record<string, unknown>;
};

// 컴플라이언스 핵심 — 감사 실패 시 critical 알림 발송 대상.
// 권한·역할 변경, 시스템관리자 cross-org 접근, PII 다운로드 등 분쟁 시 입증 필요한 액션.
const CRITICAL_AUDIT_ACTIONS = new Set<string>([
  "user.role_change",
  "user.status_change",
  // 합불 결정(outcome) 포함 — §37의2 분쟁 입증용 (구 user.status_change 에서 분리).
  "candidate.stage_change",
  "user.delete",
  "org.delete",
  "candidate.delete",
  "candidate.bulk_delete",
  "candidate.download_resume",
  "candidate.self_delete",
  "account.self_delete",
  "org.smtp_update",
  "org.smtp_delete",
  "session.revoke_others",
  "appeal.status_change",
  "appeal.response_send_failed",
  "password_reset.confirm",
  "candidate.scan_ocr",
  // 외부 공유 발급 — 계정 없는 제3자에게 평가(간접 PII) 노출. 분쟁 입증용.
  "shared_report.create",
]);

export function logAudit(req: Request | null, entry: AuditEntry): void {
  const ip = req ? extractIp(req) : null;
  const ua = req?.headers.get("user-agent")?.slice(0, 500) ?? null;
  const actorRole =
    entry.actorRole ?? (entry.actor ? entry.actor.role : "anonymous");
  const isCritical = CRITICAL_AUDIT_ACTIONS.has(String(entry.action));
  // cross-org 시스템관리자 접근도 critical 로 간주
  const isCrossOrg =
    entry.actor?.role === "system_admin" &&
    entry.actor.orgId != null &&
    entry.orgId != null &&
    entry.actor.orgId !== entry.orgId;

  void db
    .insert(auditLogs)
    .values({
      actorUserId: entry.actor?.id ?? null,
      actorRole,
      orgId: entry.orgId ?? entry.actor?.orgId ?? null,
      jobId: entry.jobId ?? null,
      action: entry.action,
      resourceType: entry.resourceType ?? null,
      resourceId: entry.resourceId ?? null,
      ip,
      userAgent: ua,
      metadata: {
        ...(entry.metadata ?? {}),
        ...(isCrossOrg ? { cross_org: true } : {}),
      },
    })
    .catch((e) => {
      console.error("[audit] insert failed:", e);
      // critical 액션 감사 실패는 컴플라이언스 사고 — Sentry/Slack 알림
      if (isCritical || isCrossOrg) {
        captureCritical(e instanceof Error ? e : new Error(String(e)), {
          where: "audit.insert",
          action: entry.action,
          actorUserId: entry.actor?.id ?? null,
          orgId: entry.orgId ?? null,
          resourceType: entry.resourceType ?? null,
          resourceId: entry.resourceId ?? null,
        });
      }
    });
}

/**
 * 감사 metadata 에 후보자 PII 로 자주 들어가는 키 — 후보자 폐기 시 redact 대상.
 * (logAudit 호출부에서 실제 사용되는 키들. 새 PII 키 추가 시 여기도 갱신.)
 */
const AUDIT_PII_KEYS = [
  "name",
  "prevName",
  "newName",
  "candidateName",
  "candidateEmail",
  "email",
  "to",
  "recipient",
  "tried_email",
  "phone",
] as const;

/**
 * 후보자 폐기(보유기간 경과 삭제) 시 감사 로그 metadata 의 식별정보를 "[redacted]" 로 치환.
 *
 * 감사 추적성(누가·언제·무엇을 했는지: actorUserId / action / resourceId / createdAt)은
 * 그대로 보존하되, **폐기된 후보자의 이름·이메일·전화 등 직접 식별자만 제거**한다.
 * → PIPA §21(보유목적 달성 후 파기)·최소수집 원칙. 감사 로그는 분쟁 대비 장기 보존되므로,
 *   후보자 행이 삭제된 뒤에도 metadata 에 평문 PII 가 남는 것을 막는다.
 *
 * 대상: resourceType='candidate' 이고 resourceId=candidateId 인 행 +
 *       해당 후보의 interview_session 단위 행(sessionIds 전달 시).
 * fire-and-forget 으로 호출해도 되도록 예외는 호출부에서 처리.
 */
export async function redactCandidateAuditPii(
  candidateId: number,
  sessionIds: number[] = []
): Promise<void> {
  const conds = [
    and(
      eq(auditLogs.resourceType, "candidate"),
      eq(auditLogs.resourceId, candidateId)
    ),
  ];
  if (sessionIds.length > 0) {
    conds.push(
      and(
        eq(auditLogs.resourceType, "interview_session"),
        inArray(auditLogs.resourceId, sessionIds)
      )
    );
  }
  const rows = await db
    .select({ id: auditLogs.id, metadata: auditLogs.metadata })
    .from(auditLogs)
    .where(conds.length === 1 ? conds[0] : or(...conds));

  for (const r of rows) {
    const m = r.metadata;
    if (!m || typeof m !== "object") continue;
    let changed = false;
    const next: Record<string, unknown> = { ...m };
    for (const k of AUDIT_PII_KEYS) {
      if (k in next && next[k] !== "[redacted]") {
        next[k] = "[redacted]";
        changed = true;
      }
    }
    if (changed) {
      await db
        .update(auditLogs)
        .set({ metadata: next })
        .where(eq(auditLogs.id, r.id));
    }
  }
}
