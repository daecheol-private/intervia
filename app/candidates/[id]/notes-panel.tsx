"use client";

import { useEffect, useState } from "react";
import { formatKstDateTime } from "@/lib/utils";
import { confirmDialog } from "@/app/components/Dialog";
import { scoreColor, Section } from "./shared";

type InterviewerNote = {
  id: number;
  candidateId: number;
  authorUserId: number;
  authorName: string | null;
  round: "round1" | "round2" | null;
  scores: {
    skill?: number | null;
    experience?: number | null;
    collaboration?: number | null;
    fit?: number | null;
  } | null;
  note: string;
  createdAt: string;
  updatedAt: string;
};

export function InterviewerNotesPanel({
  candidateId,
  currentStage,
}: {
  candidateId: number;
  currentStage: string;
}) {
  // 후보자 현재 단계에서 면접 차수 기본값 추론 (2차합격이면 2차, 그 외 1차).
  const defaultRound: "round1" | "round2" =
    currentStage === "round2_passed" ? "round2" : "round1";
  const [me, setMe] = useState<{ id: number; name: string } | null>(null);
  const [list, setList] = useState<InterviewerNote[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [round, setRound] = useState<"round1" | "round2">(defaultRound);
  const [skill, setSkill] = useState("");
  const [experience, setExperience] = useState("");
  const [collaboration, setCollaboration] = useState("");
  const [fit, setFit] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");

  // 인라인 수정 — editingId 인 메모만 폼으로 전환.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [eSkill, setESkill] = useState("");
  const [eExperience, setEExperience] = useState("");
  const [eCollaboration, setECollaboration] = useState("");
  const [eFit, setEFit] = useState("");
  const [eNote, setENote] = useState("");
  const [eErr, setEErr] = useState("");

  const load = async () => {
    const [meR, listR] = await Promise.all([
      fetch("/api/auth/status").then((r) => r.json()),
      fetch(`/api/candidates/${candidateId}/notes`).then((r) =>
        r.ok ? r.json() : null
      ),
    ]);
    setMe(meR?.user ?? null);
    if (listR) setList(listR);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateId]);

  const parseScore = (s: string): number | undefined => {
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : undefined;
  };

  const submit = async () => {
    setBusy(true);
    setErr("");
    const r = await fetch(`/api/candidates/${candidateId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        round,
        scores: {
          skill: parseScore(skill),
          experience: parseScore(experience),
          collaboration: parseScore(collaboration),
          fit: parseScore(fit),
        },
        note,
      }),
    });
    setBusy(false);
    if (!r.ok) {
      setErr(await r.text());
      return;
    }
    setRound(defaultRound);
    setSkill("");
    setExperience("");
    setCollaboration("");
    setFit("");
    setNote("");
    setShowForm(false);
    void load();
  };

  const remove = async (nid: number) => {
    if (
      !(await confirmDialog("이 메모를 삭제할까요?", {
        title: "메모 삭제",
        tone: "danger",
        confirmText: "삭제",
      }))
    )
      return;
    setBusy(true);
    const r = await fetch(`/api/candidates/${candidateId}/notes/${nid}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (r.ok) void load();
  };

  const startEdit = (n: InterviewerNote) => {
    setEditingId(n.id);
    setESkill(n.scores?.skill != null ? String(n.scores.skill) : "");
    setEExperience(
      n.scores?.experience != null ? String(n.scores.experience) : ""
    );
    setECollaboration(
      n.scores?.collaboration != null ? String(n.scores.collaboration) : ""
    );
    setEFit(n.scores?.fit != null ? String(n.scores.fit) : "");
    setENote(n.note ?? "");
    setEErr("");
  };

  const saveEdit = async (nid: number) => {
    setBusy(true);
    setEErr("");
    const r = await fetch(`/api/candidates/${candidateId}/notes/${nid}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scores: {
          skill: parseScore(eSkill),
          experience: parseScore(eExperience),
          collaboration: parseScore(eCollaboration),
          fit: parseScore(eFit),
        },
        note: eNote,
      }),
    });
    setBusy(false);
    if (!r.ok) {
      setEErr(await r.text());
      return;
    }
    setEditingId(null);
    void load();
  };

  const avg = (n: InterviewerNote): number | null => {
    const s = n.scores;
    if (!s) return null;
    const vals = [s.skill, s.experience, s.collaboration, s.fit].filter(
      (v): v is number => typeof v === "number"
    );
    if (vals.length === 0) return null;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  };

  const noteSummary = (() => {
    if (list == null) return <span className="text-ink-muted">불러오는 중...</span>;
    if (list.length === 0) return <span className="text-ink-muted">작성된 메모 없음</span>;
    const avgs = list.map(avg).filter((v): v is number => v != null);
    const overallAvg =
      avgs.length > 0
        ? Math.round(avgs.reduce((a, b) => a + b, 0) / avgs.length)
        : null;
    const authors = new Set(list.map((n) => n.authorUserId));
    const r1 = list.filter((n) => n.round === "round1").length;
    const r2 = list.filter((n) => n.round === "round2").length;
    return (
      <span className="flex items-center gap-2">
        <span className="text-ink-soft">{list.length}건</span>
        {r2 > 0 && (
          <span className="text-ink-muted">· 1차 {r1} · 2차 {r2}</span>
        )}
        <span className="text-ink-muted">· {authors.size}명 작성</span>
        {overallAvg != null && (
          <>
            <span className="text-ink-muted">· 평균</span>
            <span className={`font-bold tabular-nums ${scoreColor(overallAvg)}`}>
              {overallAvg}
            </span>
            <span className="text-ink-muted">/100</span>
          </>
        )}
      </span>
    );
  })();

  return (
    <Section title="면접관 메모 / 스코어카드" summary={noteSummary} collapsible={false}>
      <div className="flex justify-between items-center mb-3">
        <div className="text-xs text-ink-muted">
          같은 법인 멤버 누구나 자기 메모를 작성할 수 있습니다. 본인 메모만
          수정·삭제 가능.
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="text-xs px-3 py-1.5 rounded-md bg-primary hover:bg-primary-deep text-surface font-medium shrink-0"
          >
            + 메모 작성
          </button>
        )}
      </div>

      {showForm && (
        <div className="bg-primary-soft border border-primary/30 rounded-xl p-4 mb-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-muted">면접 차수</span>
            <div className="inline-flex rounded-lg border border-border-strong overflow-hidden text-xs">
              {(["round1", "round2"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRound(r)}
                  className={`px-3 py-1.5 font-medium ${
                    round === r
                      ? "bg-primary text-surface"
                      : "bg-card text-ink-soft hover:bg-surface-alt"
                  }`}
                >
                  {r === "round1" ? "1차" : "2차"}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <ScoreInput label="기술역량" value={skill} onChange={setSkill} />
            <ScoreInput
              label="실무경험"
              value={experience}
              onChange={setExperience}
            />
            <ScoreInput
              label="협업"
              value={collaboration}
              onChange={setCollaboration}
            />
            <ScoreInput label="직무적합성" value={fit} onChange={setFit} />
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="자유 메모 (5000자 이내)"
            className="w-full border border-border-strong rounded-lg px-3 py-2 text-sm"
          />
          {err && (
            <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2">
              {err}
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={submit}
              disabled={busy}
              className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-surface text-sm font-medium disabled:opacity-50"
            >
              {busy ? "저장 중..." : "저장"}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 rounded-lg border border-border-strong text-ink-soft hover:bg-surface-alt text-sm"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {!list ? (
        <div className="text-sm text-ink-muted">불러오는 중...</div>
      ) : list.length === 0 ? (
        <div className="text-sm text-ink-muted text-center py-6">
          작성된 메모가 없습니다.
        </div>
      ) : (
        <ul className="space-y-3">
          {list.map((n) => {
            const a = avg(n);
            const isMine = me?.id === n.authorUserId;
            return (
              <li
                key={n.id}
                className="bg-card border border-border-default rounded-xl p-4"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  {n.round && (
                    <span
                      className={`text-[11px] px-1.5 py-0.5 rounded font-semibold ${
                        n.round === "round2"
                          ? "bg-surface-alt text-ink-soft"
                          : "bg-surface-alt text-ink-soft"
                      }`}
                    >
                      {n.round === "round2" ? "2차" : "1차"}
                    </span>
                  )}
                  <span className="text-sm font-semibold text-ink">
                    {n.authorName ?? `User #${n.authorUserId}`}
                  </span>
                  {a != null && (
                    <span className="text-xs px-2 py-0.5 rounded-md bg-primary-soft text-primary-deep font-medium">
                      평균 {a}
                    </span>
                  )}
                  <span className="text-[11px] text-ink-muted">
                    {formatKstDateTime(n.createdAt)}
                  </span>
                  {n.updatedAt !== n.createdAt && (
                    <span className="text-[11px] text-ink-muted">(수정됨)</span>
                  )}
                  {isMine && editingId !== n.id && (
                    <div className="ml-auto flex items-center gap-2">
                      <button
                        onClick={() => startEdit(n)}
                        className="text-[11px] text-primary hover:underline"
                      >
                        수정
                      </button>
                      <button
                        onClick={() => remove(n.id)}
                        className="text-[11px] text-danger hover:underline"
                      >
                        삭제
                      </button>
                    </div>
                  )}
                </div>
                {editingId === n.id ? (
                  <div className="mt-3 space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <ScoreInput label="기술역량" value={eSkill} onChange={setESkill} />
                      <ScoreInput
                        label="실무경험"
                        value={eExperience}
                        onChange={setEExperience}
                      />
                      <ScoreInput
                        label="협업"
                        value={eCollaboration}
                        onChange={setECollaboration}
                      />
                      <ScoreInput label="직무적합성" value={eFit} onChange={setEFit} />
                    </div>
                    <textarea
                      value={eNote}
                      onChange={(e) => setENote(e.target.value)}
                      rows={3}
                      placeholder="자유 메모 (5000자 이내)"
                      className="w-full border border-border-strong rounded-lg px-3 py-2 text-sm"
                    />
                    {eErr && (
                      <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2">
                        {eErr}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={() => saveEdit(n.id)}
                        disabled={busy}
                        className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-surface text-sm font-medium disabled:opacity-50"
                      >
                        {busy ? "저장 중..." : "저장"}
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="px-4 py-2 rounded-lg border border-border-strong text-ink-soft hover:bg-surface-alt text-sm"
                      >
                        취소
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {n.scores && (
                      <div className="grid grid-cols-4 gap-2 mt-2 text-center text-xs">
                        <ScoreCell label="기술" value={n.scores.skill} />
                        <ScoreCell label="경험" value={n.scores.experience} />
                        <ScoreCell label="협업" value={n.scores.collaboration} />
                        <ScoreCell label="적합" value={n.scores.fit} />
                      </div>
                    )}
                    {n.note && (
                      <p className="mt-2 text-sm text-ink-soft whitespace-pre-wrap leading-relaxed">
                        {n.note}
                      </p>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function ScoreInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-[11px] text-ink-soft mb-1">{label}</label>
      <input
        type="number"
        min={0}
        max={100}
        value={value}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") {
            onChange("");
            return;
          }
          // 숫자만 허용 + 0~100 범위로 제한 (직접 타이핑한 범위 밖 값 차단)
          const n = Math.floor(Number(raw));
          if (!Number.isFinite(n)) return;
          onChange(String(Math.max(0, Math.min(100, n))));
        }}
        placeholder="0~100"
        className="w-full border border-border-strong rounded-lg px-2 py-1.5 text-sm"
      />
    </div>
  );
}

function ScoreCell({
  label,
  value,
}: {
  label: string;
  value: number | null | undefined;
}) {
  return (
    <div className="bg-surface-alt rounded-md py-1.5">
      <div className="text-[10px] text-ink-muted">{label}</div>
      <div className="text-sm font-semibold text-ink">
        {typeof value === "number" ? value : "-"}
      </div>
    </div>
  );
}
