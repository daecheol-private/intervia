/**
 * 채용 공고 URL 임포트.
 *
 * 흐름:
 *   1. URL 정규화 (사람인 relay/view → view 등)
 *   2. HTML fetch (User-Agent 위장)
 *   3. cheerio 로 본문 추출 + 광고/네비 제거
 *   4. Gemini 텍스트 추출 (1차)
 *   5. 결과가 빈약하면 본문 이미지 N장 수집 → Gemini multimodal 보강 (2차)
 *   6. 양쪽 결과 머지 (다중 패스 voting 대신 2차 우선)
 */
import * as cheerio from "cheerio";
import { generateJSON, generateJSONMultimodal } from "./gemini";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_HTML_BYTES = 2_000_000; // 2MB cap
const MAX_TEXT_CHARS = 30_000;
const MAX_IMAGES = 4;
const IMAGE_MIN_BYTES = 5_000; // 5KB 미만은 광고/아이콘으로 간주
const IMAGE_MAX_BYTES = 4_000_000; // 4MB
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export type ImportedJob = {
  title: string;
  position: string;
  level: string;
  employmentType: string;
  responsibilities: string;
  requirements: string;
  idealProfile: string;
  /** 추출 신뢰도 (0~1). 빈 필드가 많으면 낮게. */
  confidence: number;
  /** 추가 메타. UI 안내용. */
  meta: {
    sourceUrl: string;
    normalizedUrl: string;
    textBytes: number;
    usedImageFallback: boolean;
    imageCount: number;
    siteHint?: string;
  };
};

/** URL 정규화 — 사이트별 알려진 redirect/view 패턴 변환. */
export function normalizeUrl(input: string): string {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    throw new Error("올바른 URL이 아닙니다.");
  }
  // 사람인: relay/view → view (실제 본문이 노출되는 캐노니컬 경로)
  if (u.hostname.includes("saramin.co.kr") && u.pathname.includes("/relay/view")) {
    u.pathname = u.pathname.replace("/relay/view", "/view");
    // 검색 컨텍스트 파라미터 제거
    [
      "view_type",
      "location",
      "searchword",
      "searchType",
      "paid_fl",
      "search_uuid",
      "t_ref",
      "t_ref_content",
    ].forEach((k) => u.searchParams.delete(k));
  }
  // 잡코리아: 검색 컨텍스트 파라미터 제거 (Oem_Code, listno, stext 등)
  if (u.hostname.includes("jobkorea.co.kr")) {
    ["Oem_Code", "logpath", "stext", "listno", "sc"].forEach((k) =>
      u.searchParams.delete(k)
    );
  }
  return u.toString();
}

/**
 * 사이트별 본문 iframe URL 빌더. 메인 페이지가 SUMMARY 만 노출하고
 * 상세는 iframe 으로 분리한 사이트(잡코리아 등)를 위한 helper.
 */
function additionalContentUrls(html: string, mainUrl: string): string[] {
  const urls: string[] = [];
  let u: URL;
  try {
    u = new URL(mainUrl);
  } catch {
    return urls;
  }
  // 잡코리아: GI_Read_Comt_Ifrm?Gno=<id>
  if (u.hostname.includes("jobkorea.co.kr")) {
    const m = u.pathname.match(/GI_Read\/(\d+)/);
    const gno = m?.[1];
    if (gno) {
      urls.push(
        `https://www.jobkorea.co.kr/Recruit/GI_Read_Comt_Ifrm?Gno=${gno}&isHiringCenter=false&hideMapView=true`
      );
    }
  }
  // 일반 — 같은 호스트의 iframe src 추가
  const ifrSrcs = html.match(/<iframe[^>]+src=["']([^"']+)["']/g) ?? [];
  for (const tag of ifrSrcs) {
    const m = tag.match(/src=["']([^"']+)["']/);
    if (!m) continue;
    let absUrl: string;
    try {
      absUrl = new URL(m[1], mainUrl).toString();
    } catch {
      continue;
    }
    // about:blank, GA, GTM 등 명백 noise 제외
    if (/about:blank|googletagmanager|google-analytics|doubleclick/.test(absUrl))
      continue;
    if (new URL(absUrl).hostname !== u.hostname) continue;
    urls.push(absUrl);
  }
  return dedup(urls).slice(0, 3);
}

