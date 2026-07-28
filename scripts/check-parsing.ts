/**
 * 이력서 파싱 회귀 검증 — 실제 이력서 샘플 + 사람이 확인한 정답표로 추출 로직을 검증한다.
 *
 * 실행:  npm run check:parsing
 *        npm run check:parsing -- --all        # 일치 항목까지 전부 출력
 *        SAMPLE_DIR=D:/other npm run check:parsing
 *
 * 데이터셋(기본 `../sample/이력서`, repo 밖 — 이력서는 PII 라 커밋하지 않는다):
 *   {ID}__{원본파일명}  실제 이력서 원본. ID 는 정답표의 ID 와 1:1 (앱 URL candidates/{ID} 와 동일).
 *                      `__` 뒤가 업로드 당시 파일명이다 — **앱의 이름 결정 1순위가 파일명**이라
 *                      이걸 보존해야 실제 동작을 재현한다. `{ID}.{ext}` 형태도 계속 지원(파일명 정보 없음).
 *   candidate.xlsx    정답표. 헤더: ID,이름,나이,전화번호,이메일,학력,경력
 *
 * 결과는 네 가지로 나뉜다 — **"틀림" 이 0 이어야 한다**(exit code 는 틀림 기준):
 *   ❌ 틀림   정답에 없는 값이 추출됐다. 잘못된 값은 빈 값보다 나쁘다.
 *   ➖ 부족   추출값이 정답의 일부다(예: 정답 "영산대학교 Business 학사" → 추출 "영산대학교 학사").
 *            틀린 정보는 없고 덜 뽑힌 것 — 허용하되 개선 여지.
 *   ⚠️ 누락   정답은 있는데 추출이 완전히 비었다.
 *   ✅ 일치
 *
 * 비교 규칙:
 *   - 검증 대상은 이름 · 나이 · 전화번호 · 이메일 · 학력. 앞 셋이 필수 항목이다.
 *   - **이름은 앱과 같은 순서로 결정한다**: 파일명(`extractKoreanNameFromFilename`) → 본문(`extractPII`).
 *     앱도 파일명이 1순위고 본문 추출은 "(이름 미상)" 일 때만 승격된다(screening.ts). 본문 추출값만
 *     보면 실제와 20%p 넘게 어긋난다 — 이 순서를 바꾸지 말 것.
 *   - 경력은 이력서에 **"총 경력 N년" 으로 적힌 표기만** 검증한다(개월 버림 = 내림).
 *     표기가 없으면 빈 값이고, 그 경우는 LLM(career_info.career_years)이 채우므로 여기 대상이 아니다.
 *   - 학력은 `학교 전공 수준` 을 이어 쓴 문자열. 구분자(`·`/공백) 차이와 "졸업"(= 기본값이라
 *     표기하지 않음)은 정규화 후 비교한다. "수료"·"휴학" 등 특이 상태만 유의미.
 *   - 셀 값이 `?` 면 아직 정답 미확인 → 그 항목만 건너뛴다.
 *
 * 왜 필요한가: 2026-07-20, 합성 픽스처 6개가 전부 통과하는데도 실제 이력서 107건 중 51건이
 * 깨진 회귀를 냈다(학사→고졸 강등, 상태 소실, 엉뚱한 학교). 픽스처는 만든 사람이 상상한
 * 형태만 담는다 — 추출 로직을 고쳤으면 반드시 이 스크립트를 돌릴 것.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { extractTextFromBuffer } from "../lib/parsers";
import { extractPII } from "../lib/pii-extract";
import { extractEducation } from "../lib/education-extract";
import { extractKoreanNameFromFilename } from "../lib/file-classify";

const DIR = process.env.SAMPLE_DIR ?? path.join(process.cwd(), "..", "sample", "이력서");
const SHOW_ALL = process.argv.includes("--all");
const FIELDS = ["이름", "나이", "전화번호", "이메일", "학력", "경력"] as const;

// ───────── xlsx 읽기 (fflate 로 직접 — 신규 의존성 없이) ─────────
function unescapeXml(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
function colToIdx(ref: string): number {
  const m = ref.match(/^([A-Z]+)/);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
function readXlsx(file: string): string[][] {
  const files = unzipSync(readFileSync(file));
  const names = Object.keys(files);
  const shared: string[] = [];
  const ssPath = names.find((n) => /sharedStrings\.xml$/i.test(n));
  if (ssPath) {
    for (const si of strFromU8(files[ssPath]).split(/<si[\s>]/).slice(1)) {
      const parts = [...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]);
      shared.push(unescapeXml(parts.join("")));
    }
  }
  const shPath =
    names.find((n) => /worksheets\/sheet1\.xml$/i.test(n)) ??
    names.find((n) => /worksheets\/.*\.xml$/i.test(n));
  if (!shPath) return [];
  const rows: string[][] = [];
  for (const rowXml of strFromU8(files[shPath]).split(/<row[\s>]/).slice(1)) {
    const cells: string[] = [];
    for (const m of rowXml.matchAll(/<c\s+([^>]*)>([\s\S]*?)<\/c>|<c\s+([^>]*)\/>/g)) {
      const attrs = m[1] ?? m[3] ?? "";
      const body = m[2] ?? "";
      const type = attrs.match(/t="([^"]+)"/)?.[1] ?? "";
      let val: string;
      if (type === "inlineStr") {
        val = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join("");
      } else {
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
        val = type === "s" ? (shared[Number(v)] ?? "") : v;
      }
      const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1] ?? "";
      const idx = ref ? colToIdx(ref) : cells.length;
      while (cells.length < idx) cells.push("");
      cells[idx] = unescapeXml(val).trim();
    }
    rows.push(cells);
  }
  return rows.filter((r) => r.some((c) => c !== ""));
}

/**
 * 학력 정규화 — 구분자(`·`/공백) 통일 + "졸업"은 기본값이라 표기에서 제외.
 *
 * 캠퍼스 표기("고려대학교(세종)")도 비교에서 뺀다. 추출은 원문대로 캠퍼스를 붙이지만
 * 정답표가 일관되지 않기 때문이다 — 원문에 캠퍼스가 있는 14건 중 정답표에 적힌 건 2건뿐이라,
 * 표기 유무로 채점하면 같은 로직이 2건은 맞고 12건은 틀리는 모순이 생긴다.
 * 캠퍼스는 학교 식별을 바꾸지 않으므로(같은 대학) 채점 대상에서 제외한다.
 */
