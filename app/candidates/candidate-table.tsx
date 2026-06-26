"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Lock } from "lucide-react";
import { StageBadge, OutcomeBadge, RecBadge } from "@/app/jobs/[id]/badges";
import { STAGE_BUCKET, BUCKET_LABELS, type Bucket } from "@/lib/candidate-state";
import type { Stage } from "@/lib/stage-meta";
import { formatLocalDate } from "@/lib/utils";

/**
 * 후보자 통합 목록의 한 행 — 서버(page.tsx)가 스코프/잠금 마스킹을 끝낸 뒤 넘겨준다.
 * 잠긴 공고(locked)의 후보는 서버에서 이름·연락처·점수가 이미 비워져 온다(민감정보 미전송).
 */
export type CandidateRow = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  photoFilePath: string | null;
  careerYears: number | null;
  age: number | null;
  educationLevel: string | null;
  educationSchool: string | null;
  educationMajor: string | null;
  screeningScore: number | null;
  recommendation: string | null;
  stage: Stage;
  outcome: "hired" | "rejected" | "withdrawn" | null;
  createdAt: string;
  jobId: number;
  jobTitle: string;
  locked: boolean;
};

type SortKey = "recent" | "score" | "name";

// 필터 칩 순서 — 파이프라인 흐름과 동일.
const BUCKET_ORDER: Bucket[] = ["resume", "ai", "round1", "round2", "closed"];

