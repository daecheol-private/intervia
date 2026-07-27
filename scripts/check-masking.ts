/**
 * 마스킹 회귀 검증 — 실제 이력서 샘플로 `lib/mask.ts` 의 과검출/과소검출을 동시에 잰다.
 *
 * 실행:  npm run check:masking
 *        npm run check:masking -- --show     # 되살아난 날짜 표본까지 출력
 *
 * 데이터셋은 check-parsing.ts 와 동일(`../sample/이력서`, repo 밖 — PII 라 커밋 금지).
 *
 * 왜 별도인가: check:parsing 은 *추출*(이름·나이·학력)만 본다. 마스킹은 반대 방향의
 * 실패 모드를 갖는다 — 과검출은 정보 손실(경력 기간이 통째로 `[생년월일]` 이 되어 평가·
 * 타임라인이 망가짐), 과소검출은 PII 유출. 둘은 트레이드오프라 한쪽만 재면 반드시 다른
 * 쪽이 무너진다.
 *
 * 지표:
 *   유출(치명)  마스킹 후 텍스트에서 *생년월일 라벨 근처* 완전 날짜가 다시 추출된다 → 0 이어야 한다.
 *               (GOTCHAS §0-7 — 추출이 생년월일로 인식하는 표기는 마스킹도 반드시 가려야 한다)
 *   과검출      기간·수상·취득일 등 이벤트 날짜가 `[생년월일]` 로 치환된 건수. 낮을수록 좋다.
 *   생존 날짜    마스킹 후 남은 완전 날짜(YYYY.MM.DD) 수. 과검출이 줄면 늘어난다.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { extractTextFromBuffer } from "../lib/parsers";
import { extractPII } from "../lib/pii-extract";
import { maskText } from "../lib/mask";

const DIR = process.env.SAMPLE_DIR ?? path.join(process.cwd(), "..", "sample", "이력서");
const SHOW = process.argv.includes("--show");

// lib/pii-extract.ts 의 RE_DOB_LABEL / RE_DOB_LOOSE 와 같은 표기를 대상으로 한다(정합성 검사용 복제).
const RE_DOB_LABEL =
  /(?:생\s*년\s*월\s*일|생\s*년|생\s*일|출\s*생|Date\s*of\s*Birth|D\.?O\.?B\.?|Birth\s*(?:day|date)?|出\s*生|生\s*日)\s*[:：·▶▷-]?/gi;
const RE_DOB_LOOSE =
  /(?<!\d)(\d{4}|\d{2})\s*(?:[.\-/]\s*(?:1[0-2]|0?[1-9])\s*[.\-/]\s*(?:3[01]|[12]\d|0?[1-9])|년\s*(?:1[0-2]|0?[1-9])\s*월\s*(?:3[01]|[12]\d|0?[1-9])\s*일?)/;
// 완전 날짜 — 생존 집계용. lib/mask.ts RE_DOB 가 잡는 표기와 같은 범위를 세야 한다
// (점 표기만 세면 "2003년 11월" 형태의 복원이 지표에 안 잡힌다).
const RE_FULL_DATE =
  /(?<!\d)(?:19|20)\d{2}\s*([.\-/])\s*(?:1[0-2]|0?[1-9])\s*\1\s*(?:3[01]|[12]\d|0?[1-9])|(?<!\d)(?:19|20)\d{2}\s*[년年]\s*(?:1[0-2]|0?[1-9])\s*[월月](?:\s*(?:3[01]|[12]\d|0?[1-9])\s*[일日])?/g;

/** 생년월일로 성립 가능한 연도인가 — lib/pii-extract.ts calcAgeFromDOBYear 의 14~90 범위와 정렬. */
function plausibleBirthYear(raw: string): boolean {
  const n = Number(raw);
  const now = new Date().getFullYear();
  const years = raw.length === 4 ? [n] : [1900 + n, 2000 + n];
  return years.some((y) => now - y >= 14 && now - y <= 90);
}

