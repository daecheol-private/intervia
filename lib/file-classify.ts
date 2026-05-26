/**
 * 파일명 기반 분류·그룹화.
 *
 * 후보자 한 명이 이력서 + 포트폴리오 + 자기소개서를 따로 올리거나
 * ZIP 안에 묶어 올렸을 때, 파일명 prefix·키워드로 같은 사람의 파일끼리 묶음.
 */

export type FileKind = "resume" | "portfolio" | "cover_letter" | "other";

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
    kind: "resume",
    patterns: [
      /이력서/,
      /이력기술서/,
      /경력기술서/,
      /경\s*력\s*서/,
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

/**
 * 같은 응시자 식별용 그룹 키.
 *
 * 우선순위 (사용자 합의 2026-05-26):
 *   1) 파일명에 한국 인명 토큰이 있으면 그것으로 그룹화. 같은 폴더 안에 여러 사람의 이력서가
 *      평면으로 들어있는 경우 (예: "팀폴더/개발SM_강준수.pdf", "팀폴더/개발SM_김태경.pdf") 분리.
 *   2) 파일명에서 인명을 못 찾으면 부모 폴더명으로 그룹화 (예: "홍길동/이력서.pdf",
 *      "홍길동/포트폴리오.pdf" — 파일명 단독으로 사람을 식별 못함).
 *   3) 둘 다 없으면 파일명 stem 정규화.
 *
 *   "홍길동_이력서.pdf"            → "홍길동" (1)
 *   "개발SM_강준수_20260522.pdf"   → "강준수" (1, "개발" 은 NON_PERSON_TOKENS 로 거름)
 *   "홍길동/이력서.pdf"            → "홍길동" (2)
 *   "applicants/홍길동/이력서.pdf" → "홍길동" (2)
 *   "Hong Gildong - Resume.pdf"    → "honggildong" (3, 한글 토큰 없음)
 */
export function groupKey(filename: string, path?: string): string {
  const filenameName = extractKoreanNameFromFilename(filename);
  if (filenameName) return normalizeName(filenameName);
  const folder = parentApplicantFolder(filename, path);
  if (folder) return normalizeName(folder);
  return normalizeName(filename.replace(/\.[^./\\]+$/, ""));
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
 * 가장 높은 점수의 파일이 메인 이력서.
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
      }))
      .sort((a, b) => b.score - a.score);
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

export function groupFiles(files: AcceptedFile[]): FileGroup[] {
  const map = new Map<string, AcceptedFile[]>();
  for (const f of files) {
    const k = groupKey(f.name, f.path);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(f);
  }
  const groups: FileGroup[] = [];
  for (const [key, members] of map) {
    const parentFolderOf = (f: AcceptedFile) =>
      f.path ? f.path.split("/").slice(0, -1).pop() : undefined;

    // 점수 기반 정렬 — 가장 높은 점수가 메인 이력서
    const scored = members.map((m) => ({
      file: m,
      score: resumeScore(m.name, parentFolderOf(m)),
    }));
    scored.sort((a, b) => b.score - a.score);
    const resume = scored[0].file;

    const attachments = members
      .filter((m) => m !== resume)
      .map((file) => ({ file, kind: classifyKind(file.name, parentFolderOf(file)) }));

    // 후보자 이름: 그룹키가 폴더에서 온 경우 폴더명을 우선, 아니면 파일명에서 추정.
    // kind 키워드 폴더(이력서/포트폴리오 등) + 부서·직무 폴더(개발/기획 등)는 건너뜀.
    const folderName = members
      .map((m) => (m.path ? m.path.split("/").slice(0, -1) : []))
      .flat()
      .find((d) => d && !isKindKeywordFolder(d) && !NON_PERSON_TOKENS.has(d));
    const candidateName = folderName
      ? folderName
      : extractNameFromFilename(resume.name);
    groups.push({
      key,
      candidateName,
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
  // 직무·일반어 노이즈 제거 (이력서 키워드 외 자주 등장하는 토큰)
  const NOISE = new Set([
    "최종", "수정", "최종본", "초안", "정리", "면접",
    "복사본", "사본", "버전", "백업", "임시", "회사", "지원서",
  ]);
  for (const m of matches) {
    if (NOISE.has(m)) continue;
    if (NON_PERSON_TOKENS.has(m)) continue;
    return m;
  }
  return null;
}
