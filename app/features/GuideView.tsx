"use client";

import {
  Fragment,
  cloneElement,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { BookOpen, ChevronDown, ChevronRight, List, Search, X } from "lucide-react";
import { GUIDE, type GuideCategory } from "./guide-data";
import { searchGuide, splitByTokens, tokenize } from "./guide-search";

/**
 * 사용 가이드 트리 뷰 — 좌측 카테고리 트리에서 항목을 고르면 우측에 상세를 표시.
 * 검색어를 넣으면 트리 자리에 결과 목록이 뜨고, 본문에서 일치 구간이 강조된다.
 * 전역 NavBar/Footer 틀 안에서 렌더된다(privacy·terms 등 공개 문서와 동일한 셸·폭).
 * 콘텐츠 자체는 guide-data.tsx 에 분리 — 계속 채워넣는다.
 */
export function GuideView() {
  const flat = useMemo(() => GUIDE.flatMap((c) => c.items), []);
  const [activeId, setActiveId] = useState(flat[0]?.id ?? "");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const tokens = useMemo(() => tokenize(query), [query]);
  const results = useMemo(() => searchGuide(query), [query]);
  const searching = tokens.length > 0;

  const active = flat.find((i) => i.id === activeId) ?? flat[0];
  const body = useMemo(
    () => (searching ? highlightNode(active?.body, tokens) : active?.body),
    [active?.body, tokens, searching]
  );

  // 어디서든 "/" 또는 Ctrl/⌘+K 로 검색창에 바로 진입.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        !!el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable);
      const shortcut =
        (e.key === "/" && !typing) ||
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k");
      if (!shortcut) return;
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const pick = (id: string) => {
    setActiveId(id);
    setMobileOpen(false);
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  };

  const tree = (
    <nav className="space-y-1">
      {GUIDE.map((cat) => (
        <CategoryNode
          key={cat.category}
          cat={cat}
          activeId={activeId}
          onPick={pick}
        />
      ))}
    </nav>
  );

  const resultList =
    results.length === 0 ? (
      <p className="px-2 py-3 text-xs leading-relaxed text-ink-muted">
        ‘{query.trim()}’ 에 대한 검색 결과가 없습니다.
        <br />
        다른 낱말로 찾아보세요.
      </p>
    ) : (
      <div className="space-y-1">
        <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-ink-muted">
          검색 결과 {results.length}건
        </p>
        {results.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => pick(r.id)}
            className={
              "block w-full rounded-md px-2 py-1.5 text-left transition-colors " +
              (activeId === r.id
                ? "bg-primary-soft"
                : "hover:bg-surface-alt")
            }
          >
            <span className="block text-[11px] text-ink-muted">
              {r.category}
            </span>
            <span className="block text-[13px] font-medium text-ink">
              <Highlight text={r.title} tokens={tokens} />
            </span>
            <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-ink-soft">
              <Highlight text={r.snippet} tokens={tokens} />
            </span>
          </button>
        ))}
      </div>
    );

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <div className="flex items-center gap-2">
          <BookOpen className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold text-ink">사용 가이드</h1>
        </div>
        <p className="mt-1 text-sm text-ink-soft">
          공고 등록부터 채용 프로세스, 기능·상태·용어까지 안내합니다.
        </p>

        <div className="relative mt-4 max-w-lg">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
              if (e.key === "Enter" && results[0]) pick(results[0].id);
            }}
            placeholder="가이드 검색 (예: 토큰, 마스킹, 일정 조율)"
            aria-label="사용 가이드 검색"
            className="w-full rounded-lg border border-border-default bg-card py-2 pl-9 pr-9 text-sm text-ink placeholder:text-ink-muted focus:border-primary/50 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              aria-label="검색어 지우기"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-ink-muted hover:bg-surface-alt hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

      <div className="flex gap-8">
        {/* 좌측 트리 / 검색 결과 (데스크톱) */}
        <aside className="hidden w-56 shrink-0 lg:block">
          <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pr-2">
            {searching ? resultList : tree}
          </div>
        </aside>

        {/* 콘텐츠 */}
        <main className="min-w-0 flex-1">
          {/* 모바일 — 검색 중이면 결과 목록, 아니면 목차 토글 */}
          {searching ? (
            <div className="mb-6 max-h-72 overflow-y-auto rounded-xl border border-border-default bg-surface-alt/50 p-3 lg:hidden">
              {resultList}
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setMobileOpen((v) => !v)}
                className="mb-4 inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-card px-3 py-1.5 text-xs font-medium text-ink-soft lg:hidden"
              >
                {mobileOpen ? (
                  <X className="h-4 w-4" />
                ) : (
                  <List className="h-4 w-4" />
                )}
                목차
              </button>
              {mobileOpen && (
                <div className="mb-6 rounded-xl border border-border-default bg-surface-alt/50 p-3 lg:hidden">
                  {tree}
                </div>
              )}
            </>
          )}

          <article className="max-w-3xl">
            <h2 className="text-xl font-bold text-ink">
              {searching && active ? (
                <Highlight text={active.title} tokens={tokens} />
              ) : (
                active?.title
              )}
            </h2>
            <div className="mt-4 space-y-4 text-sm leading-relaxed text-ink-soft">
              {body}
            </div>
          </article>
        </main>
      </div>
    </div>
  );
}

