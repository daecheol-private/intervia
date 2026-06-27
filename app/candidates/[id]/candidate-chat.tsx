"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquare, Send } from "lucide-react";
import { formatKstDateTime } from "@/lib/utils";
import { confirmDialog } from "@/app/components/Dialog";

type Comment = {
  id: number;
  authorUserId: number;
  authorName: string | null;
  body: string;
  createdAt: string;
};

/**
 * 이력서별 면접관 토론 — 액션바 토글 버튼 + 우측 슬라이드 드로어(데스크탑) / 전체화면(모바일).
 *
 * 스코어카드를 대체하는 자유 코멘트(채팅). AI 면접 채팅 톤: 내 글 녹색·우측, 남의 글 흰색·좌측.
 * 실시간 근사 = 폴링. 마운트 중엔 항상(닫혀도) 폴링해서 "안 읽은 글 수"를 라이브로 갱신 —
 * 여러 면접관이 같은 이력서를 볼 때 누가 글을 쓰면 버튼 배지에 안읽음 수가 바로 뜬다.
 * 읽음 기준선은 브라우저 localStorage 에 저장(서버 read-state 없이 가벼운 MVP).
 */
export function CandidateChat({ candidateId }: { candidateId: number }) {
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState<{ id: number; name: string } | null>(null);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // 이 사용자가 마지막으로 읽은(=본) 코멘트 id. 이보다 큰 남의 글이 "안 읽음".
  // 서버(candidate_comment_reads)에 기록 — 기기 무관하게 정확하다.
  const [lastReadId, setLastReadId] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null); // 슬라이드 패널 — 폭 실측용
  const lastIdRef = useRef(0); // 폴링 커서 — 마지막으로 받은 코멘트 id
  const markedRef = useRef(0); // 서버에 "읽음" 처리한 마지막 코멘트 id (중복 POST 방지)

  // 패널을 보고 있는 동안 호출 — 서버에 이 후보자의 코멘트를 모두 읽음 처리하고
  // 로컬 lastReadId 도 올려 배지를 즉시 0 으로. id 가 더 안 늘었으면 no-op.
  const markRead = useCallback(
    (id: number) => {
      if (id <= markedRef.current) return;
      markedRef.current = id;
      setLastReadId((prev) => Math.max(prev, id));
      void fetch(`/api/candidates/${candidateId}/comments/read`, {
        method: "POST",
      }).catch(() => {
        /* 실패 시 다음 열람에서 다시 시도 */
      });
    },
    [candidateId]
  );

  // 최초: 작성자 식별 + 코멘트 로드 + (사용자별) 읽음 기준선 복원.
  // 첫 방문은 자동 읽음 처리하지 않는다 — 아직 패널을 열어본 적 없으니 남이 쓴 기존 글은
  // "안 읽음"으로 보이는 게 맞다(채팅앱의 미확인 대화처럼). 패널을 열면 그때 읽음 처리된다.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [meR, listR, readR] = await Promise.all([
        fetch("/api/auth/status")
          .then((r) => r.json())
          .catch(() => null),
        fetch(`/api/candidates/${candidateId}/comments`)
          .then((r) => (r.ok ? r.json() : []))
          .catch(() => []),
        // 서버 읽음선 — 없으면(처음 보는 후보자) 0 → 남의 기존 글은 모두 "안 읽음"으로 표시.
        fetch(`/api/candidates/${candidateId}/comments/read`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);
      if (!alive) return;
      setMe(meR?.user ?? null);
      const list: Comment[] = Array.isArray(listR) ? listR : [];
      setComments(list);
      lastIdRef.current = list.length ? list[list.length - 1].id : 0;
      const serverRead = Number(readR?.lastReadId) || 0;
      setLastReadId(serverRead);
      markedRef.current = serverRead;
    })();
    return () => {
      alive = false;
    };
  }, [candidateId]);

  // 새 코멘트만 가져와 append (폴링/열기 공용).
  const fetchNew = useCallback(async () => {
    const r = await fetch(
      `/api/candidates/${candidateId}/comments?afterId=${lastIdRef.current}`
    ).catch(() => null);
    if (!r || !r.ok) return;
    const fresh: Comment[] = await r.json().catch(() => []);
    if (!Array.isArray(fresh) || fresh.length === 0) return;
    lastIdRef.current = fresh[fresh.length - 1].id;
    setComments((prev) => {
      const base = prev ?? [];
      const have = new Set(base.map((c) => c.id));
      const add = fresh.filter((c) => !have.has(c.id));
      return add.length ? [...base, ...add] : base;
    });
  }, [candidateId]);

  // 마운트 중 항상 폴링 — 열려 있으면 3초, 닫혀 있으면 10초(안읽음 배지 라이브 갱신).
  // 닫힌 패널은 실시간성이 덜 중요하므로 간격을 늘려 상시 폴링 부하를 줄인다.
  // 탭이 백그라운드면 건너뜀.
  useEffect(() => {
    if (open) void fetchNew();
    const t = setInterval(
      () => {
        if (document.visibilityState === "visible") void fetchNew();
      },
      open ? 3000 : 10000
    );
    return () => clearInterval(t);
  }, [open, fetchNew]);

  // 열려서 보고 있는 동안은 새 글이 와도 즉시 읽음 처리 → 배지 0 유지.
  useEffect(() => {
    if (!open || !comments || comments.length === 0) return;
    markRead(comments[comments.length - 1].id);
  }, [open, comments, markRead]);

  // 열려 있을 때 새 메시지/열림 시 맨 아래로 스크롤.
  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [comments, open]);

  // 비모달이라 배경 클릭으로 닫히지 않으므로 Esc 로 닫기 지원.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // 패널이 열리면 본문([data-iv-shiftable])을 "가려지는 만큼" 왼쪽으로 민다 — 단, 본문
  // 좌우 중앙정렬로 생긴 왼쪽 여백 한도 내에서만(레일 침범 X). 채팅창은 우측 고정이라 넓은
  // 화면에서 본문 오른쪽을 덮는데, 그 여백을 활용해 가림을 줄인다. 이동량은 실측으로 계산.
  // 본문의 relative+left 로 밀므로(transform X) 측정은 transform 비의존인 offsetWidth +
  // 비이동 부모(parent) 기준으로 해 피드백 루프가 없다. 화면 리사이즈 시 재계산.
  useEffect(() => {
    const root = document.documentElement;
    const reset = () => root.style.setProperty("--iv-chat-shift", "0px");
    if (!open) {
      reset();
      return;
    }
    const apply = () => {
      const content = document.querySelector<HTMLElement>("[data-iv-shiftable]");
      const parent = content?.parentElement ?? null;
      const drawer = drawerRef.current;
      if (!content || !parent || !drawer) return reset();
      const viewportW = root.clientWidth;
      const drawerW = drawer.offsetWidth;
      // 드로어가 화면 대부분을 덮으면(모바일 전체화면) 밀어도 의미 없음.
      if (drawerW >= viewportW * 0.7) return reset();
      const parentRect = parent.getBoundingClientRect();
      const contentW = content.offsetWidth; // 레이아웃 폭(상대이동 영향 X)
      const leftRoom = Math.max(0, (parentRect.width - contentW) / 2);
      const contentRight = parentRect.left + (parentRect.width + contentW) / 2;
      const overlap = contentRight - (viewportW - drawerW);
      const shift = Math.max(0, Math.min(overlap, leftRoom));
      root.style.setProperty(
        "--iv-chat-shift",
        shift > 1 ? `-${Math.round(shift)}px` : "0px"
      );
    };
    apply();
    window.addEventListener("resize", apply);
    return () => {
      window.removeEventListener("resize", apply);
      reset();
    };
  }, [open]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    setErr("");
    const r = await fetch(`/api/candidates/${candidateId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: text }),
    });
    setBusy(false);
    if (!r.ok) {
      setErr(await r.text());
      return;
    }
    const created: Comment = await r.json();
    lastIdRef.current = Math.max(lastIdRef.current, created.id);
    setComments((prev) => [...(prev ?? []), created]);
    setInput("");
  };

  const remove = async (cid: number) => {
    if (
      !(await confirmDialog("이 코멘트를 삭제할까요?", {
        title: "코멘트 삭제",
        tone: "danger",
        confirmText: "삭제",
      }))
    )
      return;
    const r = await fetch(`/api/candidates/${candidateId}/comments/${cid}`, {
      method: "DELETE",
    });
    if (r.ok) setComments((prev) => (prev ?? []).filter((c) => c.id !== cid));
  };

  const unread = (comments ?? []).reduce(
    (n, c) => (c.id > lastReadId && c.authorUserId !== me?.id ? n + 1 : n),
    0
  );

  return (
    <>
      <button
        type="button"
        data-tour="cand-discuss-btn"
        onClick={() => setOpen((o) => !o)}
        aria-pressed={open}
        title="면접관 토론 — 이 후보자에 대한 의견을 자유롭게"
        className={`relative shrink-0 whitespace-nowrap text-xs px-3 py-1.5 max-sm:py-2.5 rounded-md border transition-colors inline-flex items-center gap-1 ${
          open
            ? "bg-primary text-surface border-primary"
            : "bg-primary-soft text-primary-deep border-primary/30 hover:bg-primary-soft/70"
        }`}
      >
        <MessageSquare className="w-3.5 h-3.5" />
        토론
        {unread > 0 && (
          <span className="ml-0.5 min-w-[16px] h-4 px-1 rounded-full bg-danger text-surface text-[10px] font-semibold inline-flex items-center justify-center tabular-nums">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {/* 비모달 드로어 — 본문을 가리거나 어둡게 하지 않는다(컨테이너 pointer-events-none).
          본문은 계속 보고/클릭/스크롤 가능하고, 패널만 테두리+그림자로 구분된다.
          항상 마운트해 두고 translate 로 오른쪽에서 슬라이드 인/아웃. */}
      <div
        className="fixed inset-0 z-50 flex justify-end pointer-events-none"
        aria-hidden={!open}
      >
        <div
          ref={drawerRef}
          className={`bg-card w-full sm:max-w-[420px] h-full flex flex-col border-l border-border-default shadow-2xl transition-transform duration-300 ease-out motion-reduce:transition-none ${
            open
              ? "translate-x-0 pointer-events-auto"
              : "translate-x-full pointer-events-none"
          }`}
        >
          <div
            data-tour="cand-discuss-panel"
            className="flex items-center gap-2 px-4 py-3 border-b border-border-default bg-surface-alt/50 shrink-0"
          >
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" aria-hidden />
            <span className="text-sm font-bold text-ink">면접관 토론</span>
            <span className="text-[11px] text-ink-muted">실시간</span>
            <button
              data-tour="cand-discuss-close"
              onClick={() => setOpen(false)}
              className="ml-auto text-ink-muted hover:text-ink-soft text-lg leading-none"
              aria-label="닫기"
            >
              ✕
            </button>
          </div>

          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto bg-surface px-4 py-4 flex flex-col gap-4"
          >
            {comments == null ? (
              <div className="text-sm text-ink-muted text-center py-6">
                불러오는 중...
              </div>
            ) : comments.length === 0 ? (
              <div className="text-sm text-ink-muted text-center py-10 leading-relaxed">
                아직 코멘트가 없습니다.
                <br />이 후보자에 대한 의견을 자유롭게 남겨보세요.
              </div>
            ) : (
              comments.map((c) => {
                const mine = me?.id === c.authorUserId;
                const name = c.authorName ?? `User #${c.authorUserId}`;
                if (mine) {
                  return (
                    <div key={c.id} className="flex flex-col items-end chat-bubble-in">
                      <div className="flex items-center gap-1.5 mb-1 pr-1">
                        <span className="text-[11px] text-ink-muted">
                          {formatKstDateTime(c.createdAt)}
                        </span>
                        <button
                          onClick={() => remove(c.id)}
                          className="text-[11px] text-ink-muted hover:text-danger"
                        >
                          삭제
                        </button>
                      </div>
                      <div className="max-w-[85%] bg-primary text-surface rounded-2xl rounded-tr-md px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words shadow-sm">
                        {c.body}
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={c.id} className="flex items-start gap-2.5 chat-bubble-in">
                    <div className="w-8 h-8 rounded-full bg-surface-alt border border-border-default flex items-center justify-center shrink-0 text-xs font-bold text-ink-soft">
                      {name.trim().charAt(0) || "?"}
                    </div>
                    <div className="flex flex-col items-start min-w-0 max-w-[85%]">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-bold text-ink">{name}</span>
                        <span className="text-[11px] text-ink-muted">
                          {formatKstDateTime(c.createdAt)}
                        </span>
                      </div>
                      <div className="bg-card border border-border-default text-ink rounded-2xl rounded-tl-md px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words shadow-sm">
                        {c.body}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="border-t border-border-default bg-card p-3 shrink-0">
            {err && (
              <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2 mb-2">
                {err}
              </div>
            )}
            <div className="flex items-end gap-2 rounded-2xl border border-border-default bg-surface px-2 py-1.5 transition-colors focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={1}
                maxLength={5000}
                placeholder="코멘트 입력…"
                className="flex-1 resize-none bg-transparent border-0 focus:outline-none focus:ring-0 px-2 py-1.5 text-sm leading-relaxed max-h-32 placeholder:text-ink-muted"
              />
              <button
                onClick={() => void send()}
                disabled={busy || !input.trim()}
                aria-label="전송"
                title="전송 (Enter)"
                className="shrink-0 w-9 h-9 rounded-full bg-primary hover:bg-primary-deep text-surface flex items-center justify-center disabled:opacity-40 disabled:hover:bg-primary transition-colors"
              >
                <Send className="w-4 h-4" strokeWidth={2.5} />
              </button>
            </div>
            <div className="mt-1.5 px-1 text-[11px] text-ink-muted">
              Enter 전송 · Shift+Enter 줄바꿈
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
