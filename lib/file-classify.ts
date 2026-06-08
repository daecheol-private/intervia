/**
 * 파일명 기반 분류·그룹화.
 *
 * 후보자 한 명이 이력서 + 포트폴리오 + 자기소개서를 따로 올리거나
 * ZIP 안에 묶어 올렸을 때, 파일명 prefix·키워드로 같은 사람의 파일끼리 묶음.
 */

export type FileKind =
  | "resume"
  | "career_history"
  | "portfolio"
  | "cover_letter"
  | "other";

/**
 * 2~4자 한글이지만 사람 이름이 아닌 직무·부서·고용형태·일반 명사.
 * ZIP 구조가 "부서명/이름.pdf" 인 경우 폴더명이 candidateName 으로 잘못 채택되는 사고 방지.
 * looksLikeKoreanName / extractKoreanNameFromFilename / groupFiles 폴더 선택에서 모두 거른다.
 */
const NON_PERSON_TOKENS = new Set([
  // 직무
  "개발", "개발자", "기획", "기획자", "디자인", "디자이너", "마케팅", "영업",
  "인사", "총무", "경영", "회계", "재무", "운영", "데이터", "분석", "백엔드",
  "프론트", "풀스택", "모바일", "기술", "연구", "연구원", "연구소", "엔지니어",
  // 조직/직급
  "본부", "본사", "부서", "팀장", "팀원", "매니저", "총괄", "리더", "선임", "책임", "수석",
  // 고용형태·지원상태
  "신입", "경력", "인턴", "정규", "정규직", "계약직", "파견", "지원자", "후보자", "응시자",
  // 카테고리 폴더
  "이력서들", "지원자들", "후보자들", "면접자", "지원",
]);

/**
 * 사람 이름이 아닌데 파일명에 자주 섞이는 한글 토큰 (날짜·버전·상태 라벨 등).
 * 이름 추출/토큰화에서 모두 제외.
 */
const NAME_NOISE = new Set([
  "최종", "수정", "최종본", "초안", "정리", "면접",
  "복사본", "사본", "버전", "백업", "임시", "회사", "지원서",
]);

// 길이 긴 키워드부터 매칭 (cover_letter > letter 등 부분 매칭 회피)
const KIND_KEYWORDS: ReadonlyArray<{ kind: FileKind; patterns: RegExp[] }> = [
  {
    kind: "cover_letter",
    patterns: [/자기소개서/, /자\s*소\s*서/, /cover[\s_-]?letter/i, /cover[\s_-]?note/i],
  },
  {
    kind: "portfolio",
    patterns: [/포트폴리오/, /포\s*폴/, /작품(?:집)?/, /portfolio/i, /works?\b/i, /samples?\b/i],
  },
  {
    // 경력기술서 — 이력서와 함께 상세검토하는 별도 문서. resume 보다 먼저 매칭해야
    // "경력기술서" 가 resume 의 부분 패턴에 잡히지 않는다.
    kind: "career_history",
    patterns: [
      /경력기술서/,
      /경\s*력\s*기\s*술\s*서/,
      /경\s*력\s*서/,
      /career[\s_-]?(?:history|description)/i,
    ],
  },
  {
    kind: "resume",
    patterns: [
      /이력서/,
      /이력기술서/,
      /프로필/,
      /resume/i,
      /\bcv\b/i,
      /curriculum/i,
    ],
  },
];

export function classifyKind(filename: string, parentFolder?: string): FileKind {
  const stem = filename.replace(/\.[^./\\]+$/, "");
  // 1) 파일명 자체에서 키워드 매칭
  for (const { kind, patterns } of KIND_KEYWORDS) {
    for (const re of patterns) if (re.test(stem)) return kind;
  }
  // 2) 폴더명에서도 키워드 매칭 — "홍길동/포트폴리오/works.pdf" 케이스
  if (parentFolder) {
    for (const { kind, patterns } of KIND_KEYWORDS) {
      for (const re of patterns) if (re.test(parentFolder)) return kind;
    }
  }
  return "other";
}

function normalizeName(raw: string): string {
  let s = raw;
  for (const { patterns } of KIND_KEYWORDS) {
    for (const re of patterns) s = s.replace(re, "");
  }
  s = s
    .replace(/[\s_\-./\\()\[\]{}|]/g, "")
    .replace(/^[·•—]+|[·•—]+$/g, "")
    .toLowerCase()
    .trim();
  return s || raw.toLowerCase();
}

