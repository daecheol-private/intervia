/**
 * 본인 법인의 브랜딩 로고 — 업로드(POST)/미리보기(GET)/삭제(DELETE). 지원 페이지·AI 면접 화면 공통.
 * 변경은 org_admin / system_admin 만, 미리보기는 법인 멤버 누구나.
 * 공개 지원 페이지에는 /api/apply/[token]/logo 가 같은 파일 키를 스트리밍한다.
 */
import { db } from "@/lib/db";
import { organizations } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import {
  saveFile,
  deleteFile,
  readStoredFile,
  contentTypeFromName,
} from "@/lib/storage";

export const runtime = "nodejs";

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const ALLOWED_EXT = /\.(png|jpe?g|webp)$/i;

// 확장자 위조 방지 — 매직 바이트로 실제 이미지인지 확인 (PNG/JPEG/WebP).
function looksLikeImage(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
    return true;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  return (
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  );
}

function adminGuard(me: { orgId: number | null; role: string } | null) {
  if (!me?.orgId) return new Response("법인 없음", { status: 400 });
  if (me.role !== "org_admin" && me.role !== "system_admin")
    return new Response("권한 없음 — 법인 관리자만 로고를 변경할 수 있습니다.", {
      status: 403,
    });
  return null;
}

export async function GET() {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (!me!.orgId) return new Response("법인 없음", { status: 400 });

  const [org] = await db
    .select({ logoFileKey: organizations.logoFileKey })
    .from(organizations)
    .where(eq(organizations.id, me!.orgId));
  if (!org?.logoFileKey) return new Response("로고 없음", { status: 404 });

  const buf = await readStoredFile(org.logoFileKey);
  if (!buf) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": contentTypeFromName(org.logoFileKey),
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}

export async function POST(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  const denied = adminGuard(me);
  if (denied) return denied;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return new Response("파일 필요", { status: 400 });
  if (!ALLOWED_EXT.test(file.name))
    return new Response("PNG · JPG · WebP 만 업로드할 수 있습니다.", {
      status: 400,
    });
  if (file.size > MAX_LOGO_BYTES)
    return new Response("로고는 최대 2MB 까지 업로드할 수 있습니다.", {
      status: 400,
    });

  const buf = Buffer.from(await file.arrayBuffer());
  if (!looksLikeImage(buf))
    return new Response("이미지 파일이 아닙니다.", { status: 400 });

  const [org] = await db
    .select({ logoFileKey: organizations.logoFileKey })
    .from(organizations)
    .where(eq(organizations.id, me!.orgId!));

  const key = await saveFile(file.name, buf);
  await db
    .update(organizations)
    .set({ logoFileKey: key })
    .where(eq(organizations.id, me!.orgId!));
  await deleteFile(org?.logoFileKey); // 교체 시 이전 파일 정리 (best-effort)

  logAudit(req, {
    actor: me!,
    action: "org.update" as const,
    resourceType: "org" as const,
    resourceId: me!.orgId!,
    orgId: me!.orgId!,
    metadata: { kind: "branding_logo_upload", size: file.size },
  });

  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  const denied = adminGuard(me);
  if (denied) return denied;

  const [org] = await db
    .select({ logoFileKey: organizations.logoFileKey })
    .from(organizations)
    .where(eq(organizations.id, me!.orgId!));

  await db
    .update(organizations)
    .set({ logoFileKey: null })
    .where(eq(organizations.id, me!.orgId!));
  await deleteFile(org?.logoFileKey);

  logAudit(req, {
    actor: me!,
    action: "org.update" as const,
    resourceType: "org" as const,
    resourceId: me!.orgId!,
    orgId: me!.orgId!,
    metadata: { kind: "branding_logo_delete" },
  });

  return Response.json({ ok: true });
}
