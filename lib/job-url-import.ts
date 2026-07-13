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
import { lookup } from "node:dns/promises";
import type { LookupOptions, LookupAddress } from "node:dns";
import { isIP } from "node:net";
import { Agent } from "undici";
import { generateJSON, generateJSONMultimodal } from "./gemini";
import { maskContacts } from "./mask";
import { TRAIT_KEYS, MAX_HIGH_TRAITS, type TraitKey } from "./personality";

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
  /** 직무 분석 기반 추천 인성 특성 (최대 MAX_HIGH_TRAITS개). 폼에서 high 로 미리 선택된다. */
  preferredTraits: TraitKey[];
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

/** SSRF 방어 — 사설/루프백/링크로컬/메타데이터 대역 IP 차단 여부. */
function isBlockedIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const o = ip.split(".").map(Number);
    if (o[0] === 0 || o[0] === 10 || o[0] === 127) return true; // 0/8, 10/8, 127/8(loopback)
    if (o[0] === 169 && o[1] === 254) return true; // 169.254/16 link-local (클라우드 메타데이터)
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true; // 172.16/12
    if (o[0] === 192 && o[1] === 168) return true; // 192.168/16
    if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return true; // 100.64/10 CGNAT
    return false;
  }
  const v = ip.toLowerCase();
  if (v === "::1" || v === "::") return true; // loopback / unspecified
  if (v.startsWith("fe80")) return true; // link-local
  if (v.startsWith("fc") || v.startsWith("fd")) return true; // unique-local fc00::/7
  const m = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
  if (m) return isBlockedIp(m[1]);
  return false;
}

/**
 * 외부 fetch 전 URL 검증 — http/https 만, 호스트가 사설/내부 대역으로 해석되면 차단.
 * 공고 URL·본문 이미지 fetch 가 내부망·메타데이터(169.254.169.254)에 도달하는 SSRF 를 막는다.
 *
 * 반환: 검증을 통과한 IP. 이 IP 로 연결을 고정(핀)해서, 검증 시점과 fetch 시점의
 * DNS 결과가 달라지는 TOCTOU(DNS rebinding) 우회를 차단한다.
 */
async function assertPublicUrl(raw: string): Promise<string> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("올바르지 않은 URL 입니다.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:")
    throw new Error("http/https URL 만 허용됩니다.");
  const host = u.hostname;
  if (isIP(host)) {
    if (isBlockedIp(host)) throw new Error("내부 주소로의 요청은 차단됩니다.");
    return host;
  }
  // 비표준 IP 표기(정수/8진수/16진수) 차단 — isIP()는 이들을 IP로 인식하지 못해 아래 DNS
  // lookup 분기로 빠지는데, getaddrinfo 가 플랫폼에 따라 loopback 으로 해석하면 SSRF 우회가 된다.
  // 예: 2130706433(=127.0.0.1), 0x7f000001, 0177.0.0.1, 127.1. 정상 도메인은 라벨에 문자가
  // 있어(예: TLD 'com') 이 패턴에 걸리지 않는다.
  if (/^(0x[0-9a-f]+|[0-9]+)(\.(0x[0-9a-f]+|[0-9]+))*$/i.test(host))
    throw new Error("올바르지 않은 호스트입니다.");
  let addrs: Array<{ address: string }>;
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new Error("호스트를 확인할 수 없습니다.");
  }
  if (addrs.length === 0) throw new Error("호스트를 확인할 수 없습니다.");
  for (const a of addrs)
    if (isBlockedIp(a.address))
      throw new Error("내부 주소로의 요청은 차단됩니다.");
  return addrs[0].address;
}

/**
 * 검증된 IP 로 연결을 고정하는 undici dispatcher.
 * fetch 내부의 2차 DNS 조회를 우회하고 이 IP 로만 connect → DNS rebinding 차단.
 * (undici 가 TLS servername 은 원 호스트로 유지하므로 인증서 검증은 정상 동작)
 */