function normEdu(s: string): string {
  return s
    .replace(/\(\s*[가-힣A-Za-z][가-힣A-Za-z ]{0,9}\s*\)/g, " ")
    .replace(/[·•]/g, " ")
    .replace(/졸업/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 앱의 이름 결정 전체 경로 재현 — 업로드 라우트 + screening 승격.
 *
 * `app/api/jobs/[id]/candidates/route.ts` :
 *   providedName || groupName || extractKoreanNameFromFilename || filenameStem || "(이름 미상)"
 * `lib/screening.ts` : "(이름 미상)" 일 때만 본문 추출값으로 승격.
 *
 * **filenameStem 폴백을 빠뜨리면 안 된다** — 이게 있어서 영문 이름 이력서는 값이 비는 게
 * 아니라 "RYAN 이력서" 같은 틀린 이름이 들어간다. 빠뜨리면 "누락"으로 오분류돼 실제보다
 * 좋아 보인다(실측: 누락 7 → 실제로는 틀림 7).
 * (providedName·groupName 은 다건 업로드 컨텍스트라 단건 검증에서는 재현 대상이 아니다.)
 */
function resolveCandidateName(originalName: string, bodyName: string | null): string {
  const fromFile = extractKoreanNameFromFilename(originalName);
  if (fromFile) return fromFile;
  const stem = originalName
    .replace(/\.[^/.]+$/, "")
    .replace(/[_\-]+/g, " ")
    .trim();
  const generic =
    !stem ||
    /^(resume|cv|이력서|sample|test|untitled|file|noname|document|doc)\b/i.test(stem);
  if (!generic) return stem;
  return bodyName ?? "";
}

/** `{ID}__{원본파일명}` / `{ID}.{ext}` 둘 다 지원. 업로드 당시 파일명을 함께 돌려준다. */
function findResume(
  id: string,
  files: string[]
): { file: string; originalName: string } | null {
  for (const f of files) {
    const m = f.match(/^(\d+)(__)?/);
    if (!m || m[1] !== id) continue;
    // `__` 뒤가 원본 파일명. 없으면(구 형식) 파일명 자체를 쓴다 — 이름 추출은 못 하지만
    // 확장자 기반 파서 선택에는 문제 없다.
    return { file: path.join(DIR, f), originalName: m[2] ? f.slice(m[0].length) : f };
  }
  return null;
}

async function main() {
  const xlsx = path.join(DIR, "candidate.xlsx");
  if (!existsSync(xlsx)) {
    console.error(`정답표가 없습니다: ${xlsx}`);
    process.exit(2);
  }
  const [header, ...rows] = readXlsx(xlsx);
  const col = Object.fromEntries(header.map((h, i) => [h.trim(), i])) as Record<string, number>;
  for (const f of ["ID", ...FIELDS]) {
    if (col[f] == null) {
      console.error(`정답표에 '${f}' 컬럼이 없습니다. 헤더: ${header.join(",")}`);
      process.exit(2);
    }
  }

  const files = readdirSync(DIR);
  const wrong: string[] = [];
  const partial: string[] = [];
  const miss: string[] = [];
  const stat: Record<string, { wrong: number; partial: number; miss: number; ok: number }> = {};
  for (const f of FIELDS) stat[f] = { wrong: 0, partial: 0, miss: 0, ok: 0 };
  let rowsOk = 0, noFile = 0, skipped = 0;

  /** 추출 토큰이 전부 정답 안에 있으면 "부족"(틀린 정보 없음), 아니면 "틀림". */
  const isSubset = (want: string, got: string): boolean => {
    const w = want.split(/\s+/).filter(Boolean);
    return got.split(/\s+/).filter(Boolean).every((t) => w.includes(t));
  };

  for (const r of rows) {
    const id = (r[col["ID"]] ?? "").trim();
    const name = (r[col["이름"]] ?? "").trim();
    const found = findResume(id, files);
    if (!found) { noFile++; console.log(`  ?  #${id} ${name} — 이력서 파일 없음`); continue; }

    let actual: Record<string, string>;
    try {
      const text = await extractTextFromBuffer(readFileSync(found.file), found.originalName);
      const pii = extractPII(text);
      const e = extractEducation(text);
      actual = {
        이름: resolveCandidateName(found.originalName, pii.name ?? null),
        나이: pii.age == null ? "" : String(pii.age),
        전화번호: pii.phone ?? "",
        이메일: pii.email ?? "",
        학력: normEdu([e.school, e.major, e.level].filter(Boolean).join(" ")),
        // 결정적 추출("총 경력 N년" 표기)만 검증한다. 표기가 없으면 빈 값 — 그 경우는
        // LLM(career_info.career_years)이 채우는 몫이라 이 스크립트의 검증 대상이 아니다.
        경력: pii.careerYears == null ? "" : `${pii.careerYears}년`,
      };
    } catch (err) {
      stat["학력"].wrong++;
      wrong.push(`  ❌ #${id} ${name} — 파싱 실패: ${(err as Error).message.slice(0, 60)}`);
      continue;
    }

    let rowClean = true;
    for (const f of FIELDS) {
      const raw = (r[col[f]] ?? "").trim();
      if (raw === "?") { skipped++; continue; }
      const want = f === "학력" ? normEdu(raw) : raw;
      const got = actual[f].trim();
      if (want === got) { stat[f].ok++; continue; }
      rowClean = false;
      if (got === "") {
        stat[f].miss++;
        miss.push(`  ⚠️  #${String(id).padEnd(4)} ${f.padEnd(4)} 정답 ${JSON.stringify(want)}`);
      } else if (isSubset(want, got)) {
        stat[f].partial++;
        partial.push(`  ➖ #${String(id).padEnd(4)} ${f.padEnd(4)} 정답 ${JSON.stringify(want)}  →  추출 ${JSON.stringify(got)}`);
      } else {
        stat[f].wrong++;
        wrong.push(`  ❌ #${String(id).padEnd(4)} ${f.padEnd(4)} 정답 ${JSON.stringify(want)}  →  추출 ${JSON.stringify(got)}`);
      }
    }
    if (rowClean) { rowsOk++; if (SHOW_ALL) console.log(`  ✅ #${id} ${name}`); }
  }

  if (wrong.length) {
    console.log(`\n════ ❌ 틀림 ${wrong.length}건 (추출값이 정답과 다름 — 0 이어야 함) ════`);
    wrong.forEach((l) => console.log(l));
  }
  if (partial.length) {
    console.log(`\n════ ➖ 부족 ${partial.length}건 (틀린 정보는 없고 덜 뽑힘 — 허용) ════`);
    partial.forEach((l) => console.log(l));
  }
  if (miss.length) {
    console.log(`\n════ ⚠️  누락 ${miss.length}건 (정답은 있는데 추출이 빔 — 허용) ════`);
    miss.forEach((l) => console.log(l));
  }

  console.log("\n════ 필드별 ════");
  const total = rows.length - noFile;
  for (const f of FIELDS) {
    const s = stat[f];
    const denom = s.ok + s.wrong + s.partial + s.miss || 1;
    console.log(
      `  ${f.padEnd(5)} 일치 ${String(s.ok).padStart(3)}  틀림 ${String(s.wrong).padStart(3)}` +
      `  부족 ${String(s.partial).padStart(3)}  누락 ${String(s.miss).padStart(3)}` +
      `   (일치율 ${((s.ok / denom) * 100).toFixed(0)}%, 무오류 ${(((s.ok + s.partial + s.miss) / denom) * 100).toFixed(0)}%)`
    );
  }
  const totalWrong = FIELDS.reduce((a, f) => a + stat[f].wrong, 0);
  console.log(
    `\n전체 ${total}건 중 완전일치 ${rowsOk}건 / 틀림 ${totalWrong}건` +
    (noFile ? ` / 파일없음 ${noFile}` : "") + (skipped ? ` / 미확인(?) ${skipped}셀` : "")
  );
  process.exit(totalWrong > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
