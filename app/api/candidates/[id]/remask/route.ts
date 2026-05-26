/**
 * 후보자 이력서 마스킹 재처리.
 *
 * 마스킹 로직이 개선됐을 때 — 원본 파일을 다시 읽어 PII 추출 + 마스킹 + sanitize 를 새로 수행.
 *
 * 조건:
 *   - 세션 + ownsOrg + 잠긴 공고 PIN 가드
 *   - resume_file_path 가 살아있어야 함 (합·불 결정으로 폐기된 row 는 불가)
 *   - candidate.status 변경 X — 기존 평가 결과 보존
 */
import { db } from "@/lib/db";
import { candidates, jobPostings } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { isJobUnlocked } from "@/lib/job-lock";
import { extractTextFromBuffer } from "@/lib/parsers";
import { maskText } from "@/lib/mask";
import { extractPII } from "@/lib/pii-extract";
import { sanitizeResumeText } from "@/lib/prompt-safety";
import { readLocalFile } from "@/lib/storage";
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

  const [c] = await db.select().from(candidates).where(eq(candidates.id, cid));
  if (!c) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, c.orgId))
    return new Response("Not found", { status: 404 });

  // 잠긴 공고 가드
  const [job] = await db
    .select({ id: jobPostings.id, passwordHash: jobPostings.passwordHash })
    .from(jobPostings)
    .where(eq(jobPostings.id, c.jobId));
  if (
    job &&
    me!.role !== "system_admin" &&
    job.passwordHash &&
    !(await isJobUnlocked(job.id))
  ) {
    return new Response("잠긴 공고입니다.", { status: 403 });
  }

  if (!c.resumeFilePath)
    return new Response(
      "원본 이력서 파일이 없습니다 (폐기됨 또는 미설정).",
      { status: 400 }
    );

  // 파일 로드 — Blob URL 도 지원
  let buf: Buffer;
  if (/^https?:\/\//i.test(c.resumeFilePath)) {
    const upstream = await fetch(c.resumeFilePath);
    if (!upstream.ok) return new Response("원본 파일 fetch 실패", { status: 502 });
    buf = Buffer.from(await upstream.arrayBuffer());
  } else {
    const found = await readLocalFile(c.resumeFilePath);
    if (!found)
      return new Response("원본 파일을 찾을 수 없습니다.", { status: 404 });
    buf = Buffer.from(found.data);
  }

  // 텍스트 추출 — Blob URL 의 쿼리스트링·해시 제거 후 확장자 인식
  let nameForExt = c.resumeFilePath;
  if (/^https?:\/\//i.test(nameForExt)) {
    try {
      nameForExt = new URL(nameForExt).pathname;
    } catch {
      /* keep raw */
    }
  }
  // 쿼리/해시 잔여 제거
  nameForExt = nameForExt.split("?")[0].split("#")[0];
  let text = "";
  try {
    text = await extractTextFromBuffer(buf, nameForExt);
  } catch (e) {
    return new Response(
      `파일 파싱 실패: ${e instanceof Error ? e.message : String(e)}`,
      { status: 400 }
    );
  }
  if (text.length < 30)
    return new Response("이력서 텍스트 추출이 너무 짧습니다.", { status: 400 });

  // PII 추출 — 기존 candidate.name 을 hint 로
  const pii = extractPII(text, {
    providedName: c.name,
    providedEmail: c.email,
  });

  // 마스킹 + sanitize
  const masked = maskText(text, {
    level: "standard",
    known: {
      name: pii.name || c.name,
      emails: [pii.email, c.email].filter(Boolean) as string[],
      phones: [pii.phone, c.phone].filter(Boolean) as string[],
      companies: pii.companies,
    },
  });
  const sanitized = sanitizeResumeText(masked);

  // candidate 갱신 — masked_text 만 교체. 다른 필드(score/report)는 보존.
  await db
    .update(candidates)
    .set({ resumeMaskedText: sanitized.text })
    .where(eq(candidates.id, cid));

  logAudit(req, {
    actor: me!,
    action: "candidate.view",
    resourceType: "candidate",
    resourceId: cid,
    orgId: c.orgId,
    metadata: {
      op: "remask",
      oldLen: c.resumeMaskedText?.length ?? 0,
      newLen: sanitized.text.length,
    },
  });

  return Response.json({
    ok: true,
    oldLength: c.resumeMaskedText?.length ?? 0,
    newLength: sanitized.text.length,
  });
}
