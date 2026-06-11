import { db } from "@/lib/db";
import { candidateAttachments } from "@/lib/schema";
import { eq, asc } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { guardCandidate } from "@/lib/candidate-guard";
import { rateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { saveFile } from "@/lib/storage";
import { maskAttachmentText } from "@/lib/screening";
import {
  ATTACHMENT_EXTS,
  MAX_ATTACHMENT_SIZE,
  ext,
  verifyMagic,
} from "@/lib/upload-validation";
import { log } from "@/lib/logger";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { id } = await params;
  const cid = Number(id);
  if (!Number.isInteger(cid)) return new Response("Bad request", { status: 400 });

  const g = await guardCandidate(me!, cid);
  if (!g.ok) return g.res;

  const rows = await db
    .select({
      id: candidateAttachments.id,
      kind: candidateAttachments.kind,
      originalName: candidateAttachments.originalName,
      mime: candidateAttachments.mime,
      sizeBytes: candidateAttachments.sizeBytes,
      createdAt: candidateAttachments.createdAt,
    })
    .from(candidateAttachments)
    .where(eq(candidateAttachments.candidateId, cid))
    .orderBy(asc(candidateAttachments.id));

  return Response.json(rows);
}

const ADDABLE_KINDS = new Set([
  "career_history",
  "portfolio",
  "cover_letter",
  "other",
] as const);
type AddableKind = "career_history" | "portfolio" | "cover_letter" | "other";

/**
 * 첨부 추가 — 이력서만 먼저 등록된 후보자에게 포트폴리오 등을 나중에 보탤 때.
 *
 * 파싱·마스킹을 추가 시점에 동기 수행한다 — 워커 ensureParsed 는 resumeMaskedText 가
 * 이미 있으면 즉시 반환(멱등 가드)하므로, 여기서 maskedText 를 채워야 재평가 때
 * 프롬프트에 포함된다. 기존 평가에는 반영되지 않음 — UI 가 재평가 안내.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const limited = await rateLimit(
    req,
    "attachment-modify",
    { limit: 20, windowSec: 60 },
    me!.id
  );
  if (limited) return limited;

  const { id } = await params;
  const cid = Number(id);
  if (!Number.isInteger(cid)) return new Response("Bad request", { status: 400 });

  const g = await guardCandidate(me!, cid);
  if (!g.ok) return g.res;
  const { candidate } = g;

  // 합·불 결정 시 파일이 즉시 폐기되는 정책 — 결정된 후보자엔 추가 무의미
  if (candidate.outcome)
    return new Response("이미 합·불이 결정된 후보자에는 첨부를 추가할 수 없습니다.", {
      status: 409,
    });
  // 보존기간 경과로 원본 폐기된 후보 — 새 첨부는 폐기 사이클을 비껴가 PIPA 최소보유 위반
  if (!candidate.resumeFilePath && !candidate.resumeMaskedText)
    return new Response(
      "보존기간 경과로 원본이 폐기된 후보자에는 첨부를 추가할 수 없습니다.",
      { status: 409 }
    );

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File))
    return new Response("file 필드가 필요합니다.", { status: 400 });
  const kindRaw = String(form.get("kind") ?? "other");
  const kind: AddableKind = ADDABLE_KINDS.has(kindRaw as AddableKind)
    ? (kindRaw as AddableKind)
    : "other";

  const e = ext(file.name);
  if (!ATTACHMENT_EXTS.has(e))
    return new Response(
      `지원하지 않는 파일 형식입니다 (.${e || "?"}). 허용: ${[...ATTACHMENT_EXTS].join(", ")}`,
      { status: 400 }
    );
  if (file.size === 0) return new Response("빈 파일입니다.", { status: 400 });
  if (file.size > MAX_ATTACHMENT_SIZE)
    return new Response(
      `파일이 너무 큽니다 (최대 ${MAX_ATTACHMENT_SIZE / 1024 / 1024}MB).`,
      { status: 400 }
    );

  const buf = Buffer.from(await file.arrayBuffer());
  const magicErr = verifyMagic(file.name, buf);
  if (magicErr) return new Response(magicErr, { status: 400 });

  // 텍스트 추출+마스킹 — 실패해도 저장은 진행 (사람 면접관 참고용 파일로 유지)
  let maskedText: string | null = null;
  try {
    maskedText = await maskAttachmentText(buf, file.name);
  } catch (err) {
    log.warn("attachment_parse_failed", {
      candidateId: cid,
      filename: file.name,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const key = await saveFile(file.name, buf, undefined);
  const [inserted] = await db
    .insert(candidateAttachments)
    .values({
      candidateId: cid,
      kind,
      filePath: key,
      originalName: file.name,
      mime: null,
      sizeBytes: buf.length,
      maskedText,
    })
    .returning();

  logAudit(req, {
    actor: me!,
    action: "candidate.attachment_add",
    resourceType: "candidate_attachment",
    resourceId: inserted.id,
    orgId: candidate.orgId,
    metadata: {
      candidateId: cid,
      kind,
      originalName: file.name,
      masked: !!maskedText,
    },
  });

  return Response.json({
    ok: true,
    attachment: {
      id: inserted.id,
      kind: inserted.kind,
      originalName: inserted.originalName,
      mime: inserted.mime,
      sizeBytes: inserted.sizeBytes,
      createdAt: inserted.createdAt,
    },
    // false = 이미지 등 텍스트 추출 불가 — AI 평가엔 미반영, 사람 참고용
    parsed: !!maskedText,
  });
}