const MARK_CLASS = "rounded-[3px] bg-accent-soft px-0.5 text-accent-deep";

function Highlight({ text, tokens }: { text: string; tokens: string[] }) {
  const parts = splitByTokens(text, tokens);
  return (
    <>
      {parts.map((p, i) =>
        p.hit ? (
          <mark key={i} className={MARK_CLASS}>
            {p.text}
          </mark>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        )
      )}
    </>
  );
}

/**
 * 본문(JSX) 안의 문자열 노드를 골라 <mark> 로 감싼다.
 * children 외에 Tbl 의 head/rows 같은 ReactNode prop 도 따라간다(guide-search 의 텍스트 수집과 같은 규칙).
 * 배열은 배열인 채로 돌려줘야 한다 — Fragment 로 감싸면 rows 를 .map 하는 Tbl 이 깨진다.
 */
function highlightNode(node: ReactNode, tokens: string[]): ReactNode {
  if (!tokens.length || node == null || typeof node === "boolean") return node;

  if (typeof node === "string") {
    const parts = splitByTokens(node, tokens);
    if (parts.length === 1 && !parts[0].hit) return node;
    return parts.map((p, i) =>
      p.hit ? (
        <mark key={i} className={MARK_CLASS}>
          {p.text}
        </mark>
      ) : (
        <Fragment key={i}>{p.text}</Fragment>
      )
    );
  }

  if (Array.isArray(node)) {
    let changed = false;
    const next = node.map((child, i) => {
      const out = highlightNode(child, tokens);
      if (out !== child) changed = true;
      // 새로 만든 배열이라 React 가 key 를 요구한다. 단 중첩 배열(Tbl 의 rows)은 감싸면 .map 이 깨진다.
      if (Array.isArray(out)) return out;
      if (isValidElement(out))
        return out.key != null
          ? out
          : cloneElement(out as ReactElement, { key: `h${i}` });
      return out !== child ? <Fragment key={`h${i}`}>{out}</Fragment> : out;
    });
    return changed ? next : node;
  }

  if (isValidElement(node)) {
    const props = node.props as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    let changed = false;
    for (const [key, value] of Object.entries(props)) {
      if (key !== "children" && !Array.isArray(value) && !isValidElement(value))
        continue;
      const next = highlightNode(value as ReactNode, tokens);
      if (next === value) continue;
      patch[key] = next;
      changed = true;
    }
    if (!changed) return node;
    return cloneElement(node as ReactElement<Record<string, unknown>>, patch);
  }

  return node;
}

function CategoryNode({
  cat,
  activeId,
  onPick,
}: {
  cat: GuideCategory;
  activeId: string;
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted hover:text-ink"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        )}
        {cat.category}
      </button>
      {open && (
        <div className="ml-2 space-y-0.5 border-l border-border-default pl-2">
          {cat.items.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => onPick(it.id)}
              className={
                "block w-full rounded-md px-2 py-1.5 text-left text-[13px] transition-colors " +
                (activeId === it.id
                  ? "bg-primary-soft font-medium text-primary-deep"
                  : "text-ink-soft hover:bg-surface-alt hover:text-ink")
              }
            >
              {it.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