/**
 * 응시자 식별용 부모 폴더 결정.
 *  - "홍길동/이력서.pdf" → "홍길동"
 *  - "applicants/홍길동/이력서.pdf" → "홍길동" (가장 안쪽 = 직속 부모)
 *  - 단, 직속 부모가 분류 키워드 폴더(예: "포트폴리오") 이면 한 단계 위로 올라감.
 *    "홍길동/포트폴리오/works.pdf" → "홍길동"
 *  - 파일이 폴더 안에 없으면 null.
 */
function parentApplicantFolder(filename: string, path?: string): string | null {
  if (!path) return null;
  const parts = path.split("/").filter(Boolean);
  // 마지막은 파일명이므로 제외
  const dirs = parts.slice(0, -1);
  if (dirs.length === 0) return null;
  // 안쪽부터 — 분류 키워드 폴더 건너뛰고 첫 일반 폴더
  for (let i = dirs.length - 1; i >= 0; i--) {
    const d = dirs[i];
    if (!isKindKeywordFolder(d)) return d;
  }
  // 모든 폴더가 분류 키워드 — 최상위 사용
  return dirs[0];
}

function isKindKeywordFolder(folderName: string): boolean {
  for (const { patterns } of KIND_KEYWORDS) {
    for (const re of patterns) {
      if (re.test(folderName)) return true;
    }
  }
  return false;
}

export type AcceptedFile = {
  name: string; // 파일명 (leaf)
  buf: Buffer;
  // ZIP 안에서 추출된 파일이면 폴더 경로 포함 — 그룹화·분류에 활용.
  // 단건 업로드는 undefined.
  path?: string;
  // 클라이언트 직접 업로드 경로에서, 이미 Blob 에 올라간 파일의 storage key (URL).
  // 있으면 서버에서 다시 saveFile 하지 않고 그대로 storage key 로 사용.
  storedKey?: string;
};

export type FileGroup = {
  key: string;
  candidateName: string;
  resume: AcceptedFile | null; // 메인 이력서 — LLM 평가/면접 사용
  attachments: Array<{ file: AcceptedFile; kind: FileKind }>; // 첨부 (resume 외)
};

/**
 * 여러 파일을 응시자별로 그룹화.
 *   - 같은 groupKey 끼리 묶음
 *   - 각 그룹에서 resume 분류 1개 선택 (없으면 PDF 우선 → 그래도 없으면 첫 파일)
 *   - 나머지는 attachments 로
 */
/**
 * 한 그룹 내 파일들의 "이력서 적합도" 점수.
 *
 * 우선순위 (사용자 합의):
 *   1순위 (1000+): 파일명에 "이력서" 명시
 *   2순위 (500+): 부모 폴더명에 "이력서" 명시
 *   3순위 (200+): 다른 resume 키워드 (경력기술서/resume/cv/curriculum/프로필)
 *   확장자 가중: .pdf +50, .docx +20 (지원되는 포맷에 한정)
 *   감점: portfolio·cover_letter 분류는 강한 음수 (절대 이력서 아님)
 *
 * 가장 높은 점수의 파일이 메인 이력서. 점수가 같으면(예: "이력서_홍길동.pdf"·
 * "이력서_홍길동2.pdf" 처럼 둘 다 "이력서" 명시) 호출부 sort 의 2차 기준으로
 * 파일 크기가 큰 쪽을 메인으로 채택한다 (buf.length 내림차순).
 */
function resumeScore(name: string, folder?: string): number {
  const stem = name.replace(/\.[^./\\]+$/, "");
  const lower = name.toLowerCase();
  const e = (lower.split(".").pop() ?? "");

  // portfolio / cover_letter 로 분류되면 이력서가 아님 — 강한 음수로 후순위 보장
  const kind = classifyKind(name, folder);
  if (kind === "portfolio" || kind === "cover_letter") return -1000;

  let score = 0;
  // 한국어 "이력서" 가 파일명에 있으면 최우선
  if (/이력서/.test(stem)) score += 1000;
  else if (folder && /이력서/.test(folder)) score += 500;
  else if (kind === "resume") score += 200;
  // 경력기술서는 이력서가 없을 때 메인 이력서로 채택(other·포폴보다 우선), 단 진짜 이력서엔 밀림.
  else if (kind === "career_history") score += 150;

  // 파싱 가능한 확장자 가중
  if (e === "pdf") score += 50;
  else if (e === "docx") score += 20;

  return score;
}

