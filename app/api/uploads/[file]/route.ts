/**
 * @deprecated /api/uploads/candidate/[id] 사용 권장. 이 라우트는 인증된 사용자만 허용.
 * - 파일명/URL 단독으로는 owner 추적 불가 → ownsOrg 검증 불가능
 * - 따라서 "로그인된 사용자" 까지만 허용 (system_admin 외 일반 사용자도 접근 가능하지만,
 *   candidate ID 가 노출되지 않은 한 파일명 조합 추측은 어려움 — defense in depth)
 * - 새 코드는 /api/uploads/candidate/[id] 사용. 거기서 ownsOrg + PIN 검증.
 */
import {
  readLocalFile,
  safeDownloadContentType,
  downloadDisposition,
} from "@/lib/storage";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ file: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { file } = await params;
  const decoded = decodeURIComponent(file);

  // Blob URL 직접 호출은 거부 — 새 라우트에서 candidate 기반으로 처리
  if (/^https?:\/\//i.test(decoded)) {
    return new Response(
      "Blob URL 다운로드는 /api/uploads/candidate/[id] 를 사용하세요.",
      { status: 410 }
    );
  }

  const found = await readLocalFile(decoded);
  if (!found) return new Response("Not found", { status: 404 });

  // 위험 타입(html/svg 등)은 octet-stream 강등 + 안전 타입만 inline (저장형 XSS 차단)
  const ct = safeDownloadContentType(found.contentType);
  return new Response(new Uint8Array(found.data), {
    headers: {
      "Content-Type": ct,
      "Content-Disposition": `${downloadDisposition(ct)}; filename*=UTF-8''${encodeURIComponent(decoded)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
