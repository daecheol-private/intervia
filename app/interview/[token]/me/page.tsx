"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { formatLocalDateTime } from "@/lib/utils";

const STAGE_LABEL_KO: Record<string, string> = {
  applied: "지원 접수",
  screened: "서류평가 완료",
  ai_pending: "AI면접 대기",
  ai_evaluated: "AI면접 완료",
  round1_candidate: "1차 면접 후보",
  round1_scheduling: "1차 면접 일정 조율",
  round1_waiting: "1차 면접 예정",
  round1_passed: "1차 합격",
  round2_passed: "2차 합격",
};

type SelfData = {
  name: string;
  email: string | null;
  phone: string | null;
  age: number | null;
  careerYears: number | null;
  careerSummary: string | null;
  resumeStored: boolean;
  maskedTextLength: number;
  screeningScore: number | null;
  screeningRecommendation: string | null;
  stage: string;
  outcome: "hired" | "rejected" | "withdrawn" | null;
  createdAt: string;
};

export default function SelfPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [email, setEmail] = useState("");
  const [data, setData] = useState<SelfData | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [deleted, setDeleted] = useState(false);

  const load = async () => {
    setErr("");
    setBusy(true);
    const r = await fetch(`/api/interview/${token}/me`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setBusy(false);
    if (!r.ok) {
      setErr(await r.text());
      return;
    }
    setData(await r.json());
  };

  const remove = async () => {
    if (
      !confirm(
        "내 이력서·연락처 등 본문 데이터를 즉시 폐기합니다. 평가 결과(점수)는 공고 종결 +14일 후 자동 삭제됩니다. 계속할까요?"
      )
    )
      return;
    setBusy(true);
    const r = await fetch(`/api/interview/${token}/me`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setBusy(false);
    if (!r.ok) {
      setErr(await r.text());
      return;
    }
    setDeleted(true);
    setData(null);
  };

  if (deleted) {
    return (
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center max-w-md shadow-sm">
          <div className="text-4xl mb-3">🗑️</div>
          <h1 className="text-xl font-bold text-slate-900">폐기 완료</h1>
          <p className="text-sm text-slate-600 mt-3 leading-relaxed">
            본문 데이터가 즉시 폐기되었습니다. 평가 결과는 공고 종결 +14일 후
            자동 삭제됩니다 (처리방침 §3).
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-2xl mx-auto w-full px-6 py-10">
      <h1 className="text-2xl font-bold text-slate-900">내 정보 열람·삭제</h1>
      <p className="text-sm text-slate-600 mt-2 leading-relaxed">
        개인정보 보호법 제35조(열람), 제36조(정정·삭제) 에 따라 본인의 데이터를
        조회하고 폐기를 요청하실 수 있습니다. 본인 확인을 위해 면접 안내 메일을
        받으신 이메일을 입력해 주세요.
      </p>

      <div className="mt-6 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            본인 이메일
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="you@example.com"
          />
        </div>

        {err && (
          <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2">
            {err}
          </div>
        )}

        {!data ? (
          <button
            onClick={load}
            disabled={busy || !email}
            className="px-5 py-2.5 rounded-lg bg-primary hover:bg-primary-deep text-white text-sm font-medium disabled:opacity-50"
          >
            {busy ? "조회 중..." : "내 정보 조회"}
          </button>
        ) : (
          <>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm">
              <Row label="이름" value={data.name} />
              <Row label="이메일" value={data.email ?? "(없음)"} />
              <Row label="전화" value={data.phone ?? "(없음)"} />
              <Row label="나이" value={data.age ? `${data.age}세` : "(없음)"} />
              <Row
                label="경력"
                value={
                  data.careerYears != null
                    ? `${data.careerYears}년`
                    : data.careerSummary ?? "(없음)"
                }
              />
              <Row
                label="이력서 파일"
                value={data.resumeStored ? "보유 중" : "없음/폐기됨"}
              />
              <Row
                label="마스킹 본문"
                value={
                  data.maskedTextLength > 0
                    ? `${data.maskedTextLength.toLocaleString()}자`
                    : "없음"
                }
              />
              <Row
                label="서류 평가 점수"
                value={
                  data.screeningScore != null
                    ? `${data.screeningScore} (${data.screeningRecommendation})`
                    : "미평가"
                }
              />
              <Row
                label="진행 상태"
                value={
                  data.outcome === "hired"
                    ? "최종합격"
                    : data.outcome === "rejected"
                    ? "불합격"
                    : data.outcome === "withdrawn"
                    ? "지원취소"
                    : STAGE_LABEL_KO[data.stage] ?? data.stage
                }
              />
              <Row
                label="접수일"
                value={formatLocalDateTime(data.createdAt, { format: { second: "2-digit" } })}
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={remove}
                disabled={busy}
                className="px-4 py-2.5 rounded-lg bg-danger hover:bg-danger/85 text-surface text-sm font-medium disabled:opacity-50 transition-colors"
              >
                {busy ? "처리 중..." : "본문 데이터 즉시 폐기"}
              </button>
              <Link
                href="/privacy"
                target="_blank"
                className="px-4 py-2.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm"
              >
                처리방침
              </Link>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              폐기 시 이력서 본문·파일·전화번호가 즉시 삭제됩니다. 이름·이메일·평가
              점수는 공고 종결 +14일 후 자동 삭제됩니다 (처리방침 §3).
            </p>
          </>
        )}
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-slate-100 last:border-b-0">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-900 font-medium">{value ?? "-"}</span>
    </div>
  );
}