/**
 * 같은 응시자 이름으로 묶이는 그룹들을 하나로 병합.
 *
 * "한 번의 업로드 안에서는 동명이인이 없다" 는 가정.
 * 파일명/폴더 normalize 가 살짝 달라 별개 그룹으로 나뉘었더라도
 * candidateName 이 같으면 한 사람의 자료로 합친다.
 *
 *   "홍길동_이력서.pdf"  (group "홍길동")
 *   "홍길동.pdf"         (group "홍길동")    ← 메인 후보
 *   "홍길동_포폴.pdf"    (group "홍길동")
 *   → 1명. resumeScore 가 가장 높은 파일이 메인 이력서, 나머지 모두 attachments.
 */
export function mergeGroupsByName(groups: FileGroup[]): FileGroup[] {
  const byNorm = new Map<string, FileGroup[]>();
  for (const g of groups) {
    const k = normalizeName(g.candidateName);
    if (!byNorm.has(k)) byNorm.set(k, []);
    byNorm.get(k)!.push(g);
  }
  const out: FileGroup[] = [];
  for (const [, gs] of byNorm) {
    if (gs.length === 1) {
      out.push(gs[0]);
      continue;
    }
    const ranked = gs
      .map((g) => ({
        g,
        score: g.resume ? resumeScore(g.resume.name) : -Infinity,
        // 동점 시 파일 크기 큰 이력서를 메인으로 (groupFiles 와 동일 기준).
        size: g.resume ? g.resume.buf.length : -1,
      }))
      .sort((a, b) => b.score - a.score || b.size - a.size);
    const winner = ranked[0].g;
    const merged: FileGroup = {
      key: winner.key,
      candidateName: winner.candidateName,
      resume: winner.resume,
      attachments: [...winner.attachments],
    };
    for (let i = 1; i < ranked.length; i++) {
      const g = ranked[i].g;
      if (g.resume) {
        const kind = classifyKind(g.resume.name);
        merged.attachments.push({
          file: g.resume,
          kind: kind === "resume" ? "other" : kind,
        });
      }
      merged.attachments.push(...g.attachments);
    }
    out.push(merged);
  }
  return out;
}

/**
 * 파일명에서 "사람 이름 후보" 토큰들을 추출.
 *   - 종류 키워드(이력서/포폴/자소서) 제거
 *   - 숫자(날짜·일련번호) 제거
 *   - NAME_NOISE(최종/수정/사본 등) + NON_PERSON_TOKENS(직무/직급/카테고리) 제거
 *   - 남은 한글(2~4자) + 라틴(2자+) 토큰 반환
 * 배치(여러 파일)로 모아 "공통 토큰 = 직무/카테고리" 판별에 사용.
 *   "기술지원_임채주_20260530_0100001.pdf" → ["임채주"]  ("기술지원" 은 배치 공통이라 제거됨)
 */
export function nameTokens(filename: string): string[] {
  let s = filename.replace(/\.[^./\\]+$/, "");
  for (const { patterns } of KIND_KEYWORDS)
    for (const re of patterns) s = s.replace(re, " ");
  s = s.replace(/\d+/g, " "); // 날짜·일련번호
  const ko = s.match(/[가-힣]{2,4}/g) ?? [];
  const la = s.match(/[A-Za-z]{2,}/g) ?? [];
  return [...ko, ...la].filter(
    (t) => !NAME_NOISE.has(t) && !NON_PERSON_TOKENS.has(t)
  );
}

/** 토큰 풀에서 표시용 이름 선택 — 한글 인명 우선, 없으면 첫 토큰. 풀 비면 null. */
function pickPersonName(pool: string[]): string | null {
  return pool.find((t) => /^[가-힣]{2,4}$/.test(t)) ?? pool[0] ?? null;
}

/**
 * 여러 파일을 응시자별로 그룹화 (배치 인지).
 *
 * 플랫 폴더에 여러 명의 이력서가 "직무_이름_날짜_번호.pdf" 형태로 평면 적재된 경우
 * (사람인/잡코리아 등 채용포털 다운로드 묶음) — 파일마다 공유하는 직무·카테고리 토큰을
 * 배치 빈도로 찾아 제거하고, 파일마다 달라지는 토큰을 사람 이름으로 분리한다.
 *
 *   1패스: 파일별 nameTokens + 배치 전체 토큰 빈도 → "공통(직무/카테고리) 토큰" 판별
 *   2패스: 사람 이름 = (토큰 − 공통토큰). 다 지워지면(공통 토큰이 곧 이름인
 *          "한 명 다(多)문서" 케이스) 원래 토큰으로 복귀. 토큰이 없으면 폴더명(사람별
 *          하위폴더 zip) → 파일 stem 으로 fallback.
 */