function pinnedDispatcher(ip: string): Agent {
  const family = isIP(ip) === 6 ? 6 : 4;
  // undici 6.x 는 lookup 을 { all: true } 로 호출 → 콜백에 배열을 넘겨야 한다.
  // (양쪽 계약 모두 처리: all 이면 배열, 아니면 단일 주소)
  return new Agent({
    connect: {
      lookup: (
        _hostname: string,
        options: LookupOptions,
        cb: (
          err: NodeJS.ErrnoException | null,
          address: string | LookupAddress[],
          family?: number
        ) => void
      ) =>
        options.all
          ? cb(null, [{ address: ip, family }])
          : cb(null, ip, family),
    },
  });
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  const headers = {
    // 브라우저처럼 보이게 — 일부 사이트는 봇 차단
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    ...(init?.headers ?? {}),
  };
  try {
    // 리다이렉트를 수동 추적하며 각 hop 을 SSRF 재검증 (리다이렉트 기반 우회 차단). 최대 5 hop.
    // 각 hop 은 검증된 IP 로 연결을 고정(핀)해 DNS rebinding 우회까지 차단한다.
    let current = url;
    for (let hop = 0; hop < 5; hop++) {
      const pinnedIp = await assertPublicUrl(current);
      const res = await fetch(current, {
        ...init,
        signal: ctrl.signal,
        redirect: "manual",
        headers,
        dispatcher: pinnedDispatcher(pinnedIp),
      } as RequestInit & { dispatcher: Agent });
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        current = new URL(loc, current).toString();
        continue;
      }
      return res;
    }
    throw new Error("리다이렉트가 너무 많습니다.");
  } finally {
    clearTimeout(t);
  }
}

/**
 * 응답 본문을 스트림으로 읽으며 누적 바이트가 maxBytes 를 넘으면 즉시 중단.
 * arrayBuffer() 는 응답 전체를 메모리에 올린 뒤에야 크기를 알 수 있어, 공격자가
 * 수 GB 응답을 보내면 크기 검사 전에 메모리가 소진된다 → 스트리밍 한도로 선제 차단.
 */