/** 마스킹 결과에 생년월일 라벨 + 완전 날짜가 함께 남아 있으면 유출로 본다. */
function dobLeaks(masked: string): string[] {
  const hits: string[] = [];
  RE_DOB_LABEL.lastIndex = 0;
  for (const m of masked.matchAll(RE_DOB_LABEL)) {
    // 마스킹 토큰 "[생년월일]" 자체는 라벨이 아니다 — 이걸 세면 토큰 뒤에 있는 무관한
    // 날짜가 전부 유출로 잡힌다(오탐).
    if (masked[(m.index ?? 0) - 1] === "[") continue;
    const start = (m.index ?? 0) + m[0].length;
    const near = masked.slice(start, start + 50);
    const d = near.match(RE_DOB_LOOSE);
    if (d && plausibleBirthYear(d[1])) hits.push(`${m[0].trim()} … ${d[0]}`);
  }
  return hits;
}

async function main() {
  if (!existsSync(DIR)) {
    console.error(`샘플 디렉토리가 없습니다: ${DIR}`);
    process.exit(2);
  }
  const files = readdirSync(DIR).filter((f) => !/\.xlsx$/i.test(f));

  let done = 0, failed = 0;
  let totalDobToken = 0, totalSurvived = 0;
  const leakFiles: string[] = [];
  const perFile: { id: string; dobToken: number; survived: number }[] = [];
  const survivedSamples: string[] = [];

  for (const f of files) {
    let text: string;
    try {
      text = await extractTextFromBuffer(readFileSync(path.join(DIR, f)), f);
    } catch {
      failed++;
      continue;
    }
    if (text.trim().length < 30) {
      failed++;
      continue;
    }
    const pii = extractPII(text, {});
    const masked = maskText(text, {
      level: "standard",
      known: {
        name: pii.name,
        emails: [pii.email].filter(Boolean) as string[],
        phones: [pii.phone].filter(Boolean) as string[],
        companies: pii.companies,
      },
    });

    const dobToken = (masked.match(/\[생년월일\]/g) ?? []).length;
    const survivedList = [...masked.matchAll(RE_FULL_DATE)].map((m) => m[0]);
    const leaks = dobLeaks(masked);

    done++;
    totalDobToken += dobToken;
    totalSurvived += survivedList.length;
    const id = f.match(/^(\d+)/)?.[1] ?? f;
    perFile.push({ id, dobToken, survived: survivedList.length });
    if (leaks.length) leakFiles.push(`#${id}  ${leaks.slice(0, 2).join(" | ")}`);
    if (SHOW && survivedList.length)
      survivedSamples.push(`#${id}  ${survivedList.slice(0, 4).join(", ")}`);
  }

  console.log(`\n샘플 ${done}건 처리 (파싱 실패·빈 파일 ${failed}건 제외)\n`);
  console.log("════ 마스킹 지표 ════");
  console.log(`  [생년월일] 치환 총계     ${totalDobToken}`);
  console.log(`  치환 발생 파일           ${perFile.filter((p) => p.dobToken > 0).length} / ${done}`);
  console.log(`  마스킹 후 생존 날짜 총계  ${totalSurvived}`);
  console.log(`  생존 발생 파일           ${perFile.filter((p) => p.survived > 0).length} / ${done}`);

  const top = perFile.filter((p) => p.dobToken >= 5).sort((a, b) => b.dobToken - a.dobToken);
  if (top.length) {
    console.log(`\n  치환 5건 이상 (과검출 의심): ${top.map((p) => `#${p.id}(${p.dobToken})`).join(" ")}`);
  }
  if (SHOW && survivedSamples.length) {
    console.log("\n════ 생존 날짜 표본 ════");
    for (const s of survivedSamples.slice(0, 25)) console.log(`  ${s}`);
  }

  console.log("\n════ 유출 검사 (0 이어야 함) ════");
  if (leakFiles.length === 0) {
    console.log("  ✅ 생년월일 라벨 근처 날짜 노출 없음");
  } else {
    console.log(`  ❌ ${leakFiles.length}건`);
    for (const l of leakFiles.slice(0, 20)) console.log(`     ${l}`);
  }
  console.log();
  process.exit(leakFiles.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
