import { isValidElement, type ReactNode } from "react";
import { GUIDE } from "./guide-data";

/**
 * 사용 가이드 검색 — guide-data 의 JSX 본문에서 텍스트를 뽑아 항목 단위로 찾는다.
 * 별도 인덱스 파일/빌드 스텝 없이 런타임에 1회 계산하므로, 가이드 내용을 추가하면 검색도 자동으로 따라온다.
 */
export type GuideHit = {
  id: string;
  title: string;
  category: string;
  snippet: string;
};

type IndexEntry = {
  id: string;
  title: string;
  category: string;
  order: number;
  text: string;
  textLower: string;
  headingLower: string;
};

// 인라인 태그는 앞뒤를 붙여야 태그로 쪼개진 단어가 이어진다(`<strong>결정</strong>합니다` → "결정합니다").
const INLINE_TAGS = new Set([
  "strong",
  "em",
  "b",
  "i",
  "a",
  "code",
  "span",
  "small",
  "u",
]);

function collectText(node: unknown, out: string[]): void {
  if (node == null || typeof node === "boolean") return;
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out);
    return;
  }
  if (!isValidElement(node)) return;

  const inline = typeof node.type === "string" && INLINE_TAGS.has(node.type);
  if (!inline) out.push(" ");
  const props = node.props as Record<string, unknown>;
  for (const [key, value] of Object.entries(props)) {
    // className·href 같은 문자열 prop 은 노이즈. children 과 중첩 노드(Tbl 의 head/rows 등)만 따라간다.
    if (key === "children" || Array.isArray(value) || isValidElement(value)) {
      collectText(value, out);
    }
  }
  if (!inline) out.push(" ");
}

let cachedIndex: IndexEntry[] | null = null;

function getIndex(): IndexEntry[] {
  if (cachedIndex) return cachedIndex;
  let order = 0;
  cachedIndex = GUIDE.flatMap((cat) =>
    cat.items.map((item) => {
      const parts: string[] = [];
      collectText(item.body, parts);
      const text = parts.join("").replace(/\s+/g, " ").trim();
      return {
        id: item.id,
        title: item.title,
        category: cat.category,
        order: order++,
        text,
        textLower: text.toLowerCase(),
        headingLower: `${item.title} ${cat.category}`.toLowerCase(),
      };
    })
  );
  return cachedIndex;
}

export function tokenize(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function snippetAt(text: string, pos: number, len: number): string {
  const start = Math.max(0, pos - 30);
  const end = Math.min(text.length, pos + len + 80);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${
    end < text.length ? "…" : ""
  }`;
}

export function searchGuide(query: string): GuideHit[] {
  const tokens = tokenize(query);
  if (!tokens.length) return [];

  const scored = getIndex()
    .map((entry) => {
      const haystack = `${entry.headingLower} ${entry.textLower}`;
      if (!tokens.every((t) => haystack.includes(t))) return null;

      const inHeading = tokens.some((t) => entry.headingLower.includes(t));
      const bodyPos = tokens
        .map((t) => entry.textLower.indexOf(t))
        .filter((p) => p >= 0)
        .sort((a, b) => a - b)[0];
      const snippet =
        bodyPos === undefined
          ? snippetAt(entry.text, 0, 0)
          : snippetAt(
              entry.text,
              bodyPos,
              tokens.find((t) => entry.textLower.indexOf(t) === bodyPos)
                ?.length ?? 0
            );

      return { hit: { ...entry, snippet }, inHeading };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  return scored
    .sort((a, b) => {
      if (a.inHeading !== b.inHeading) return a.inHeading ? -1 : 1;
      return a.hit.order - b.hit.order;
    })
    .map(({ hit }) => ({
      id: hit.id,
      title: hit.title,
      category: hit.category,
      snippet: hit.snippet,
    }));
}

/** 하이라이트용 — 텍스트를 매칭 구간(hit) 기준으로 쪼갠다. */
export function splitByTokens(
  text: string,
  tokens: string[]
): Array<{ text: string; hit: boolean }> {
  if (!tokens.length || !text) return [{ text, hit: false }];

  const lower = text.toLowerCase();
  const ranges: Array<[number, number]> = [];
  for (const token of tokens) {
    let i = lower.indexOf(token);
    while (i !== -1) {
      ranges.push([i, i + token.length]);
      i = lower.indexOf(token, i + token.length);
    }
  }
  if (!ranges.length) return [{ text, hit: false }];

  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }

  const parts: Array<{ text: string; hit: boolean }> = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) parts.push({ text: text.slice(cursor, start), hit: false });
    parts.push({ text: text.slice(start, end), hit: true });
    cursor = end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), hit: false });
  return parts;
}