async function readBodyWithLimit(res: Response, maxBytes: number): Promise<Buffer> {
  // 빠른 경로 — Content-Length 가 이미 한도를 넘으면 다운로드 자체를 거부.
  const cl = res.headers.get("content-length");
  if (cl && Number(cl) > maxBytes) {
    throw new Error("응답이 너무 큽니다.");
  }
  // body 가 없으면(스트림 미지원) 기존 arrayBuffer 폴백 + 크기 검사.
  if (!res.body) {
    const ab = await res.arrayBuffer();
    if (ab.byteLength > maxBytes) throw new Error("응답이 너무 큽니다.");
    return Buffer.from(ab);
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("응답이 너무 큽니다.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
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

/**
 * 페이지 메타데이터에서 '정식 공고 제목' 후보 추출.
 * 사람인 등은 상세 본문을 이미지/JS iframe 으로 올려서, 본문(이미지)에 박힌 제목이
 * 실제 공고 제목과 다를 수 있다 (회사가 옛 공고 이미지를 재사용하고 제목만 새로 설정 등).
 * og:title/<title>/og:description 는 사이트가 보장하는 공식 제목이므로 본문보다 우선 신뢰한다.
 */
function extractTitleHint(html: string): { title: string; description: string } {
  const $ = cheerio.load(html);
  const attr = (sel: string) => ($(sel).attr("content") || "").trim();
  const rawTitle =
    attr('meta[property="og:title"]') ||
    attr('meta[name="title"]') ||
    $("title").first().text().trim();
  const rawDesc =
    attr('meta[property="og:description"]') || attr('meta[name="description"]');
  // 사이트명 suffix·마감일(D-n) 표시 제거 (사람인/잡코리아 등 공통 패턴)
  const clean = (s: string) =>
    s
      .replace(
        /\s*[-|]\s*(사람인|잡코리아|원티드|점핏|로켓펀치|saramin|jobkorea|wanted)\s*$/i,
        ""
      )
      .replace(/\(\s*D[-+]?\s*\d+\s*\)/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  return { title: clean(rawTitle), description: clean(rawDesc) };
}

/** 메타 제목 힌트를 프롬프트 fragment 로. 비어 있으면 빈 문자열(기존 동작 유지). */
function buildTitleHintBlock(h: { title: string; description: string }): string {
  if (!h.title && !h.description) return "";
  const lines = [
    "[정식 공고 제목 — 페이지 메타데이터에서 추출한 공식 정보. 본문 텍스트·이미지의 제목보다 우선한다]",
  ];
  if (h.title) lines.push(`제목: ${h.title}`);
  if (h.description) lines.push(`요약: ${h.description}`);
  return lines.join("\n");
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
      const buf = await readBodyWithLimit(r, IMAGE_MAX_BYTES);
      if (buf.byteLength < IMAGE_MIN_BYTES || buf.byteLength > IMAGE_MAX_BYTES) continue;
      const b64 = buf.toString("base64");
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
  "idealProfile": "우대사항/선호 인재상. 줄바꿈으로 구분된 bullet 리스트. 각 줄 앞에 '- '. 없으면 빈 문자열.",
  "preferredTraits": ["이 직무를 잘 수행하는 데 가장 중요한 인성 특성 키 1~3개. 아래 5개 중에서만 고르고 가장 중요한 순서대로 나열."]
}

규칙:
- 한국어 채용 공고. 응답도 한국어.
- 광고·추천공고·복리후생·회사 소개는 제외 (요구된 필드에 포함시키지 말 것).
- **학력·전공 요건은 추출하지 말 것** (블라인드 채용 — 채용절차 공정화법). requirements·idealProfile 에서 최종학력(고졸/초대졸/대졸/석사/박사 등) 조건과 전공(관련 전공 우대 등) 항목은 제외한다. 나이·성별·출신지역 등 차별 금지 항목도 동일하게 제외.
- title~idealProfile 은 추측·날조 X. 페이지에 없으면 빈 문자열.
- **title 은 아래에 '정식 공고 제목'이 주어지면 그것을 근거로 작성한다.** 본문 텍스트나 이미지 안에 다른 제목·배너 문구(회사가 이전 공고에서 남긴 제목 등)가 있어도 무시하고 정식 공고 제목을 따른다. 사이트명·마감일(D-n) 표시는 제외.
- preferredTraits 는 위 규칙의 예외 — 담당 업무·자격 요건을 분석해 직무 성격에서 추론한다 (공고에 명시되지 않아도 됨). 키는 영어 그대로, 아래 5개 중에서만 선택:
  - "openness" (개방성·도전): 새로운 기술·방식을 시도하고 변화가 잦은 환경에 강함. 예) 신규 서비스 개발, 기획, R&D, 신기술 도입.
  - "conscientiousness" (성실성·꼼꼼함): 계획적이고 세부를 꼼꼼히 챙겨 끝까지 마무리. 예) 회계·재무, QA, 운영, 품질·정확성이 중요한 직무.
  - "extraversion" (외향성·표현력): 사람들과 적극적으로 소통하고 주도. 예) 영업, 마케팅, 고객상담, PM, 대외 협력.
  - "agreeableness" (우호성·협업): 팀을 돕고 공동 목표를 우선. 예) 협업 중심 직무, 고객지원, HR, 조율 역할.
  - "emotionalStability" (정서 안정성·회복탄력성): 압박·실패에도 침착. 예) 장애·위기 대응, 고강도 마감, 응급 상황 대처.
- 마크다운 백틱 코드블록 없이 raw JSON 만 반환.
`.trim();

/**
 * 텍스트만으로 1차 추출.
 */
export async function extractFromText(
  text: string,
  titleHint: string
): Promise<ImportedJob | null> {
  // 공개 공고 콘텐츠지만 담당자 이메일·전화가 박힌 경우가 있어 연락처만 마스킹 —
  // PII 제거로 서울 장애 시 도쿄 폴백 허용 (이미지는 마스킹 불가하나 공개 공고 한정).
  const prompt = `${EXTRACTION_SCHEMA_HINT}
