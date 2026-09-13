/**
 * 고객센터 문의 처리 — 상태 변경 / 운영팀 답변 메모 / 삭제.
 *
 * 권한: **system_admin 전용** (운영자 지원 데스크). org_admin·member 차단.
 * adminNote 는 고객의 "내 문의 내역"에 답변으로 노출되므로 신중히 작성.
 */
import { after } from "next/server";
import { db } from "@/lib/db";
import { inquiries, candidates } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser, requirePasswordChanged } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import {
  INQUIRY_STATUSES,
  MESSAGE_MAX,
  type InquiryStatus,
} from "@/lib/inquiry";
import { notifyInquiryReply } from "@/lib/inquiry-notify";
import { getJobContactEmail } from "@/lib/job-contact";

export const runtime = "nodejs";

/** 후보자/지원자 문의가 걸린 공고의 채용 담당자 이메일 — 법인 고객 문의는 null. */
async function inquiryJobContactEmail(row: {
  source: string;
  jobId: number | null;
  candidateId: number | null;
}): Promise<string | null> {
  if (row.source === "org_user") return null;
  let jobId = row.jobId;
  if (!jobId && row.candidateId) {
    const [c] = await db
      .select({ jobId: candidates.jobId })
      .from(candidates)
      .where(eq(candidates.id, row.candidateId));
    jobId = c?.jobId ?? null;
  }
  return jobId ? getJobContactEmail(jobId) : null;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role !== "system_admin")
    return new Response("권한 없음", { status: 403 });
  const pwGuard = requirePasswordChanged(me);
  if (pwGuard) return pwGuard;

  const { id } = await params;
  const iid = Number(id);

  const [row] = await db
    .select({
      orgId: inquiries.orgId,
      source: inquiries.source,
      category: inquiries.category,
      status: inquiries.status,
      adminNote: inquiries.adminNote,
      contactEmail: inquiries.contactEmail,
      userId: inquiries.userId,
      candidateId: inquiries.candidateId,
      jobId: inquiries.jobId,
    })
    .from(inquiries)
    .where(eq(inquiries.id, iid));
  if (!row) return new Response("Not found", { status: 404 });

  const body = (await req.json().catch(() => null)) as {
    status?: string;
    adminNote?: string;
  } | null;
  if (!body) return new Response("잘못된 요청", { status: 400 });

  const next: {
    status?: InquiryStatus;
    adminNote?: string;
    resolvedAt?: string | null;
    resolvedByUserId?: number | null;
  } = {};

  if (body.status) {
    if (!INQUIRY_STATUSES.includes(body.status as InquiryStatus))
      return new Response("상태 값이 올바르지 않습니다.", { status: 400 });
    next.status = body.status as InquiryStatus;
    if (next.status === "resolved") {
      next.resolvedAt = new Date().toISOString();
      next.resolvedByUserId = me!.id;
    } else {
      // 재오픈/처리중 전환 시 완료 표시 해제.
      next.resolvedAt = null;
      next.resolvedByUserId = null;
    }
  }
  if (typeof body.adminNote === "string") {
    if (body.adminNote.length > MESSAGE_MAX)
      return new Response(`답변은 ${MESSAGE_MAX}자 이하로 작성해 주세요.`, {
        status: 400,
      });
    next.adminNote = body.adminNote;
  }
  if (Object.keys(next).length === 0)
    return new Response("변경 사항이 없습니다.", { status: 400 });

  await db.update(inquiries).set(next).where(eq(inquiries.id, iid));

  // 회신 메일 — 완료로 전환되거나, 운영팀 답변이 새로 작성/변경됐을 때만 1회 발송.
  //   (단순 '처리중' 전환·답변 없는 재저장은 발송하지 않음 — 빈/중복 메일 방지)
  const becameResolved = next.status === "resolved" && row.status !== "resolved";
  const nextNote =
    typeof next.adminNote === "string" ? next.adminNote.trim() : null;
  const noteChanged =
    nextNote !== null &&
    nextNote.length > 0 &&
    nextNote !== (row.adminNote ?? "").trim();
  const shouldReply = becameResolved || noteChanged;

  if (shouldReply) {
    // after() — 응답 반환 후 실행 보장. void fire-and-forget 은 서버리스 suspend 로 유실됨.
    after(() =>
      inquiryJobContactEmail(row)
        .catch(() => null) // 연락처 조회 실패로 회신 자체가 누락되면 안 됨
        .then((recruitingContactEmail) =>
          notifyInquiryReply({
            source: row.source,
            category: row.category,
            status: next.status ?? row.status,
            // 이번 PATCH 에 답변이 없으면 기존 답변을 그대로 사용.
            adminNote: nextNote ?? row.adminNote,
            contactEmail: row.contactEmail,
            recruitingContactEmail,
            userId: row.userId,
          })
        )
        .catch((e) => console.error("[inquiry] 회신 통지 실패:", e))
    );
  }

  logAudit(req, {
    actor: me!,
    action: "inquiry.status_change",
    resourceType: "inquiry",
    resourceId: iid,
    orgId: row.orgId,
    metadata: {
      status: next.status,
      has_note: typeof next.adminNote === "string",
      replied: shouldReply,
    },
  });

  return new Response(null, { status: 204 });
}

// 스팸·무가치 문의 정리용. 고객의 "내 문의 내역"에서도 사라지므로 복구 불가.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role !== "system_admin")
    return new Response("권한 없음", { status: 403 });
  const pwGuard = requirePasswordChanged(me);
  if (pwGuard) return pwGuard;

  const { id } = await params;
  const iid = Number(id);

  const [row] = await db
    .select({
      orgId: inquiries.orgId,
      source: inquiries.source,
      category: inquiries.category,
      contactEmail: inquiries.contactEmail,
    })
    .from(inquiries)
    .where(eq(inquiries.id, iid));
  if (!row) return new Response("Not found", { status: 404 });

  await db.delete(inquiries).where(eq(inquiries.id, iid));

  logAudit(req, {
    actor: me!,
    action: "inquiry.delete",
    resourceType: "inquiry",
    resourceId: iid,
    orgId: row.orgId,
    metadata: {
      source: row.source,
      category: row.category,
      contact_email: row.contactEmail,
    },
  });

  return new Response(null, { status: 204 });
}
