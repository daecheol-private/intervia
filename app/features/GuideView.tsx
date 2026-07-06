"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, List, X } from "lucide-react";
import { GUIDE, type GuideCategory } from "./guide-data";

/**
 * 사용 가이드 트리 뷰 — 좌측 카테고리 트리에서 항목을 고르면 우측에 상세를 표시.
 * 전역 NavBar/Footer 틀 안에서 렌더된다(privacy·terms 등 공개 문서와 동일한 셸·폭).
 * 콘텐츠 자체는 guide-data.tsx 에 분리 — 계속 채워넣는다.
 */
export function GuideView() {
  const flat = GUIDE.flatMap((c) => c.items);
  const [activeId, setActiveId] = useState(flat[0]?.id ?? "");
  const [mobileOpen, setMobileOpen] = useState(false);
  const active = flat.find((i) => i.id === activeId) ?? flat[0];

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

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-ink">사용 가이드</h1>
        <p className="mt-1 text-sm text-ink-soft">
          공고 등록부터 채용 프로세스, 기능·상태·용어까지 안내합니다.
        </p>
      </header>

      <div className="flex gap-8">
        {/* 좌측 트리 (데스크톱) */}
        <aside className="hidden w-56 shrink-0 lg:block">
          <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pr-2">
            {tree}
          </div>
        </aside>

        {/* 콘텐츠 */}
        <main className="min-w-0 flex-1">
          {/* 모바일 목차 토글 */}
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            className="mb-4 inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-card px-3 py-1.5 text-xs font-medium text-ink-soft lg:hidden"
          >
            {mobileOpen ? <X className="h-4 w-4" /> : <List className="h-4 w-4" />}
            목차
          </button>
          {mobileOpen && (
            <div className="mb-6 rounded-xl border border-border-default bg-surface-alt/50 p-3 lg:hidden">
              {tree}
            </div>
          )}

          <article className="max-w-3xl">
            <h2 className="text-xl font-bold text-ink">{active?.title}</h2>
            <div className="mt-4 space-y-4 text-sm leading-relaxed text-ink-soft">
              {active?.body}
            </div>
          </article>
        </main>
      </div>
    </div>
  );
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
