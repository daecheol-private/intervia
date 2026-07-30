"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Plus, X, Users } from "lucide-react";
import { Input } from "@/app/components/ui";

export type ShareRecipient = {
  email: string;
  name?: string;
  userId?: number;
  /** 확정 안내 메일에 평가 리포트 공유 링크를 함께 보낼지 (서버가 링크 발급). */
  report?: boolean;
};

/** 서버(lib/schedule-share.ts)와 동일한 상한 — 초과 시 API 가 400 을 준다. */
const MAX_RECIPIENTS = 10;

type Member = { id: number; name: string; email: string };

/**
 * 일정 공유 수신자 선택 (접힘/펼침) — 면접관이 아닌 사람에게도 확정·변경·취소를 알린다.
 *
 * 두 입력 경로:
 *  1) 법인 멤버 체크 — 이미 면접관인 사람은 확정 메일을 이미 받으므로 목록에서 제외.
 *     멤버 목록 조회는 org_admin 이상만 가능(403) → 일반 멤버에겐 이 섹션을 숨긴다.
 *  2) 이메일 직접 입력 — Intervia 계정이 없는 임원·외부 담당자용.
 */
export function ShareRecipientPicker({
  jobId,
  value,
  onChange,
}: {
  jobId: number;
  value: ShareRecipient[];
  onChange: (next: ShareRecipient[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [canPickMembers, setCanPickMembers] = useState(true);
  const [emailInput, setEmailInput] = useState("");
  const [err, setErr] = useState("");

  // 면접관은 확정 메일을 이미 받으므로 후보 목록에서 뺀다.
  useEffect(() => {
    let alive = true;
    void Promise.all([
      fetch("/api/orgs/members").then((r) =>
        r.ok ? r.json() : Promise.resolve(null)
      ),
      fetch(`/api/jobs/${jobId}/interviewers`).then((r) =>
        r.ok ? r.json() : Promise.resolve({ interviewers: [] })
      ),
    ])
      .then(([memberData, interviewerData]) => {
        if (!alive) return;
        if (!memberData) {
          setCanPickMembers(false);
          return;
        }
        const raw = Array.isArray(memberData)
          ? memberData
          : (memberData.members ?? []);
        const interviewerIds = new Set(
          (
            (interviewerData?.interviewers ?? []) as { userId: number }[]
          ).map((r) => r.userId)
        );
        setMembers(
          // 가입 대기(pending)·비활성 계정은 제외 — 실제로 메일을 받을 사람만.
          (raw as Array<Member & { status?: string }>)
            .filter((m) => m.email && m.status === "active")
            .filter((m) => !interviewerIds.has(m.id))
            .map((m) => ({ id: m.id, name: m.name, email: m.email }))
        );
      })
      .catch(() => {
        if (alive) setCanPickMembers(false);
      });
    return () => {
      alive = false;
    };
  }, [jobId]);

  const has = (email: string) =>
    value.some((r) => r.email.toLowerCase() === email.toLowerCase());

  // 평가 리포트 공유는 수신자별 플래그지만 UI 는 전체 토글 하나 — 지금 화면에서
  // 사람마다 다르게 줄 이유가 없다. 나중에 갈라야 하면 데이터는 이미 수신자별이다.
  const reportOn = value.length > 0 && value.every((r) => r.report);

  const add = (r: ShareRecipient) => {
    if (has(r.email)) return;
    if (value.length >= MAX_RECIPIENTS) {
      setErr(`최대 ${MAX_RECIPIENTS}명까지 지정할 수 있습니다.`);
      return;
    }
    setErr("");
    // 이미 켜 둔 상태면 새로 추가되는 사람도 같은 조건으로 — every 판정이 흔들리지 않는다.
    onChange([
      ...value,
      { ...r, email: r.email.trim().toLowerCase(), report: reportOn || undefined },
    ]);
  };

  const remove = (email: string) => {
    setErr("");
    onChange(value.filter((r) => r.email.toLowerCase() !== email.toLowerCase()));
  };

  const addTyped = () => {
    const email = emailInput.trim().toLowerCase();
    if (!email) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      setErr("이메일 형식이 올바르지 않습니다.");
      return;
    }
    add({ email });
    setEmailInput("");
  };

  return (
    <div className="rounded-lg border border-border-default">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left"
      >
        <span className="flex items-center gap-1.5 text-xs font-medium text-ink-soft">
          <Users className="w-4 h-4" strokeWidth={2.25} />
          일정 공유받을 사람
          <span className="text-ink-muted font-normal">(선택)</span>
          {value.length > 0 && (
            <span className="ml-1 rounded-full bg-primary-soft text-primary-deep px-2 py-0.5 text-[11px] font-semibold">
              {value.length}
            </span>
          )}
          {/* 접힌 상태에서도 평가가 함께 나가는지는 보여야 한다. */}
          {value.some((r) => r.report) && (
            <span className="text-[11px] font-normal text-ink-muted">
              평가 포함
            </span>
          )}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-ink-muted transition-transform ${open ? "rotate-180" : ""}`}
          strokeWidth={2.25}
        />
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3 border-t border-border-default pt-3">
          <p className="text-[11px] text-ink-muted leading-relaxed">
            면접관이 아니어도 일정이 확정·변경·취소되면 안내를 받습니다. 회의실
            담당자나 Intervia 계정이 없는 임원에게 유용합니다.
          </p>

          {canPickMembers && members.length > 0 && (
            <div>
              <span className="text-[11px] font-semibold text-ink-soft block mb-1">
                법인 멤버
              </span>
              <div className="max-h-32 overflow-y-auto rounded-lg border border-border-default divide-y divide-border-default">
                {members.map((m) => {
                  const picked = has(m.email);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() =>
                        picked
                          ? remove(m.email)
                          : add({ email: m.email, name: m.name, userId: m.id })
                      }
                      className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 text-left text-xs ${
                        picked ? "bg-primary-soft" : "hover:bg-surface-alt"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="font-medium text-ink block truncate">
                          {m.name}
                        </span>
                        <span className="text-ink-muted block truncate">
                          {m.email}
                        </span>
                      </span>
                      {picked ? (
                        <X
                          className="w-3.5 h-3.5 text-primary-deep shrink-0"
                          strokeWidth={2.5}
                        />
                      ) : (
                        <Plus
                          className="w-3.5 h-3.5 text-ink-muted shrink-0"
                          strokeWidth={2.5}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <span className="text-[11px] font-semibold text-ink-soft block mb-1">
              이메일 직접 입력
            </span>
            <div className="flex gap-2">
              <Input
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTyped();
                  }
                }}
                placeholder="director@company.co.kr"
                className="py-1.5"
              />
              <button
                type="button"
                onClick={addTyped}
                className="shrink-0 px-3 rounded-lg border border-border-strong text-xs font-medium text-ink hover:bg-surface-alt"
              >
                추가
              </button>
            </div>
          </div>

          {value.length > 0 && (
            <label className="flex items-start gap-2 cursor-pointer rounded-lg border border-border-default bg-surface-alt px-3 py-2.5">
              <input
                type="checkbox"
                checked={reportOn}
                onChange={(e) =>
                  onChange(
                    value.map((r) => ({
                      ...r,
                      report: e.target.checked || undefined,
                    }))
                  )
                }
                className="mt-0.5"
              />
              <span className="text-xs text-ink-soft leading-relaxed">
                평가 리포트도 함께 공유
                <span className="block text-[11px] text-ink-muted mt-0.5">
                  일정 확정 안내 메일에 평가 결과 열람 링크가 포함됩니다. 서류·AI
                  면접·대면 면접의 평가 결론만 보이고 이력서 원본·연락처는
                  제외됩니다. 링크를 가진 사람은 누구나 열람할 수 있으니 주소를
                  확인해 주세요.
                </span>
              </span>
            </label>
          )}

          {value.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {value.map((r) => (
                <span
                  key={r.email}
                  className="inline-flex items-center gap-1 rounded-full bg-surface-alt border border-border-default px-2.5 py-1 text-[11px] text-ink"
                >
                  {r.name ? `${r.name} · ${r.email}` : r.email}
                  <button
                    type="button"
                    onClick={() => remove(r.email)}
                    className="text-ink-muted hover:text-danger leading-none"
                    title="제외"
                  >
                    <X className="w-3 h-3" strokeWidth={2.5} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {err && <p className="text-[11px] text-danger">{err}</p>}
        </div>
      )}
    </div>
  );
}