export function groupFiles(files: AcceptedFile[]): FileGroup[] {
  const parentFolderOf = (f: AcceptedFile) =>
    f.path ? f.path.split("/").slice(0, -1).pop() : undefined;

  // 1패스: 토큰 + 배치 빈도
  const tokensByFile = new Map<AcceptedFile, string[]>();
  const freq = new Map<string, number>();
  for (const f of files) {
    const toks = nameTokens(f.name);
    tokensByFile.set(f, toks);
    for (const t of new Set(toks)) freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  // 공통(직무/카테고리) 토큰: 파일 2개 이상이고 60% 이상에 등장 → 사람 이름 아님.
  const N = files.length;
  const contextual = new Set<string>();
  if (N >= 2)
    for (const [t, c] of freq)
      if (c >= 2 && c >= Math.ceil(N * 0.6)) contextual.add(t);

  // 2패스: 사람별 그룹화
  const map = new Map<string, AcceptedFile[]>();
  const displayByKey = new Map<string, string>();
  for (const f of files) {
    const toks = tokensByFile.get(f)!;
    const nonCtx = toks.filter((t) => !contextual.has(t));
    const display =
      pickPersonName(nonCtx.length ? nonCtx : toks) ??
      parentApplicantFolder(f.name, f.path) ??
      extractNameFromFilename(f.name);
    const key = normalizeName(display);
    if (!map.has(key)) {
      map.set(key, []);
      displayByKey.set(key, display);
    }
    map.get(key)!.push(f);
  }

  // 그룹 구성: 메인 이력서 선정 + 첨부 분류
  const groups: FileGroup[] = [];
  for (const [key, members] of map) {
    const scored = members
      .map((m) => ({ file: m, score: resumeScore(m.name, parentFolderOf(m)) }))
      // 점수 동점(둘 다 "이력서" 명시 등)이면 파일 크기 큰 쪽을 메인 이력서로.
      // 내용이 더 많은(용량 큰) 파일이 진짜 메인 이력서일 확률이 높다.
      .sort((a, b) => b.score - a.score || b.file.buf.length - a.file.buf.length);
    const resume = scored[0].file;
    const attachments = members
      .filter((m) => m !== resume)
      .map((file) => ({ file, kind: classifyKind(file.name, parentFolderOf(file)) }));
    groups.push({
      key,
      candidateName: displayByKey.get(key)!,
      resume,
      attachments,
    });
  }
  return groups;
}

/**
 * 파일명에서 후보자 이름 추정 — groupKey 와 비슷하지만 한글 표기 유지.
 * "홍길동_이력서.pdf" → "홍길동"
 */
export function extractNameFromFilename(filename: string): string {
  let s = filename.replace(/\.[^./\\]+$/, "");
  for (const { patterns } of KIND_KEYWORDS) {
    for (const re of patterns) s = s.replace(re, "");
  }
  s = s
    .replace(/[_\-./\\()\[\]{}|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s || filename;
}

/**
 * 한국어 이름처럼 보이는지 — 한글 2~4자만으로 구성.
 * 공백·괄호 등 제거 후 검사.
 */
export function looksLikeKoreanName(s: string): boolean {
  if (!s) return false;
  const trimmed = s.replace(/[\s()[\]{}|·•—]/g, "");
  if (!/^[가-힣]{2,4}$/.test(trimmed)) return false;
  if (NON_PERSON_TOKENS.has(trimmed)) return false;
  return true;
}

/**
 * 파일명에서 한국어 이름을 우선 추출. 패턴:
 *   "홍길동_이력서.pdf" / "이력서_홍길동.pdf" / "[홍길동]이력서.pdf" / "홍길동.pdf"
 * 한글 2~4자 토큰을 찾아서 반환. 없으면 null.
 */
export function extractKoreanNameFromFilename(filename: string): string | null {
  const stem = filename.replace(/\.[^./\\]+$/, "");
  // 종류 키워드 제거 후 한글 토큰 추출
  let s = stem;
  for (const { patterns } of KIND_KEYWORDS) {
    for (const re of patterns) s = s.replace(re, " ");
  }
  // 한글 토큰 후보 모두 추출
  const matches = s.match(/[가-힣]{2,4}/g) ?? [];
  for (const m of matches) {
    if (NAME_NOISE.has(m)) continue;
    if (NON_PERSON_TOKENS.has(m)) continue;
    return m;
  }
  return null;
}
