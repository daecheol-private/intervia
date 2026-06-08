/**
 * 고객센터 문의 처리 — 상태 변경 / 운영팀 답변 메모.
 *
 * 권한: **system_admin 전용** (운영자 지원 데스크). org_admin·member 차단.
 * adminNote 는 고객의 "내 문의 내역"에 답변으로 노출되므로 신중히 작성.
 */
import { db } from "@/lib/db";
import { inquiries } from "@/lib/schema";
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

export const runtime = "nodejs";

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
    void notifyInquiryReply({
      source: row.source,
      category: row.category,
      status: next.status ?? row.status,
      // 이번 PATCH 에 답변이 없으면 기존 답변을 그대로 사용.
      adminNote: nextNote ?? row.adminNote,
      contactEmail: row.contactEmail,
    }).catch((e) => console.error("[inquiry] 회신 메일 실패:", e));
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