export function detectSite(url: string): string | undefined {
  try {
    const h = new URL(url).hostname;
    if (h.includes("saramin")) return "saramin";
    if (h.includes("jobkorea")) return "jobkorea";
    if (h.includes("wanted")) return "wanted";
    if (h.includes("jumpit")) return "jumpit";
    if (h.includes("rocketpunch")) return "rocketpunch";
    return undefined;
  } catch {
    return undefined;
  }
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: {
        // 브라우저처럼 보이게 — 일부 사이트는 봇 차단
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        ...(init?.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(t);
  }
}

/** HTML 본문 추출 — 광고/네비/스크립트 제거 후 텍스트화. */
function extractMainText(html: string): { text: string; imageUrls: string[] } {
  const $ = cheerio.load(html);

  // 명백한 noise 제거
  $(
    "script, style, noscript, nav, header, footer, aside, iframe, " +
      "form, button, [role=banner], [role=navigation], [role=contentinfo], " +
      ".gnb, .lnb, .footer, .header, .nav, .menu, .ad, .advertise, .banner, " +
      ".sidebar, .related, .recommend, [class*='ad-'], [id*='ad_'], [id*='ads-']"
  ).remove();

  // 본문은 사이트마다 여러 섹션에 흩어져 있어서 단일 컨테이너로 좁히면 정보 손실.
  // body 전체에서 noise 만 제거하고 30K char 안에서 LLM 에게 넘긴다.
  const $body = $("body") as ReturnType<typeof $>;

  // 본문 텍스트
  const text = $body
    .text()
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT_CHARS);

  // 본문 안의 이미지 URL — 채용 본문 이미지는 보통 절대 URL.
  // 아이콘/로고 제거 위해 alt 없거나 width/height 작은 건 일단 다 포함하고
  // 실제 다운로드 후 크기/MIME 필터.
  const imageUrls: string[] = [];
  $body.find("img").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src") || $(el).attr("data-original");
    if (src && /^https?:/i.test(src)) imageUrls.push(src);
  });

  return { text, imageUrls: dedup(imageUrls).slice(0, MAX_IMAGES * 3) };
}

function dedup<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

/** 이미지 다운로드 → base64. 광고/아이콘은 사이즈 필터로 제외. */
async function downloadAsInlineParts(
  urls: string[]
): Promise<Array<{ inlineData: { mimeType: string; data: string } }>> {
  const out: Array<{ inlineData: { mimeType: string; data: string } }> = [];
  for (const url of urls) {
    if (out.length >= MAX_IMAGES) break;
    try {
      const r = await fetchWithTimeout(url);
      if (!r.ok) continue;
      const mime = (r.headers.get("content-type") ?? "").split(";")[0].trim();
      if (!SUPPORTED_IMAGE_TYPES.has(mime)) continue;
      const ab = await r.arrayBuffer();
      if (ab.byteLength < IMAGE_MIN_BYTES || ab.byteLength > IMAGE_MAX_BYTES) continue;
      const b64 = Buffer.from(ab).toString("base64");
      out.push({ inlineData: { mimeType: mime, data: b64 } });
    } catch {
      /* skip */
    }
  }
  return out;
}

const EXTRACTION_SCHEMA_HINT = `
응답은 반드시 다음 JSON 구조:
{
  "title": "공고 제목 (전체. 예: '백엔드 개발자 (3~7년)')",
  "position": "직무 (예: '백엔드 개발자')",
  "level": "경력 요건 텍스트 (예: '경력 3~7년', '신입~경력 5년', '경력무관')",
  "employmentType": "고용 형태 (예: '정규직', '계약직', '인턴', '프리랜서')",
  "responsibilities": "담당 업무. 줄바꿈으로 구분된 bullet 리스트. 각 줄 앞에 '- '.",
  "requirements": "지원 자격/필수 요건. 줄바꿈으로 구분된 bullet 리스트. 각 줄 앞에 '- '.",
  "idealProfile": "우대사항/선호 인재상. 줄바꿈으로 구분된 bullet 리스트. 각 줄 앞에 '- '. 없으면 빈 문자열."
}

규칙:
- 한국어 채용 공고. 응답도 한국어.
- 광고·추천공고·복리후생·회사 소개는 제외 (요구된 필드에 포함시키지 말 것).
- 추측·날조 X. 페이지에 없으면 빈 문자열.
- 마크다운 백틱 코드블록 없이 raw JSON 만 반환.
`.trim();

/**
 * 텍스트만으로 1차 추출.
 */
async function extractFromText(text: string): Promise<ImportedJob | null> {
  const prompt = `${EXTRACTION_SCHEMA_HINT}

다음은 채용 공고 페이지에서 추출한 본문 텍스트입니다.

---
${text}
---`;
  try {
    const j = await generateJSON<Partial<ImportedJob>>(prompt, { task: "screening" });
    return finalize(j);
  } catch {
    return null;
  }
}

/**
 * 텍스트 + 이미지로 2차 (멀티모달) 추출.
 */
