"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import { buildSetupSteps } from "@/lib/setup-steps";
import { GuideStepList } from "./tour/guide-steps";

type Progress = {
  show: boolean;
  step1: boolean;
  step2: boolean;
  step3: boolean;
  step4: boolean;
  firstJobId: number | null;
};

const COLLAPSE_KEY = "setup-guide-widget-collapsed";
// 숨김 확인 후 세션 내 재조회 생략. v2: 구버전("…-done")은 4단계 완료를 캐시했는데
// 정책이 "숨기기 전까지 항상 표시"로 바뀌어 키를 교체 — 구 캐시 무효화.
const DONE_KEY = "setup-guide-widget-dismissed-v2";
const POS_KEY = "setup-guide-widget-pos"; // 드래그로 옮긴 위치 {x,y}

type Pos = { x: number; y: number };

/**
 * 첫 실행 가이드 플로팅 위젯 — 대시보드 밖(공고 상세, 설정 등)에서도
 * 온보딩 진행 단계를 화면 왼쪽 하단에 항상 노출. 4단계 완료 시 사라짐.
 * 대시보드("/")는 자체 가이드(hero/strip)가 있어 제외.
 */
export function SetupGuideWidget() {
  const pathname = usePathname() ?? "";
  const [progress, setProgress] = useState<Progress | null>(null);
  const [collapsed, setCollapsed] = useState<boolean | null>(null);
  const [pos, setPos] = useState<Pos | null>(null); // null = 기본 위치(좌하단)
  const [confirmHide, setConfirmHide] = useState(false);
  const boxRef = useRef<HTMLElement | null>(null);
  const draggedRef = useRef(false); // 드래그 직후 클릭 토글 방지

  // 후보자용·관리자 화면은 조회/렌더 모두 제외.
  const hidden =
    pathname.startsWith("/interview/") ||
    pathname.startsWith("/schedule/") ||
    pathname.startsWith("/unsubscribe/") ||
    pathname.startsWith("/admin");

  // 접힘 상태·위치 복원 — 모바일은 화면을 가리지 않게 기본 접힘.
  useEffect(() => {
    const saved = localStorage.getItem(COLLAPSE_KEY);
    setCollapsed(saved != null ? saved === "1" : window.innerWidth < 640);
    try {
      const p = localStorage.getItem(POS_KEY);
      if (p) setPos(JSON.parse(p) as Pos);
    } catch {
      /* ignore */
    }
  }, []);

  // 화면 크기 변경 시 화면 밖으로 나간 위젯 끌어오기.
  useEffect(() => {
    if (pos == null) return;
    const onResize = () => setPos((p) => (p ? clampToViewport(p) : p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [pos == null]); // eslint-disable-line react-hooks/exhaustive-deps

  // 페이지 이동마다 진행 상태 갱신 — 단계 완료가 다음 화면에서 바로 반영되게.
  useEffect(() => {
    if (hidden || sessionStorage.getItem(DONE_KEY)) return;
    let alive = true;
    fetch("/api/orgs/me/setup-progress", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Progress>) : null))
      .then((j) => {
        if (!alive || !j) return;
        if (!j.show) sessionStorage.setItem(DONE_KEY, "1");
        setProgress(j);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pathname, hidden]);

  // 접기↔펼치기로 크기가 바뀌면 화면 밖으로 나가지 않게 재클램프.
  useEffect(() => {
    setPos((p) => (p ? clampToViewport(p) : p));
  }, [collapsed]); // eslint-disable-line react-hooks/exhaustive-deps

  if (hidden || collapsed == null || !progress?.show) return null;

  const steps = buildSetupSteps(progress, progress.firstJobId);
  const doneCount = steps.filter((s) => s.done).length;
  const active = steps.find((s) => !s.done) ?? null;

  // 대시보드는 미완료 시 자체 가이드(hero/strip)가 있어 중복 방지 —
  // 4단계 완료 후엔 자체 가이드가 사라지므로 플로팅이 이어받는다.
  if (pathname === "/" && active != null) return null;

  const dismiss = () => {
    fetch("/api/orgs/me/setup-progress", { method: "POST" }).catch(() => {});
    sessionStorage.setItem(DONE_KEY, "1");
    setProgress((p) => (p ? { ...p, show: false } : p));
  };

  function clampToViewport(p: Pos): Pos {
    const el = boxRef.current;
    const w = el?.offsetWidth ?? 300;
    const h = el?.offsetHeight ?? 40;
    return {
      x: Math.min(Math.max(8, p.x), Math.max(8, window.innerWidth - w - 8)),
      y: Math.min(Math.max(8, p.y), Math.max(8, window.innerHeight - h - 8)),
    };
  }

  // 드래그 이동 — 펼침 상태는 헤더, 접힘 상태는 알약 전체가 핸들.
  const startDrag = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const el = boxRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const sx = e.clientX;
    const sy = e.clientY;
    draggedRef.current = false;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      // 5px 임계 — 단순 클릭(접기/펼치기)과 드래그 구분
      if (!draggedRef.current && Math.hypot(dx, dy) < 5) return;
      draggedRef.current = true;
      setPos(clampToViewport({ x: rect.left + dx, y: rect.top + dy }));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (draggedRef.current) {
        setPos((p) => {
          if (p) localStorage.setItem(POS_KEY, JSON.stringify(p));
          return p;
        });
        // click 이벤트(pointerup 직후 동기 발생)가 토글을 무시한 뒤 리셋 —
        // 이후 키보드(Enter) 클릭까지 막히지 않게.
        setTimeout(() => {
          draggedRef.current = false;
        }, 0);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const toggle = () => {
    if (draggedRef.current) return; // 드래그로 끝난 제스처는 토글 아님
    setCollapsed(!collapsed);
    localStorage.setItem(COLLAPSE_KEY, collapsed ? "0" : "1");
  };

  // 드래그 이전엔 기본 좌하단, 이후엔 저장된 좌표.
  const posStyle = pos ? { left: pos.x, top: pos.y } : undefined;
  const posClass = pos ? "" : "bottom-4 left-4";

  if (collapsed) {
    return (
      <button
        type="button"
        ref={(el) => {
          boxRef.current = el;
        }}
        onClick={toggle}
        onPointerDown={startDrag}
        style={posStyle}
        aria-label="시작 가이드 펼치기 (드래그로 이동)"
        className={`fixed ${posClass} z-30 inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-primary text-surface text-xs font-semibold shadow-lg hover:bg-primary-deep transition-colors touch-none select-none cursor-grab active:cursor-grabbing`}
      >
        <Sparkles className="w-3.5 h-3.5" />
        시작 가이드 {doneCount}/4
      </button>
    );
  }

  return (
    <aside
      ref={(el) => {
        boxRef.current = el;
      }}
      style={posStyle}
      aria-label="시작 가이드"
      className={`fixed ${posClass} z-30 w-[300px] max-w-[calc(100vw-2rem)] bg-card border border-border-default rounded-2xl shadow-xl overflow-hidden`}
    >
      <header
        onPointerDown={startDrag}
        title="드래그해서 이동"
        className="flex items-center justify-between pl-4 pr-2 py-2.5 border-b border-border-default bg-primary-soft/40 touch-none select-none cursor-grab active:cursor-grabbing"
      >
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-deep">
          <Sparkles className="w-3.5 h-3.5" />
          시작 가이드 · {doneCount}/4 완료
        </span>
        <button
          type="button"
          onClick={toggle}
          aria-label="시작 가이드 접기"
          className="flex items-center justify-center w-7 h-7 rounded-lg text-ink-soft hover:text-ink hover:bg-surface-alt transition-colors"
        >
          <ChevronDown className="w-4 h-4" />
        </button>
      </header>
      <GuideStepList
        steps={steps}
        activeN={active?.n ?? null}
        variant="widget"
      />
      <footer className="px-4 pb-3 pt-1 border-t border-border-default">
        {active == null && (
          <p className="text-[11px] text-primary-deep font-medium pt-2">
            🎉 4단계를 모두 완료했어요! 이제 가이드를 숨겨도 좋아요.
          </p>
        )}
        {confirmHide ? (
          <div className="flex items-center justify-between gap-2 pt-2">
            <span className="text-[11px] text-ink-soft">
              내 화면에서만 숨겨집니다.
            </span>
            <span className="flex gap-1.5 shrink-0">
              <button
                type="button"
                onClick={dismiss}
                className="text-[11px] font-medium px-2 py-1 rounded-md bg-danger text-white hover:opacity-90 transition-opacity"
              >
                숨기기
              </button>
              <button
                type="button"
                onClick={() => setConfirmHide(false)}
                className="text-[11px] font-medium px-2 py-1 rounded-md text-ink-soft hover:bg-surface-alt transition-colors"
              >
                취소
              </button>
            </span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmHide(true)}
            className="text-[11px] text-ink-muted hover:text-ink underline underline-offset-2 pt-2 transition-colors"
          >
            가이드 다시 보지 않기
          </button>
        )}
      </footer>
    </aside>
  );
}