export function CandidateTable({
  rows,
  jobs,
}: {
  rows: CandidateRow[];
  jobs: { id: number; title: string }[];
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [bucket, setBucket] = useState<Bucket | "all">("all");
  const [jobFilter, setJobFilter] = useState<number | "all">("all");
  const [sort, setSort] = useState<SortKey>("recent");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const out = rows.filter((r) => {
      if (bucket !== "all" && STAGE_BUCKET[r.stage] !== bucket) return false;
      if (jobFilter !== "all" && r.jobId !== jobFilter) return false;
      if (term) {
        // 잠긴 후보는 이름이 비공개라 검색 대상에서 제외.
        if (r.locked) return false;
        const hay = [r.name, r.email ?? "", r.phone ?? ""]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
    out.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name, "ko");
      if (sort === "score")
        return (b.screeningScore ?? -1) - (a.screeningScore ?? -1);
      return b.createdAt.localeCompare(a.createdAt); // recent
    });
    return out;
  }, [rows, q, bucket, jobFilter, sort]);

  const goTo = (r: CandidateRow) =>
    router.push(r.locked ? `/jobs/${r.jobId}` : `/candidates/${r.id}`);

  return (
    <div>
      {/* 컨트롤 바 — 검색 / 단계 버킷 / 공고 / 정렬 */}
      <div className="flex flex-col gap-3 mb-4">
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted pointer-events-none" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="이름 · 이메일 · 전화로 검색"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border-default bg-card text-ink placeholder:text-ink-muted focus:outline-none focus:border-primary/50"
            />
          </div>
          <div className="flex gap-2 shrink-0">
            <select
              value={jobFilter}
              onChange={(e) =>
                setJobFilter(
                  e.target.value === "all" ? "all" : Number(e.target.value)
                )
              }
              className="px-2.5 py-2 text-sm rounded-lg border border-border-default bg-card text-ink-soft focus:outline-none focus:border-primary/50 max-w-[180px]"
            >
              <option value="all">전체 공고</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.title}
                </option>
              ))}
            </select>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="px-2.5 py-2 text-sm rounded-lg border border-border-default bg-card text-ink-soft focus:outline-none focus:border-primary/50"
            >
              <option value="recent">최신 등록순</option>
              <option value="score">서류 점수순</option>
              <option value="name">이름순</option>
            </select>
          </div>
        </div>

        {/* 단계 버킷 필터 칩 */}
        <div className="flex flex-wrap gap-1.5">
          <Chip active={bucket === "all"} onClick={() => setBucket("all")}>
            전체
          </Chip>
          {BUCKET_ORDER.map((b) => (
            <Chip key={b} active={bucket === b} onClick={() => setBucket(b)}>
              {BUCKET_LABELS[b]}
            </Chip>
          ))}
        </div>
      </div>

      <div className="text-xs text-ink-soft mb-2">
        {filtered.length}명
        {filtered.length !== rows.length && ` (전체 ${rows.length}명)`}
      </div>

      {/* 테이블 */}
      {filtered.length === 0 ? (
        <div className="bg-card border border-dashed border-border-strong rounded-2xl py-12 text-center text-sm text-ink-soft">
          {rows.length === 0
            ? "표시할 후보자가 없습니다."
            : "조건에 맞는 후보자가 없습니다."}
        </div>
      ) : (
        <div className="bg-card border border-border-default rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-default text-[11px] font-medium text-ink-muted uppercase tracking-wider">
                  <th className="text-left font-medium px-4 py-2.5">후보자</th>
                  <th className="text-left font-medium px-3 py-2.5 hidden sm:table-cell">
                    공고
                  </th>
                  <th className="text-left font-medium px-3 py-2.5">단계</th>
                  <th className="text-center font-medium px-3 py-2.5 hidden sm:table-cell">
                    서류 점수
                  </th>
                  <th className="text-right font-medium px-4 py-2.5 hidden md:table-cell">
                    등록일
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => goTo(r)}
                    className="border-b border-border-default last:border-0 hover:bg-surface-alt/50 transition-colors cursor-pointer"
                  >
                    {/* 후보자 — 썸네일 + 이름 + 연락처/학력 */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar
                          id={r.id}
                          name={r.name}
                          hasPhoto={!!r.photoFilePath}
                          locked={r.locked}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            {r.locked && (
                              <Lock className="w-3.5 h-3.5 text-ink-muted shrink-0" />
                            )}
                            <span className="font-medium text-ink truncate">
                              {r.name}
                            </span>
                          </div>
                          <div className="text-[11px] text-ink-muted truncate mt-0.5">
                            {r.locked ? (
                              <span className="sm:hidden">비공개 공고</span>
                            ) : (
                              <>
                                {[
                                  r.careerYears != null
                                    ? `경력 ${r.careerYears}년`
                                    : null,
                                  r.educationSchool,
                                  r.email,
                                ]
                                  .filter(Boolean)
                                  .join(" · ") || "—"}
                                <span className="sm:hidden">
                                  {" · "}
                                  {r.jobTitle}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    {/* 공고 */}
                    <td className="px-3 py-3 hidden sm:table-cell">
                      <span className="text-ink-soft truncate block max-w-[200px]">
                        {r.jobTitle}
                      </span>
                    </td>
                    {/* 단계 / 결과 */}
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap items-center gap-1">
                        {r.outcome !== "hired" && <StageBadge stage={r.stage} />}
                        {r.outcome && <OutcomeBadge outcome={r.outcome} />}
                      </div>
                    </td>
                    {/* 서류 점수 + 추천 */}
                    <td className="px-3 py-3 hidden sm:table-cell">
                      <div className="flex items-center justify-center gap-1.5">
                        {r.screeningScore != null ? (
                          <span className="font-semibold text-ink tabular-nums">
                            {r.screeningScore}
                          </span>
                        ) : (
                          <span className="text-ink-muted">—</span>
                        )}
                        {r.recommendation && (
                          <RecBadge rec={r.recommendation} />
                        )}
                      </div>
                    </td>
                    {/* 등록일 */}
                    <td className="px-4 py-3 text-right text-[11px] text-ink-soft hidden md:table-cell tabular-nums">
                      {formatLocalDate(r.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "text-xs px-3 py-1.5 rounded-full border transition-colors " +
        (active
          ? "bg-primary text-surface border-primary font-medium"
          : "bg-card text-ink-soft border-border-default hover:bg-surface-alt")
      }
    >
      {children}
    </button>
  );
}

/** 증명사진 썸네일 — 있으면 이미지, 로드 실패·없음·잠금이면 이니셜로 폴백. */
function Avatar({
  id,
  name,
  hasPhoto,
  locked,
}: {
  id: number;
  name: string;
  hasPhoto: boolean;
  locked: boolean;
}) {
  const initial = locked ? "🔒" : name.trim().charAt(0).toUpperCase() || "?";
  return (
    <div className="shrink-0 relative w-9 h-9">
      {hasPhoto && !locked && (
        <img
          src={`/api/uploads/candidate/${id}/photo`}
          alt=""
          aria-hidden
          className="w-9 h-9 rounded-full object-cover bg-surface-alt absolute inset-0"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      )}
      <div className="w-9 h-9 rounded-full bg-surface-alt text-ink-soft flex items-center justify-center text-sm font-bold">
        {initial}
      </div>
    </div>
  );
}