async function extractFromMultimodal(
  text: string,
  imageParts: Array<{ inlineData: { mimeType: string; data: string } }>
): Promise<ImportedJob | null> {
  const prompt = `${EXTRACTION_SCHEMA_HINT}

다음은 채용 공고 페이지에서 추출한 본문 텍스트와, 본문에 첨부된 이미지들입니다.
이미지 안에 담당 업무·지원 자격·우대사항이 그림으로 표시되어 있을 수 있으니 이미지 내용도 함께 읽어 통합 정리하세요.

---본문 텍스트---
${text}
---`;
  try {
    const parts = [{ text: prompt }, ...imageParts];
    const j = await generateJSONMultimodal<Partial<ImportedJob>>(parts, {
      task: "interviewEval",
    });
    return finalize(j);
  } catch {
    return null;
  }
}

function finalize(j: Partial<ImportedJob>): ImportedJob {
  const filled = {
    title: (j.title ?? "").trim(),
    position: (j.position ?? "").trim(),
    level: (j.level ?? "").trim(),
    employmentType: (j.employmentType ?? "").trim(),
    responsibilities: (j.responsibilities ?? "").trim(),
    requirements: (j.requirements ?? "").trim(),
    idealProfile: (j.idealProfile ?? "").trim(),
  };
  // confidence — 핵심 3필드(직무/담당/자격) 채움 정도
  const core = [filled.position, filled.responsibilities, filled.requirements];
  const filledCount = core.filter((v) => v.length >= 5).length;
  const responsibilityLines = filled.responsibilities.split(/\n/).filter(Boolean).length;
  const confidence = Math.min(
    1,
    filledCount / 3 + Math.min(0.2, responsibilityLines * 0.05)
  );
  return { ...filled, confidence, meta: {} as ImportedJob["meta"] };
}

function isThin(j: ImportedJob): boolean {
  const respLines = j.responsibilities.split(/\n/).filter((l) => l.trim()).length;
  const reqLines = j.requirements.split(/\n/).filter((l) => l.trim()).length;
  return j.confidence < 0.6 || respLines < 2 || reqLines < 2;
}

/**
 * 메인 진입점.
 * 텍스트 1차 → 빈약하면 이미지 fallback 2차.
 */
export async function importJobFromUrl(rawUrl: string): Promise<ImportedJob> {
  const normalizedUrl = normalizeUrl(rawUrl);
  const siteHint = detectSite(normalizedUrl);

  const res = await fetchWithTimeout(normalizedUrl);
  if (!res.ok)
    throw new Error(`페이지를 가져오지 못했습니다 (HTTP ${res.status}).`);
  const ab = await res.arrayBuffer();
  if (ab.byteLength > MAX_HTML_BYTES)
    throw new Error("페이지가 너무 큽니다 (2MB 초과).");
  const html = Buffer.from(ab).toString("utf8");

  let { text, imageUrls } = extractMainText(html);

  // 사이트별 추가 본문 (iframe) 추적 — 잡코리아 등 메인이 SUMMARY 만 노출하는 경우.
  const extraUrls = additionalContentUrls(html, normalizedUrl);
  for (const extraUrl of extraUrls) {
    try {
      const r = await fetchWithTimeout(extraUrl, {
        headers: { Referer: normalizedUrl },
      });
      if (!r.ok) continue;
      const eab = await r.arrayBuffer();
      if (eab.byteLength > MAX_HTML_BYTES) continue;
      const eHtml = Buffer.from(eab).toString("utf8");
      const { text: eText, imageUrls: eImgs } = extractMainText(eHtml);
      // 짧은 페이지면 무시 (네비 fragment 등)
      if (eText.length < 200) continue;
      text = (text + "\n\n=== 추가 본문 ===\n" + eText).slice(0, MAX_TEXT_CHARS);
      imageUrls = dedup([...imageUrls, ...eImgs]).slice(0, MAX_IMAGES * 3);
    } catch {
      /* iframe fetch 실패는 무시 */
    }
  }

  if (text.length < 100)
    throw new Error("본문 텍스트를 충분히 추출하지 못했습니다.");

  let result = (await extractFromText(text)) ?? finalize({});
  let usedImageFallback = false;
  let imageCount = 0;

  if (isThin(result) && imageUrls.length > 0) {
    // 절대 URL 보정 (이미 절대만 받음)
    const imageParts = await downloadAsInlineParts(imageUrls);
    if (imageParts.length > 0) {
      const multi = await extractFromMultimodal(text, imageParts);
      if (multi && multi.confidence >= result.confidence) {
        result = multi;
        usedImageFallback = true;
        imageCount = imageParts.length;
      } else {
        imageCount = imageParts.length;
      }
    }
  }

  result.meta = {
    sourceUrl: rawUrl,
    normalizedUrl,
    textBytes: Buffer.byteLength(text, "utf8"),
    usedImageFallback,
    imageCount,
    siteHint,
  };
  return result;
}