${titleHint ? `\n${titleHint}\n` : ""}
다음은 채용 공고 페이지에서 추출한 본문 텍스트입니다.

---
${maskContacts(text)}
---`;
  try {
    const j = await generateJSON<Partial<ImportedJob>>(prompt, {
      task: "screening",
      allowFallback: true,
    });
    return finalize(j);
  } catch {
    return null;
  }
}

/**
 * 텍스트 + 이미지로 2차 (멀티모달) 추출.
 */
export async function extractFromMultimodal(
  text: string,
  imageParts: Array<{ inlineData: { mimeType: string; data: string } }>,
  titleHint: string
): Promise<ImportedJob | null> {
  const prompt = `${EXTRACTION_SCHEMA_HINT}
${titleHint ? `\n${titleHint}\n` : ""}
다음은 채용 공고 페이지에서 추출한 본문 텍스트와, 본문에 첨부된 이미지들입니다.
이미지 안에 담당 업무·지원 자격·우대사항이 그림으로 표시되어 있을 수 있으니 이미지 내용도 함께 읽어 통합 정리하세요.

---본문 텍스트---
${maskContacts(text)}
---`;
  try {
    const parts = [{ text: prompt }, ...imageParts];
    const j = await generateJSONMultimodal<Partial<ImportedJob>>(parts, {
      task: "interviewEval",
      allowFallback: true,
    });
    return finalize(j);
  } catch {
    return null;
  }
}

/** LLM 이 준 preferredTraits 정규화 — 유효 TraitKey 만, 중복 제거, 최대 MAX_HIGH_TRAITS 개. */
function normalizePreferredTraits(input: unknown): TraitKey[] {
  if (!Array.isArray(input)) return [];
  const out: TraitKey[] = [];
  for (const v of input) {
    if (out.length >= MAX_HIGH_TRAITS) break;
    if (
      typeof v === "string" &&
      (TRAIT_KEYS as string[]).includes(v) &&
      !out.includes(v as TraitKey)
    )
      out.push(v as TraitKey);
  }
  return out;
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
  return {
    ...filled,
    preferredTraits: normalizePreferredTraits(
      (j as { preferredTraits?: unknown }).preferredTraits
    ),
    confidence,
    meta: {} as ImportedJob["meta"],
  };
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
  let htmlBuf: Buffer;
  try {
    htmlBuf = await readBodyWithLimit(res, MAX_HTML_BYTES);
  } catch {
    throw new Error("페이지가 너무 큽니다 (2MB 초과).");
  }
  const html = htmlBuf.toString("utf8");

  // 정식 공고 제목 — 메인 페이지 메타데이터에서만 추출 (iframe/추가 본문은 신뢰하지 않음).
  const titleHint = buildTitleHintBlock(extractTitleHint(html));

  let { text, imageUrls } = extractMainText(html);

  // 사이트별 추가 본문 (iframe) 추적 — 잡코리아 등 메인이 SUMMARY 만 노출하는 경우.
  const extraUrls = additionalContentUrls(html, normalizedUrl);
  for (const extraUrl of extraUrls) {
    try {
      const r = await fetchWithTimeout(extraUrl, {
        headers: { Referer: normalizedUrl },
      });
      if (!r.ok) continue;
      const eHtml = (await readBodyWithLimit(r, MAX_HTML_BYTES)).toString("utf8");
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

  let result = (await extractFromText(text, titleHint)) ?? finalize({});
  let usedImageFallback = false;
  let imageCount = 0;

  if (isThin(result) && imageUrls.length > 0) {
    // 절대 URL 보정 (이미 절대만 받음)
    const imageParts = await downloadAsInlineParts(imageUrls);
    if (imageParts.length > 0) {
      const multi = await extractFromMultimodal(text, imageParts, titleHint);
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
