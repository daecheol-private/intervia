import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { rateLimit } from "@/lib/rate-limit";
import {
  extractFromText,
  extractFromMultimodal,
  type ImportedJob,
} from "@/lib/job-url-import";

export const runtime = "nodejs";

const MAX_TEXT_CHARS = 30_000;
const MAX_IMAGES = 5;
const IMAGE_MAX_BYTES = 5_000_000; // 디코드 후 장당 5MB
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

type ParseBody = {
  text?: string;
  images?: Array<{ mimeType?: string; data?: string }>;
};

/**
 * 붙여넣은 공고 본문(텍스트 또는 캡처 이미지)을 폼 필드로 파싱.
 *
 * URL 임포트(lib/job-url-import)가 쓰는 것과 동일한 추출 규칙·프롬프트를 재사용한다
 * (담당업무·자격요건 분해 + 학력/차별항목 제외 + 선호 특성 추론).
 * 외부 fetch 가 없어 SSRF 표면이 없고, 사람인 등 봇 차단과도 무관하다 —
 * URL 가져오기가 거절될 때의 우회 경로.
 * 이미지가 있으면 멀티모달, 없으면 텍스트 경로 (둘 다 있으면 멀티모달이 텍스트도 함께 읽음).
 */
export async function POST(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role !== "system_admin" && me!.orgId == null)
    return new Response("법인이 지정되지 않은 계정입니다.", { status: 403 });

  const limited = await rateLimit(
    req,
    "job-parse",
    { limit: 20, windowSec: 600 },
    me!.id
  );
  if (limited) return limited;

  let body: ParseBody;
  try {
    body = (await req.json()) as ParseBody;
  } catch {
    return new Response("잘못된 요청입니다.", { status: 400 });
  }

  const text =
    typeof body.text === "string"
      ? body.text.slice(0, MAX_TEXT_CHARS).trim()
      : "";

  const imageParts: Array<{ inlineData: { mimeType: string; data: string } }> =
    [];
  const rawImages = Array.isArray(body.images)
    ? body.images.slice(0, MAX_IMAGES)
    : [];
  for (const img of rawImages) {
    if (!img || typeof img.data !== "string" || typeof img.mimeType !== "string")
      continue;
    const mime = img.mimeType.split(";")[0].trim().toLowerCase();
    if (!SUPPORTED_IMAGE_TYPES.has(mime)) continue;
    // base64 → 디코드 후 바이트 추정 (문자열 길이 * 3/4). 큰 페이로드 조기 차단.
    const approxBytes = Math.floor((img.data.length * 3) / 4);
    if (approxBytes > IMAGE_MAX_BYTES)
      return new Response("이미지가 너무 큽니다 (장당 5MB 이하).", {
        status: 413,
      });
    imageParts.push({ inlineData: { mimeType: mime, data: img.data } });
  }

  if (!text && imageParts.length === 0)
    return new Response("붙여넣은 내용이 없습니다.", { status: 400 });
  if (imageParts.length === 0 && text.length < 20)
    return new Response("텍스트가 너무 짧습니다. 공고 본문을 붙여넣어 주세요.", {
      status: 400,
    });

  let result: ImportedJob | null;
  if (imageParts.length > 0) {
    result = await extractFromMultimodal(text, imageParts, "");
  } else {
    result = await extractFromText(text, "");
  }

  if (!result)
    return new Response(
      "공고 내용을 분석하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      { status: 502 }
    );

  return Response.json(result);
}
