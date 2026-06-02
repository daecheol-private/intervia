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
  | "org.update"
  | "org.suspend"
  | "org.resume"
  | "session.force_logout"
  | "user.password_reset_email"
  | "candidate.admin_delete"
  | "org.admin_transfer"
  | "candidate.upload_with_consent"
  // 스캔 PDF OCR — 마스킹 전 원본 이력서가 AI 수탁자(Vertex)로 전송됨. PII 외부전송이라 critical.
  | "candidate.scan_ocr";

export type AuditEntry = {
  actor?: CurrentUser | null;
  actorRole?: string; // 명시 — 비로그인 actor (candidate / system)
  action: AuditAction | string;
  resourceType?: string;
  resourceId?: number;
  orgId?: number | null;
  metadata?: Record<string, unknown>;
};

// 컴플라이언스 핵심 — 감사 실패 시 critical 알림 발송 대상.
// 권한·역할 변경, 시스템관리자 cross-org 접근, PII 다운로드 등 분쟁 시 입증 필요한 액션.
const CRITICAL_AUDIT_ACTIONS = new Set<string>([
  "user.role_change",
  "user.status_change",
  "candidate.delete",
  "candidate.bulk_delete",
  "candidate.download_resume",
  "candidate.self_delete",
  "org.smtp_update",
  "org.smtp_delete",
  "session.revoke_others",
  "appeal.status_change",
  "password_reset.confirm",
  "candidate.scan_ocr",
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
