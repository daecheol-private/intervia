"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { upload } from "@vercel/blob/client";
import { FavoriteStar } from "@/app/components/FavoriteStar";
import { CandidateFavoriteStar } from "@/app/components/CandidateFavoriteStar";
import { SlotCalendarPicker } from "@/app/components/SlotCalendarPicker";
import Link from "next/link";
import { compositeScore, formatKstDateTime, formatLocalDate } from "@/lib/utils";
import {
  STAGE_META as STAGE_META_SHARED,
  STAGE_RANK as STAGE_RANK_SHARED,
  STAGE_WAITER,
} from "@/lib/stage-meta";

type Job = {
  id: number;
  title: string;
  position: string;
  level: string;
  employmentType: string;
  tone: string;
  interviewDurationMinutes: number;
  createdAt: string;
  status?: "active" | "closed";
  publishedAt?: string;
  closesAt?: string;
  closedAt?: string | null;
  extensionCount?: number;
  favorited?: boolean;
};

type Candidate = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  age: number | null;
  careerYears: number | null;
  careerSummary: string | null;
  resumeFilePath: string;
  screeningScore: number | null;
  screeningReport: {
    score: number;
    recommendation: string;
    summary: string;
    strengths: string[];
    concerns: string[];
    matched_keywords: string[];
  } | null;
  stage:
    | "applied"
    | "screened"
    | "ai_pending"
    | "ai_evaluated"
    | "round1_candidate"
    | "round1_scheduling"
    | "round1_waiting"
    | "round1_passed"
    | "round2_passed"
    | "hired"
    | "rejected"
    | "withdrawn";
  outcome: "hired" | "rejected" | "withdrawn" | null;
  outcomeReason: string | null;
  createdAt: string;
  latestInterviewStatus: "pending" | "in_progress" | "completed" | "expired" | null;
  latestInterviewScore: number | null;
  latestInterviewRecommendation: string | null;
  queueStatus: "queued" | "processing" | null;
  queuePosition: number | null;
  queueAttempts: number;
  lastError: string | null;
  lastJobStatus: "queued" | "processing" | "done" | "failed" | null;
  favorited: boolean;
};

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const jobId = params.id;
  const [job, setJob] = useState<Job | null>(null);
  const [candidatesList, setCandidatesList] = useState<Candidate[]>([]);
  const [uploading, setUploading] = useState(false);
  const [tab, setTab] = useState<"all" | "screened" | "interviewed">("all");
  const [dragOver, setDragOver] = useState(false);
  const [locked, setLocked] = useState<{ title: string } | null>(null);
  const [loadError, setLoadError] = useState<"not_found" | "failed" | null>(null);
  const [search, setSearch] = useState("");
  // URL ?stage=screened 로 진입 시 초기 필터 적용. "all" 은 미지정.
  const [stageFilter, setStageFilter] = useState<Candidate["stage"] | "all">(
    () => {
      const s = searchParams.get("stage");
      if (!s) return "all";
      return s as Candidate["stage"];
    }
  );
  // outcome 필터: "all"=모두, "in_progress"=진행중(outcome null), 또는 특정 outcome 값
  const [outcomeFilter, setOutcomeFilter] = useState<
    "all" | "in_progress" | "hired" | "rejected" | "withdrawn"
  >("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [decideIds, setDecideIds] = useState<number[] | null>(null);
  // 채용기업이 "지원자가 AI 평가 적용에 동의했음" 을 확인했는가.
  // 미체크 시 업로드 차단 (서버도 게이트 — PIPA 책임 전가 메커니즘).
  // 공고 단위 DB 영구 저장 — job.applicantConsentConfirmedAt 으로 부터 복원.
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [consentBusy, setConsentBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const loadJob = async () => {
    try {
      const r = await fetch(`/api/jobs/${jobId}`);
      if (r.status === 403) {
        const data = await r.json();
        setLocked({ title: data.title ?? "공고" });
        setJob(null);
        setLoadError(null);
        return;
      }
      if (r.status === 404) {
        setLoadError("not_found");
        return;
      }
      if (!r.ok) {
        setLoadError("failed");
        return;
      }
      setLocked(null);
      setLoadError(null);
      const j = (await r.json()) as Job & { applicantConsentConfirmedAt?: string | null };
      setJob(j);
      setConsentConfirmed(!!j.applicantConsentConfirmedAt);
    } catch {
      setLoadError("failed");
    }
  };
  const [funnelKey, setFunnelKey] = useState(0);
  const loadCandidates = async () => {
    const r = await fetch(`/api/jobs/${jobId}/candidates`);
    if (!r.ok) return;
    setCandidatesList(await r.json());
    // 후보자 목록이 갱신되면 깔때기도 갱신 (stage 변경·삭제·신규 업로드 모두 커버)
    setFunnelKey((k) => k + 1);
  };

  useEffect(() => {
    void loadJob();
    void loadCandidates();
    const t = setInterval(() => {
      if (!locked) void loadCandidates();
    }, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, locked]);

  // 드래그된 폴더 안의 모든 파일을 재귀 수집 (HTML5 webkitGetAsEntry).
  // 각 파일에 폴더 경로를 보존해서 서버 그룹화에 활용.
  const collectFromItems = async (
    items: DataTransferItemList
  ): Promise<{ file: File; relativePath: string }[]> => {
    const out: { file: File; relativePath: string }[] = [];
    const tasks: Promise<void>[] = [];
    const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
      if (entry.isFile) {
        const fe = entry as FileSystemFileEntry;
        const f: File = await new Promise((resolve, reject) =>
          fe.file(resolve, reject)
        );
        out.push({
          file: f,
          relativePath: prefix ? `${prefix}/${f.name}` : f.name,
        });
      } else if (entry.isDirectory) {
        const de = entry as FileSystemDirectoryEntry;
        const reader = de.createReader();
        // readEntries 는 한 번에 100개만 반환 — 모두 읽을 때까지 반복
        const readAll = async (): Promise<FileSystemEntry[]> => {
          const all: FileSystemEntry[] = [];
          // eslint-disable-next-line no-constant-condition
          while (true) {
            const batch: FileSystemEntry[] = await new Promise((resolve, reject) =>
              reader.readEntries(resolve, reject)
            );
            if (batch.length === 0) break;
            all.push(...batch);
          }
          return all;
        };
        const children = await readAll();
        for (const c of children) {
          await walk(c, prefix ? `${prefix}/${entry.name}` : entry.name);
        }
      }
    };
    for (const it of Array.from(items)) {
      if (it.kind !== "file") continue;
      const entry = it.webkitGetAsEntry?.();
      if (entry) tasks.push(walk(entry, ""));
    }
    await Promise.all(tasks);
    return out;
  };

  const onUploadFromItems = async (items: DataTransferItemList) => {
    const collected = await collectFromItems(items);
    if (collected.length === 0) return;
    await uploadAll(collected);
  };

  const onUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    await uploadAll(
      Array.from(files).map((f) => ({
        file: f,
        relativePath: f.webkitRelativePath || f.name,
      }))
    );
  };

  const uploadAll = async (
    entries: { file: File; relativePath: string }[]
  ) => {
    // 지원자 동의 확인 가드 — 서버에서도 게이트하지만 UX 위해 사전 차단
    if (!consentConfirmed) {
      alert(
        "AI 평가 적용 고지 확인이 필요합니다.\n\n이력서를 업로드하기 전, 지원자에게 'AI 평가 적용 + 거부 시 일반 절차 가능' 을 안내하셨는지 체크박스로 확인해 주세요.\n\n표준 안내 문구는 '자세히' 링크에서 확인할 수 있습니다."
      );
      return;
    }
    // 사전 크기 검증 — 서버 도달 전 차단
    const MB = 1024 * 1024;
    const MAX_ZIP = 100 * MB;
    const MAX_FILE = 100 * MB;
    const MAX_TOTAL = 100 * MB;

    const tooLarge: string[] = [];
    for (const { file, relativePath } of entries) {
      const isZip = relativePath.toLowerCase().endsWith(".zip");
      const limit = isZip ? MAX_ZIP : MAX_FILE;
      if (file.size > limit) {
        tooLarge.push(
          `· ${relativePath} (${formatMB(file.size)}) — ${isZip ? "ZIP 최대 100MB" : "파일 최대 100MB"} 초과`
        );
      }
    }
    if (tooLarge.length > 0) {
      alert(
        `⚠️ 다음 파일이 크기 제한을 초과해 업로드를 시작하지 않았습니다.\n\n${tooLarge.join("\n")}\n\n원본 ZIP/파일을 작게 분할하거나 압축률을 높여 다시 시도해 주세요.`
      );
      return;
    }
    const total = entries.reduce((s, e) => s + e.file.size, 0);
    if (total > MAX_TOTAL) {
      alert(
        `⚠️ 업로드 총 용량 ${formatMB(total)} 이 너무 큽니다 (한 번에 최대 ${formatMB(MAX_TOTAL)}).\n\n파일 수를 나눠 여러 번에 걸쳐 업로드해 주세요.`
      );
      return;
    }

    setUploading(true);
    // Vercel 서버 함수 본문 한도(4.5MB) 회피 — 브라우저에서 Vercel Blob 으로 직접 업로드 후
    // 서버에는 manifest(JSON) 만 전송. 100MB 까지 가능.
    // dev/blob 미설정 환경에서는 NEXT_PUBLIC_BLOB_CLIENT_UPLOAD!=1 → 기존 FormData 경로.
    const useBlobUpload = process.env.NEXT_PUBLIC_BLOB_CLIENT_UPLOAD === "1";
    const lines: string[] = [];
    try {
      let res: Response;
      if (useBlobUpload) {
        const blobs: { url: string; pathname: string; size: number }[] = [];
        for (const { file, relativePath } of entries) {
          // pathname 의 경로 구분자를 살려 서버가 relativePath 로 재구성 가능하게 함.
          // 한글/공백은 upload() 내부에서 인코딩.
          const result = await upload(relativePath, file, {
            access: "public",
            handleUploadUrl: "/api/blob/upload",
            clientPayload: JSON.stringify({ jobId }),
            multipart: file.size > 8 * 1024 * 1024,
          });
          blobs.push({
            url: result.url,
            pathname: relativePath,
            size: file.size,
          });
        }
        res = await fetch(`/api/jobs/${jobId}/candidates`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ blobs, applicantConsentConfirmed: true }),
        });
      } else {
        const fd = new FormData();
        for (const { file, relativePath } of entries) {
          fd.append("file", file, relativePath);
        }
        fd.append("applicantConsentConfirmed", "true");
        res = await fetch(`/api/jobs/${jobId}/candidates`, {
          method: "POST",
          body: fd,
        });
      }
      if (!res.ok) {
        let t = "";
        try {
          t = await res.text();
        } catch {
          /* body 읽기 실패 */
        }
        if (!t || !t.trim()) {
          if (res.status === 413)
            t = `파일이 너무 큽니다 (HTTP 413). 서버가 본문을 거부했습니다. 한 번에 총 100MB 이하로 시도해 주세요.`;
          else if (res.status === 504)
            t = `서버 응답 시간 초과 (HTTP 504). 파일이 너무 크거나 처리 시간이 길어 중단되었습니다.`;
          else if (res.status >= 500)
            t = `서버 내부 오류 (HTTP ${res.status}). 잠시 후 다시 시도해 주세요.`;
          else t = `요청이 거부되었습니다 (HTTP ${res.status}).`;
        }
        lines.push(`⚠️ ${t}`);
      } else {
        type R =
          | { ok: true; candidateId: number; name: string; attachments: number }
          | { ok: false; group: string; reason: string }
          | { skipped: true; group: string; reason: string };
        const data = (await res.json()) as {
          created: number;
          failed: number;
          skipped?: number;
          results: R[];
          skippedFiles?: { unsupported: string[]; tooLarge: string[] };
        };
        const okList = data.results.filter(
          (r): r is Extract<R, { ok: true }> => "ok" in r && r.ok
        );
        const failList = data.results.filter(
          (r): r is Extract<R, { ok: false }> => "ok" in r && !r.ok
        );
        const skipList = data.results.filter(
          (r): r is Extract<R, { skipped: true }> => "skipped" in r
        );
        if (okList.length > 0) {
          const withAtt = okList.filter((r) => r.attachments > 0).length;
          lines.push(
            `✅ ${okList.length}명 등록 완료${withAtt > 0 ? ` (그 중 ${withAtt}명은 첨부 파일 포함)` : ""}`
          );
        }
        if (failList.length > 0) {
          lines.push(`⚠️ ${failList.length}건 실패:`);
          for (const f of failList)
            lines.push(`  · ${f.group}: ${f.reason}`);
        }
        if (skipList.length > 0) {
          lines.push(
            `ℹ️ ${skipList.length}개 항목은 이력서 파일(PDF/DOCX)이 없어 건너뜀`
          );
        }
        const sf = data.skippedFiles;
        if (sf?.unsupported.length) {
          lines.push(
            `ℹ️ 지원 안 되는 형식 ${sf.unsupported.length}개 제외: ${sf.unsupported.slice(0, 3).join(", ")}${sf.unsupported.length > 3 ? " 외" : ""}`
          );
        }
        if (sf?.tooLarge.length) {
          lines.push(
            `ℹ️ 크기 초과 ${sf.tooLarge.length}개 제외: ${sf.tooLarge.slice(0, 3).join(", ")}${sf.tooLarge.length > 3 ? " 외" : ""}`
          );
        }
        if (
          okList.length === 0 &&
          failList.length === 0 &&
          skipList.length === 0
        ) {
          lines.push(
            `⚠️ 처리된 항목이 없습니다. ZIP 안에 PDF/DOCX 이력서가 있는지 확인해 주세요.`
          );
        }
      }
    } catch (e) {
      lines.push(`⚠️ 네트워크 오류: ${e instanceof Error ? e.message : String(e)}`);
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (lines.length > 0) alert(lines.join("\n"));
    void loadCandidates();
  };

  const handleDelete = async () => {
    if (!confirm("공고와 모든 후보자/면접 기록을 삭제합니다. 진행할까요?"))
      return;
    const res = await fetch(`/api/jobs/${jobId}`, { method: "DELETE" });
    if (res.ok) router.push("/");
  };

  const retryScreening = async (candidateId: number) => {
    const res = await fetch(`/api/candidates/${candidateId}/screen`, {
      method: "POST",
    });
    if (!res.ok) {
      const text = await res.text();
      alert("재시도 요청 실패: " + text);
      return;
    }
    void loadCandidates();
  };

  if (locked) {
    return (
      <main className="max-w-5xl mx-auto w-full px-6 py-8">
        <Link
          href="/"
          className="text-sm text-slate-500 hover:text-slate-900 transition-colors"
        >
          ← 대시보드
        </Link>
        <UnlockPanel
          title={locked.title}
          jobId={jobId}
          onUnlocked={() => {
            void loadJob();
            void loadCandidates();
          }}
        />
      </main>
    );
  }

  if (!job) {
    if (loadError === "not_found")
      return (
        <main className="max-w-5xl mx-auto px-6 py-8">
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-center">
            <div className="text-slate-700 font-medium">삭제된 공고입니다.</div>
            <div className="mt-1 text-sm text-slate-500">
              이 공고는 더 이상 존재하지 않습니다.
            </div>
            <button
              onClick={() => router.push("/")}
              className="mt-4 px-4 py-2 rounded-lg border border-slate-300 text-sm hover:bg-slate-50"
            >
              공고 목록으로
            </button>
          </div>
        </main>
      );
    if (loadError === "failed")
      return (
        <main className="max-w-5xl mx-auto px-6 py-8">
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-6 text-center">
            <div className="text-rose-700 font-medium">불러오기에 실패했습니다.</div>
            <div className="mt-1 text-sm text-rose-600">
              네트워크 상태를 확인하고 다시 시도해 주세요.
            </div>
            <button
              onClick={() => {
                setLoadError(null);
                void loadJob();
              }}
              className="mt-4 px-4 py-2 rounded-lg border border-rose-300 text-sm text-rose-700 hover:bg-rose-100"
            >
              다시 시도
            </button>
          </div>
        </main>
      );
    return (
      <main className="max-w-5xl mx-auto px-6 py-8 text-slate-500">
        불러오는 중...
      </main>
    );
  }

  // 탭 분류 (status 의존 제거):
  //   screened (평가완료): AI 서류평가 리포트가 있음
  //   interviewed (면접완료): AI 면접 세션 완료됨
  const isScreened = (c: Candidate) => c.screeningReport != null;
  const isInterviewed = (c: Candidate) => c.latestInterviewStatus === "completed";
  const counts = {
    all: candidatesList.length,
    screened: candidatesList.filter(isScreened).length,
    interviewed: candidatesList.filter(isInterviewed).length,
  };

  const byTab =
    tab === "all"
      ? candidatesList
      : tab === "screened"
        ? candidatesList.filter(isScreened)
        : candidatesList.filter(isInterviewed);

  const q = search.trim().toLowerCase();
  const filteredRaw = byTab.filter((c) => {
    if (stageFilter !== "all" && c.stage !== stageFilter) return false;
    if (outcomeFilter === "in_progress" && c.outcome != null) return false;
    if (
      outcomeFilter !== "all" &&
      outcomeFilter !== "in_progress" &&
      c.outcome !== outcomeFilter
    )
      return false;
    if (!q) return true;
    const hay = [
      c.name,
      c.email,
      c.phone,
      c.careerSummary,
      c.screeningReport?.summary,
      c.screeningReport?.strengths?.join(" "),
      c.screeningReport?.matched_keywords?.join(" "),
      c.resumeFilePath,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });

  // 그룹 정렬 — 파이프라인 순서. HR 액션 단계는 stage 별로 별도 블럭.
  // 1차 면접 후보(round1_candidate)는 별도 핀 섹션이라 그룹에서 제외.
  type GroupKey =
    | "system"
    | "hr_screened"
    | "hr_ai_eval"
    | "hr_round1"
    | "hr_round2"
    | "external"
    | "closed_hired"
    | "closed_neg";
  const groupOf = (c: Candidate): GroupKey => {
    if (c.outcome === "hired") return "closed_hired";
    if (c.outcome === "rejected" || c.outcome === "withdrawn")
      return "closed_neg";
    if (c.stage === "applied") return "system";
    if (c.stage === "screened") return "hr_screened";
    if (c.stage === "ai_evaluated") return "hr_ai_eval";
    if (c.stage === "round1_passed") return "hr_round1";
    if (c.stage === "round2_passed") return "hr_round2";
    return "external";
  };
  const GROUP_ORDER: Record<GroupKey, number> = {
    system: 0,
    hr_screened: 1,
    hr_ai_eval: 2,
    hr_round1: 3,
    hr_round2: 4,
    external: 5,
    closed_hired: 6,
    closed_neg: 7,
  };
  const isHrGroup = (gk: GroupKey) =>
    gk === "hr_screened" || gk === "hr_ai_eval" || gk === "hr_round1" || gk === "hr_round2";
  const filtered = [...filteredRaw].sort((a, b) => {
    const ga = GROUP_ORDER[groupOf(a)];
    const gb = GROUP_ORDER[groupOf(b)];
    if (ga !== gb) return ga - gb;
    // 같은 그룹 내: HR 그룹은 점수 높은 순, 그 외는 stage 늦은 순.
    if (isHrGroup(groupOf(a))) {
      const ca = compositeScore(a.screeningScore, a.latestInterviewScore) ?? -1;
      const cb = compositeScore(b.screeningScore, b.latestInterviewScore) ?? -1;
      if (ca !== cb) return cb - ca;
    } else {
      const sa = STAGE_RANK[a.stage] ?? 0;
      const sb = STAGE_RANK[b.stage] ?? 0;
      if (sa !== sb) return sb - sa;
    }
    return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
  });

  // 즐겨찾기 핀 섹션 — 모든 그룹 위. 점수 높은 순.
  const favoriteCandidates = filtered
    .filter((c) => c.favorited)
    .sort((a, b) => {
      const ca = compositeScore(a.screeningScore, a.latestInterviewScore) ?? -1;
      const cb = compositeScore(b.screeningScore, b.latestInterviewScore) ?? -1;
      if (ca !== cb) return cb - ca;
      return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
    });
  // 1차 면접 후보는 별도 섹션 상단 노출 + border 강조 (즐겨찾기는 제외)
  const round1Candidates = filtered.filter(
    (c) => c.stage === "round1_candidate" && !c.favorited
  );
  const otherCandidates = filtered.filter(
    (c) => c.stage !== "round1_candidate" && !c.favorited
  );
  const GROUP_META: Record<GroupKey, { label: string; tone: string }> = {
    system: { label: "⚙️ AI 평가 진행 중", tone: "text-slate-500" },
    hr_screened: { label: "🔔 서류 검토 · 면접 진행 결정", tone: "text-primary-deep" },
    hr_ai_eval: { label: "🔔 AI 면접 결과 검토", tone: "text-primary-deep" },
    hr_round1: { label: "🔔 1차 합격 · 2차 진행 결정", tone: "text-primary-deep" },
    hr_round2: { label: "🔔 2차 합격 · 최종 결정", tone: "text-primary-deep" },
    external: { label: "⏳ 응답 대기", tone: "text-slate-600" },
    closed_hired: { label: "✓ 종결 · 합격", tone: "text-emerald-700" },
    closed_neg: { label: "✗ 종결", tone: "text-slate-400" },
  };

  const visibleIds = filtered.map((c) => c.id);
  const allSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  };
  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const bulkScreen = async (targetIds: number[]) => {
    if (targetIds.length === 0) return;
    const targetSet = new Set(targetIds);
    // 재평가 대상: 아직 AI 서류평가가 안 끝났거나 마지막 평가가 실패한 후보
    const targets = filtered.filter(
      (c) =>
        targetSet.has(c.id) &&
        (c.screeningReport == null || c.lastJobStatus === "failed") &&
        c.queueStatus !== "queued" &&
        c.queueStatus !== "processing"
    );
    if (targets.length === 0) {
      alert("선택된 후보자 중 평가 가능한 후보가 없습니다.");
      return;
    }
    if (
      !confirm(
        `${targets.length}명을 큐에 등록합니다. 토큰이 차감되며 백그라운드에서 순차 평가됩니다.`
      )
    )
      return;
    setBulkBusy(true);
    const res = await fetch("/api/candidates/bulk-screen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: targets.map((c) => c.id) }),
    });
    setBulkBusy(false);
    if (!res.ok) {
      alert(await res.text());
      return;
    }
    const data = (await res.json()) as {
      enqueued: number;
      skipped: number;
      details: { skipped: { reason: string }[] };
    };
    const reasons = data.details.skipped.map((s) => s.reason);
    const reasonSummary = reasons.length
      ? `\n스킵: ${reasons.join(", ")}`
      : "";
    alert(
      `큐 등록: ${data.enqueued}건${data.skipped > 0 ? ` (스킵 ${data.skipped}건)` : ""}${reasonSummary}`
    );
    setSelected(new Set());
    void loadCandidates();
  };

  const bulkDelete = async (targetIds: number[]) => {
    if (targetIds.length === 0) return;
    if (!confirm(`선택된 ${targetIds.length}명을 삭제할까요?`)) return;
    setBulkBusy(true);
    const res = await fetch("/api/candidates/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: targetIds }),
    });
    setBulkBusy(false);
    if (!res.ok) {
      alert(await res.text());
      return;
    }
    setSelected(new Set());
    void loadCandidates();
  };

  const bulkDecide = async (decision: "hired" | "rejected", targetIds: number[]) => {
    if (targetIds.length === 0) return;
    const label = decision === "hired" ? "최종합격" : "불합격";
    const reason = decision === "hired" ? "passed_final" : "other";
    const warn = `\n\n⚠️ 종결 결정입니다.\n이력서 원본·첨부 파일은 즉시 폐기되고, 공고 종결 +14일 후 후보자 정보 전체가 자동 삭제됩니다. 메일 발송은 진행되지 않습니다 (개별 결정 메뉴에서 메일 옵션 사용).`;
    if (
      !confirm(`선택된 ${targetIds.length}명을 "${label}" 으로 일괄 처리할까요?${warn}`)
    )
      return;
    setBulkBusy(true);
    const ids = targetIds;
    let ok = 0;
    let fail = 0;
    for (const id of ids) {
      const res = await fetch(`/api/candidates/${id}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome: decision, outcomeReason: reason, sendNotification: false }),
      });
      if (res.ok) ok++;
      else fail++;
    }
    setBulkBusy(false);
    alert(`${label} 처리: 성공 ${ok}건${fail > 0 ? ` / 실패 ${fail}건` : ""}`);
    setSelected(new Set());
    void loadCandidates();
  };

  const bulkInterviewSend = async (targetIds: number[]) => {
    if (targetIds.length === 0) return;
    if (
      !confirm(
        `선택된 ${targetIds.length}명에게 AI 면접 링크를 일괄 발송할까요?\n\n토큰이 각 후보자당 차감되며, 메일이 발송됩니다.`
      )
    )
      return;
    setBulkBusy(true);
    const r = await fetch(`/api/jobs/${jobId}/interview-links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateIds: targetIds }),
    });
    setBulkBusy(false);
    if (!r.ok) {
      const text = await r.text();
      alert(`발송 실패: ${text}`);
      return;
    }
    const data = (await r.json()) as {
      results: { candidateId: number; status: string; reason?: string }[];
    };
    const sent = data.results.filter((x) => x.status === "sent").length;
    const skipped = data.results.filter((x) => x.status === "skipped").length;
    const failed = data.results.filter((x) => x.status === "failed").length;
    alert(
      `AI 면접 메일 발송 결과: 성공 ${sent}건${skipped > 0 ? ` / 건너뜀 ${skipped}건` : ""}${failed > 0 ? ` / 실패 ${failed}건` : ""}`
    );
    setSelected(new Set());
    void loadCandidates();
  };

  const bulkAdvance = async (newStage: Candidate["stage"], targetIds: number[]) => {
    if (targetIds.length === 0) return;
    setBulkBusy(true);
    const ids = targetIds;
    let ok = 0;
    let fail = 0;
    for (const id of ids) {
      const res = await fetch(`/api/candidates/${id}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: newStage }),
      });
      if (res.ok) ok++;
      else fail++;
    }
    setBulkBusy(false);
    if (fail > 0) alert(`성공 ${ok}건 / 실패 ${fail}건`);
    setSelected(new Set());
    void loadCandidates();
  };

  return (
    <main className="max-w-5xl mx-auto w-full px-6 py-8">
      <Link
        href="/"
        className="text-sm text-slate-500 hover:text-slate-900 transition-colors"
      >
        ← 대시보드
      </Link>

      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 mt-3 shadow-sm">
        <div className="flex justify-between items-start gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-slate-900 leading-tight">
              {job.title}
            </h1>
            <div className="flex flex-wrap gap-1.5 mt-3">
              <Tag>{job.position}</Tag>
              <Tag>{job.level}</Tag>
              <Tag>{job.employmentType}</Tag>
              <Tag>면접 {job.interviewDurationMinutes ?? 20}분</Tag>
              <Tag>톤: {job.tone}</Tag>
            </div>
            <div className="text-xs text-slate-400 mt-3">
              등록 {formatKstDateTime(job.createdAt)}
            </div>
          </div>
          <div className="flex gap-2 shrink-0 items-center">
            <FavoriteStar jobId={Number(jobId)} initial={job.favorited ?? false} size="md" />
            <ShareButton jobId={Number(jobId)} jobTitle={job.title} />
            <Link
              href={`/jobs/${jobId}/edit`}
              className="px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 text-sm text-slate-700"
            >
              수정
            </Link>
            <button
              onClick={handleDelete}
              className="px-3 py-1.5 rounded-lg border border-danger/30 text-danger hover:bg-danger-soft text-sm transition-colors"
            >
              삭제
            </button>
          </div>
        </div>
        <LifecyclePanel job={job} onChanged={() => void loadJob()} />
      </div>

      <FunnelPanel jobId={jobId} refreshKey={funnelKey} />
      <InterviewersPanel jobId={Number(jobId)} />

      {/* 지원자 동의 확인 게이트 — 업로드 전 필수 (PIPA §15·§26·§28의8·§37의2)
         체크 시 모달로 명시 재확인을 요구해 "무심코 체크" 차단. */}
      <ApplicantConsentGate
        confirmed={consentConfirmed}
        busy={consentBusy}
        onConfirm={async () => {
          setConsentBusy(true);
          const r = await fetch(`/api/jobs/${jobId}/applicant-consent`, {
            method: "POST",
          });
          setConsentBusy(false);
          if (!r.ok) {
            alert("고지 확인 저장 실패: " + (await r.text()));
            return;
          }
          setConsentConfirmed(true);
        }}
        onRevoke={async () => {
          if (
            !confirm(
              "고지 확인을 해제합니다.\n지원자에게 안내한 사실이 실제로 없었다면, 업로드한 모든 이력서를 검토·삭제하는 것이 권장됩니다."
            )
          )
            return;
          setConsentBusy(true);
          const r = await fetch(`/api/jobs/${jobId}/applicant-consent`, {
            method: "DELETE",
          });
          setConsentBusy(false);
          if (!r.ok) {
            alert("해제 실패: " + (await r.text()));
            return;
          }
          setConsentConfirmed(false);
        }}
      />

      {/* Upload zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          // 폴더 드래그 지원 — items 가 있으면 webkitGetAsEntry 로 재귀 수집
          if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
            void onUploadFromItems(e.dataTransfer.items);
          } else {
            void onUpload(e.dataTransfer.files);
          }
        }}
        className={`mt-3 rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
          !consentConfirmed
            ? "border-slate-200 bg-slate-50 opacity-60"
            : dragOver
              ? "border-primary bg-primary-soft"
              : "border-slate-300 bg-white hover:bg-slate-50"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.doc,.hwp,.hwpx,.txt,.md,.html,.htm,.zip,.png,.jpg,.jpeg,.pptx,.xlsx"
          multiple
          className="hidden"
          onChange={(e) => onUpload(e.target.files)}
        />
        <input
          ref={folderInputRef}
          type="file"
          // @ts-expect-error webkitdirectory 는 표준 외 속성 (Chromium·Safari 지원)
          webkitdirectory=""
          directory=""
          multiple
          className="hidden"
          onChange={(e) => onUpload(e.target.files)}
        />
        <div className="text-3xl mb-2">📄</div>
        <div className="flex flex-col items-center gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || !consentConfirmed}
            className="text-sm font-medium text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed"
            title={!consentConfirmed ? "먼저 AI 평가 적용 고지 확인을 완료해 주세요" : ""}
          >
            {uploading
              ? "업로드 중..."
              : !consentConfirmed
                ? "AI 평가 적용 고지 확인 후 업로드 가능"
                : "파일을 끌어다 놓거나 클릭해 선택"}
          </button>
          <button
            onClick={() => folderInputRef.current?.click()}
            disabled={uploading || !consentConfirmed}
            className="text-xs text-slate-600 hover:text-primary hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
          >
            📁 폴더로 선택하기
          </button>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          파일 · ZIP · 폴더 모두 지원 · 폴더 드래그 OK
          <br />
          한 응시자에 이력서 + 포트폴리오를 함께 넣으려면 응시자 이름 폴더를 만들어 그 안에 넣어주세요.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mt-8 border-b border-slate-200">
        {[
          { k: "all", label: "전체", count: counts.all },
          { k: "screened", label: "평가완료", count: counts.screened },
          { k: "interviewed", label: "면접완료", count: counts.interviewed },
        ].map(({ k, label, count }) => (
          <button
            key={k}
            onClick={() => setTab(k as typeof tab)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors -mb-px border-b-2 ${
              tab === k
                ? "border-primary text-primary"
                : "border-transparent text-slate-500 hover:text-slate-900"
            }`}
          >
            {label}
            <span className="ml-1.5 text-xs text-slate-400">{count}</span>
          </button>
        ))}
      </div>

      {/* Search + filter */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[220px] relative">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름·이메일·전화·요약 검색"
            className="w-full border border-slate-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
            🔍
          </span>
        </div>
        <select
          value={stageFilter}
          onChange={(e) =>
            setStageFilter(e.target.value as typeof stageFilter)
          }
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="all">단계 전체</option>
          <option value="applied">지원</option>
          <option value="screened">서류평가</option>
          <option value="ai_pending">AI면접 · 대기</option>
          <option value="ai_evaluated">AI면접 · 평가</option>
          <option value="round1_candidate">1차 면접 · 후보</option>
          <option value="round1_scheduling">1차 면접 · 스케쥴 지정</option>
          <option value="round1_waiting">1차 면접 · 대기</option>
          <option value="round1_passed">1차 합격</option>
          <option value="round2_passed">2차 합격</option>
        </select>
        <select
          value={outcomeFilter}
          onChange={(e) =>
            setOutcomeFilter(e.target.value as typeof outcomeFilter)
          }
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="all">결과 전체</option>
          <option value="in_progress">진행 중</option>
          <option value="hired">최종합격</option>
          <option value="rejected">불합격</option>
          <option value="withdrawn">지원취소</option>
        </select>
        <a
          href={`/api/jobs/${jobId}/candidates/export`}
          className="px-3 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm ml-auto"
          title="후보자 데이터 CSV 다운로드"
        >
          📥 CSV
        </a>
      </div>

      {/* Candidate list */}
      {filtered.length === 0 ? (
        <div className="text-center text-slate-500 py-16 bg-white border border-slate-200 rounded-2xl mt-4">
          후보자가 없습니다.
        </div>
      ) : (
        <>
          {favoriteCandidates.length > 0 && (
            <div className="mt-3 mb-4 bg-amber-50/60 border border-amber-300/60 rounded-2xl p-3">
              <div className="flex items-baseline gap-2 mb-2 px-1 flex-wrap">
                <span className="text-sm font-semibold text-amber-700">
                  ★ 즐겨찾기
                </span>
                <span className="text-xs text-amber-700/80">
                  ({favoriteCandidates.length}명)
                </span>
              </div>
              <ul className="space-y-3">
                {favoriteCandidates.map((c) => (
                  <li key={c.id} className="relative">
                    <div
                      className="absolute left-3 top-4 z-10"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggleOne(c.id)}
                        className="rounded border-slate-300"
                      />
                    </div>
                    <Link
                      href={`/candidates/${c.id}`}
                      className="card-hover bg-white border-2 border-amber-300/60 rounded-xl p-4 pl-10 flex justify-between items-start gap-4 block"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <CandidateFavoriteStar
                            candidateId={c.id}
                            initial={c.favorited}
                            onToggle={() => void loadCandidates()}
                          />
                          <span className="font-semibold text-slate-900">{c.name}</span>
                          <StageBadge stage={c.stage} />
                          {c.outcome ? (
                            <OutcomeBadge outcome={c.outcome} />
                          ) : (
                            <WaitBadge stage={c.stage} />
                          )}
                          {c.screeningReport && (
                            <RecBadge rec={c.screeningReport.recommendation} />
                          )}
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500 mt-1.5">
                          {c.careerYears != null && (
                            <span>경력 {c.careerYears}년</span>
                          )}
                          {c.age != null && <span>{c.age}세</span>}
                          {c.phone && <span>{c.phone}</span>}
                          {c.email && <span>{c.email}</span>}
                        </div>
                        {c.careerSummary && (
                          <p className="text-xs text-slate-600 mt-1">
                            {c.careerSummary}
                          </p>
                        )}
                        {c.screeningReport?.summary && (
                          <p className="text-sm text-slate-600 mt-2 line-clamp-2">
                            {c.screeningReport.summary}
                          </p>
                        )}
                        <div className="text-[11px] text-slate-400 mt-2">
                          {c.resumeFilePath} · {formatKstDateTime(c.createdAt)} 업로드
                        </div>
                      </div>
                      <CandidateScores c={c} onRetry={retryScreening} />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {round1Candidates.length > 0 && (
            <div className="mt-3 mb-4 bg-accent-soft/50 border border-accent/40 rounded-2xl p-3">
              <div className="flex items-baseline gap-2 mb-2 px-1 flex-wrap">
                <span className="text-sm font-semibold text-accent-deep">
                  ⭐ 1차 면접 후보
                </span>
                <span className="text-xs text-accent-deep/80">
                  ({round1Candidates.length}명)
                </span>
                <SchedulePropose
                  jobId={Number(jobId)}
                  selectedIds={Array.from(selected).filter((id) =>
                    round1Candidates.some((c) => c.id === id)
                  )}
                  onDone={() => {
                    setSelected(new Set());
                    void loadCandidates();
                  }}
                />
              </div>
              <ul className="space-y-3">
                {round1Candidates.map((c) => (
                  <li key={c.id} className="relative">
                    <div
                      className="absolute left-3 top-4 z-10"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggleOne(c.id)}
                        className="rounded border-slate-300"
                      />
                    </div>
                    <Link
                      href={`/candidates/${c.id}`}
                      className="card-hover bg-card border-2 border-accent/60 rounded-xl p-4 pl-10 flex justify-between items-start gap-4 block"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <CandidateFavoriteStar
                            candidateId={c.id}
                            initial={c.favorited}
                            onToggle={() => void loadCandidates()}
                          />
                          <span className="font-semibold text-slate-900">
                            {c.name}
                          </span>
                          <StageBadge stage={c.stage} />
                          {c.outcome ? (
                            <OutcomeBadge outcome={c.outcome} />
                          ) : (
                            <WaitBadge stage={c.stage} />
                          )}
                          {c.screeningReport && (
                            <RecBadge rec={c.screeningReport.recommendation} />
                          )}
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500 mt-1.5">
                          {c.careerYears != null && (
                            <span>경력 {c.careerYears}년</span>
                          )}
                          {c.age != null && <span>{c.age}세</span>}
                          {c.phone && <span>{c.phone}</span>}
                          {c.email && <span>{c.email}</span>}
                        </div>
                        {c.careerSummary && (
                          <p className="text-xs text-slate-600 mt-1">
                            {c.careerSummary}
                          </p>
                        )}
                        {c.screeningReport?.summary && (
                          <p className="text-sm text-slate-600 mt-2 line-clamp-2">
                            {c.screeningReport.summary}
                          </p>
                        )}
                        <div className="text-[11px] text-slate-400 mt-2">
                          {c.resumeFilePath} · {formatKstDateTime(c.createdAt)}{" "}
                          업로드
                        </div>
                      </div>
                      <CandidateScores c={c} onRetry={retryScreening} />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(
            [
              "system",
              "hr_screened",
              "hr_ai_eval",
              "hr_round1",
              "hr_round2",
              "external",
              "closed_hired",
              "closed_neg",
            ] as const
          ).map((gk) => {
            const items = otherCandidates.filter((c) => groupOf(c) === gk);
            if (items.length === 0) return null;
            const meta = GROUP_META[gk];
            const dimmed = gk === "closed_hired" || gk === "closed_neg";
            const blockIds = items.map((c) => c.id);
            const selectedInBlock = blockIds.filter((id) => selected.has(id));
            const allBlockSelected =
              blockIds.length > 0 && selectedInBlock.length === blockIds.length;
            const toggleBlock = () => {
              setSelected((prev) => {
                const next = new Set(prev);
                if (allBlockSelected) {
                  for (const id of blockIds) next.delete(id);
                } else {
                  for (const id of blockIds) next.add(id);
                }
                return next;
              });
            };
            const selCands = items.filter((c) => selected.has(c.id));
            const inProgress = selCands.filter((c) => c.outcome == null);
            const allInProgress =
              selCands.length > 0 && inProgress.length === selCands.length;
            const stages = new Set(inProgress.map((c) => c.stage));
            const onlyStage =
              allInProgress && stages.size === 1 ? [...stages][0] : null;
            const screenable = selCands.filter(
              (c) =>
                (c.screeningReport == null || c.lastJobStatus === "failed") &&
                c.queueStatus !== "queued" &&
                c.queueStatus !== "processing"
            );
            const hasSel = selectedInBlock.length > 0;
            return (
              <div key={gk} className="mt-4">
                <div className="flex items-center gap-2 mb-2 px-1 flex-wrap">
                  <input
                    type="checkbox"
                    checked={allBlockSelected}
                    onChange={toggleBlock}
                    className="rounded border-slate-300"
                  />
                  <span className={`text-xs font-semibold ${meta.tone}`}>{meta.label}</span>
                  <span className="text-xs text-slate-400">({items.length}명)</span>
                  {hasSel && (
                    <span className="text-xs text-primary-deep font-medium">
                      · {selectedInBlock.length}명 선택됨
                    </span>
                  )}
                  {hasSel && (
                    <div className="flex items-center gap-2 ml-auto flex-wrap">
                      <Link
                        href={`/jobs/${jobId}/compare?ids=${selectedInBlock.join(",")}`}
                        className="px-2.5 py-1.5 rounded-lg bg-primary hover:bg-primary-deep text-white text-xs font-medium whitespace-nowrap"
                      >
                        비교 ({selectedInBlock.length})
                      </Link>
                      {screenable.length > 0 && (
                        <button
                          onClick={() => void bulkScreen(screenable.map((c) => c.id))}
                          disabled={bulkBusy}
                          className="px-2.5 py-1.5 rounded-lg bg-primary hover:bg-primary-deep text-white text-xs font-medium disabled:opacity-50 whitespace-nowrap"
                          title="평가 안 됐거나 실패한 후보를 다시 큐에 넣습니다"
                        >
                          {bulkBusy ? "처리 중..." : `AI 검토 요청 (${screenable.length})`}
                        </button>
                      )}
                      {(onlyStage === "screened" || onlyStage === "ai_pending") && (
                        <button
                          onClick={() => void bulkInterviewSend(inProgress.map((c) => c.id))}
                          disabled={bulkBusy}
                          className="px-2.5 py-1.5 rounded-lg bg-primary hover:bg-primary-deep text-white text-xs font-medium disabled:opacity-50 whitespace-nowrap"
                          title="선택된 후보 전원에게 AI 면접 링크 메일 발송"
                        >
                          {bulkBusy ? "발송 중..." : `📧 AI 면접 발송 (${inProgress.length})`}
                        </button>
                      )}
                      {onlyStage === "ai_evaluated" && (
                        <button
                          onClick={() => void bulkAdvance("round1_candidate", inProgress.map((c) => c.id))}
                          disabled={bulkBusy}
                          className="px-2.5 py-1.5 rounded-lg bg-accent-deep hover:bg-accent text-surface text-xs font-medium disabled:opacity-50 whitespace-nowrap"
                        >
                          ⭐ 1차 면접 후보로 지정
                        </button>
                      )}
                      {onlyStage === "round1_passed" && (
                        <button
                          onClick={() => void bulkAdvance("round2_passed", inProgress.map((c) => c.id))}
                          disabled={bulkBusy}
                          className="px-2.5 py-1.5 rounded-lg bg-primary hover:bg-primary-deep text-white text-xs font-medium disabled:opacity-50 whitespace-nowrap"
                        >
                          → 2차 합격
                        </button>
                      )}
                      {allInProgress && (
                        <button
                          onClick={() => setDecideIds(inProgress.map((c) => c.id))}
                          disabled={bulkBusy}
                          className="px-2.5 py-1.5 rounded-lg bg-primary hover:bg-primary-deep text-surface text-xs font-medium disabled:opacity-50 whitespace-nowrap"
                        >
                          합/불 결정
                        </button>
                      )}
                      <button
                        onClick={() => void bulkDelete(selectedInBlock)}
                        disabled={bulkBusy}
                        className="px-2.5 py-1.5 rounded-lg bg-danger hover:bg-danger/85 text-surface text-xs font-medium disabled:opacity-50 whitespace-nowrap"
                      >
                        {bulkBusy ? "삭제 중..." : `삭제 (${selectedInBlock.length})`}
                      </button>
                    </div>
                  )}
                </div>
                <ul className={`space-y-3 ${dimmed ? "opacity-60" : ""}`}>
                  {items.map((c) => (
                    <li key={c.id} className="relative">
                      <div
                        className="absolute left-3 top-4 z-10"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(c.id)}
                          onChange={() => toggleOne(c.id)}
                          className="rounded border-slate-300"
                        />
                      </div>
                      <Link
                        href={`/candidates/${c.id}`}
                        className="card-hover bg-white border border-slate-200 rounded-xl p-4 pl-10 flex justify-between items-start gap-4 block"
                      >
                        <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <CandidateFavoriteStar
                            candidateId={c.id}
                            initial={c.favorited}
                            onToggle={() => void loadCandidates()}
                          />
                          <span className="font-semibold text-slate-900">{c.name}</span>
                          <StageBadge stage={c.stage} />
                          {c.outcome ? (
                            <OutcomeBadge outcome={c.outcome} />
                          ) : (
                            <WaitBadge stage={c.stage} />
                          )}
                          {c.screeningReport && (
                            <RecBadge rec={c.screeningReport.recommendation} />
                          )}
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500 mt-1.5">
                          {c.careerYears != null && (
                            <span>경력 {c.careerYears}년</span>
                          )}
                          {c.age != null && <span>{c.age}세</span>}
                          {c.phone && <span>{c.phone}</span>}
                          {c.email && <span>{c.email}</span>}
                        </div>
                        {c.careerSummary && (
                          <p className="text-xs text-slate-600 mt-1">
                            {c.careerSummary}
                          </p>
                        )}
                        {c.screeningReport?.summary && (
                          <p className="text-sm text-slate-600 mt-2 line-clamp-2">
                            {c.screeningReport.summary}
                          </p>
                        )}
                        <div className="text-[11px] text-slate-400 mt-2">
                          {c.resumeFilePath} · {formatKstDateTime(c.createdAt)} 업로드
                        </div>
                      </div>
                      <CandidateScores c={c} onRetry={retryScreening} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </>
      )}
      {decideIds && decideIds.length > 0 && (
        <div
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          onClick={() => setDecideIds(null)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-slate-900">합/불 결정</h3>
            <p className="mt-2 text-sm text-slate-600">
              선택한 {decideIds.length}명에 대한 결정을 선택하세요.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <button
                onClick={() => {
                  const ids = decideIds;
                  setDecideIds(null);
                  void bulkDecide("hired", ids);
                }}
                disabled={bulkBusy}
                className="px-4 py-2.5 rounded-lg bg-primary hover:bg-primary-deep text-surface text-sm font-medium disabled:opacity-50 transition-colors"
              >
                ✓ 최종합격
              </button>
              <button
                onClick={() => {
                  const ids = decideIds;
                  setDecideIds(null);
                  void bulkDecide("rejected", ids);
                }}
                disabled={bulkBusy}
                className="px-4 py-2.5 rounded-lg bg-ink hover:bg-ink-soft text-surface text-sm font-medium disabled:opacity-50 transition-colors"
              >
                ✗ 불합격
              </button>
              <button
                onClick={() => setDecideIds(null)}
                className="mt-1 px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm hover:bg-slate-50"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function formatMB(bytes: number): string {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

function shortenError(msg: string | null): string {
  if (!msg) return "";
  // 흔한 패턴을 짧고 친화적인 문구로 치환
  if (/503|Service Unavailable|overloaded/i.test(msg)) return "AI 서버 일시 과부하";
  if (/429|quota|rate/i.test(msg)) return "AI 호출 한도 초과";
  if (/timeout|ETIMEDOUT|ECONNRESET|fetch failed/i.test(msg)) return "AI 응답 지연";
  if (/JSON|parse/i.test(msg)) return "AI 응답 형식 오류";
  if (/API key|GOOGLE_API_KEY|GOOGLE_CLOUD_PROJECT|GOOGLE_APPLICATION_CREDENTIALS|UNAUTHENTICATED|invalid key|PERMISSION_DENIED/i.test(msg))
    return "API 키 / 서비스계정 설정 문제 — 관리자 확인 필요";
  if (/마스킹|텍스트 없음/.test(msg)) return "이력서 텍스트 추출 실패";
  return msg.length > 60 ? msg.slice(0, 60) + "…" : msg;
}

/**
 * 지원자 AI 평가 고지 확인 게이트 (1-click 인라인).
 * - 미확인: 인라인 안내 + 체크박스 (체크 시 즉시 onConfirm).
 * - 확인: 슬림 success 배너 + 해제 버튼.
 * - 감사 로그(IP/시각/유저)가 서버에서 자동 기록되므로 모달·이중 확인 불필요.
 */
function ApplicantConsentGate({
  confirmed,
  busy,
  onConfirm,
  onRevoke,
}: {
  confirmed: boolean;
  busy: boolean;
  onConfirm: () => void | Promise<void>;
  onRevoke: () => void | Promise<void>;
}) {
  if (confirmed) {
    return (
      <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-2.5 flex items-center gap-2.5">
        <div className="flex-1 min-w-0 text-xs text-emerald-800">
          <span className="text-emerald-600 mr-1.5" aria-hidden>✓</span>
          AI 평가 적용 고지 확인됨 — 업로드 가능합니다.
        </div>
        <button
          onClick={onRevoke}
          disabled={busy}
          className="shrink-0 text-xs text-emerald-700 hover:text-emerald-900 hover:underline disabled:opacity-50"
        >
          해제
        </button>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-lg border-2 border-primary/40 bg-primary-soft/40 px-4 py-3 ring-1 ring-primary/10">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={false}
          disabled={busy}
          onChange={(e) => {
            if (e.target.checked) void onConfirm();
          }}
          className="mt-1 h-4 w-4 accent-primary"
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-slate-900 leading-relaxed">
            <span className="text-primary font-semibold">이력서 업로드를 위해 확인 필요 →</span>{" "}
            본 공고에 <strong>&quot;AI 평가 적용 + 거부 시 일반 절차 가능&quot;</strong>{" "}
            을 지원자에게 안내했음을 확인합니다.
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            PIPA §37의2 고지 의무 — 확인 시각·IP 가 감사 로그에 기록됩니다.{" "}
            <Link
              href="/legal/applicant-consent-template"
              target="_blank"
              className="text-slate-600 hover:text-slate-900 underline"
            >
              표준 안내 문구 보기
            </Link>
          </div>
        </div>
      </label>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">
      {children}
    </span>
  );
}

const STAGE_META = STAGE_META_SHARED as Record<
  Candidate["stage"],
  { rank: number; main: string; sub: string | null; color: string }
>;
const STAGE_RANK = STAGE_RANK_SHARED as Record<Candidate["stage"], number>;

function StageBadge({ stage }: { stage: Candidate["stage"] }) {
  const m = STAGE_META[stage];
  return (
    <span
      className={`inline-flex items-baseline gap-1 text-[11px] px-2 py-0.5 rounded-md font-medium border ${m.color}`}
    >
      <span>{m.main}</span>
      {m.sub && <span className="opacity-70 text-[10px]">· {m.sub}</span>}
    </span>
  );
}

const OUTCOME_META: Record<
  NonNullable<Candidate["outcome"]>,
  { label: string; color: string }
> = {
  hired:     { label: "최종합격", color: "bg-primary text-surface border-primary" },
  rejected:  { label: "불합격",   color: "bg-danger-soft text-danger border-danger/30" },
  withdrawn: { label: "지원취소", color: "bg-surface-alt text-ink-soft border-border-default" },
};

function OutcomeBadge({ outcome }: { outcome: NonNullable<Candidate["outcome"]> }) {
  const m = OUTCOME_META[outcome];
  return (
    <span
      className={`inline-flex items-center text-[11px] px-2 py-0.5 rounded-md font-semibold border ${m.color}`}
    >
      {m.label}
    </span>
  );
}

// 대기 주체별 컬러: 시스템(중립) / 인사(주의=warning) / 지원자(정보=info) / 면접관(애프리콧=accent)
const WAITER_META: Record<
  "system" | "hr" | "candidate" | "interviewer" | "none",
  { icon: string; color: string }
> = {
  system:      { icon: "⚙️", color: "bg-surface-alt text-ink-soft border-border-default" },
  hr:          { icon: "👤", color: "bg-warning-soft text-warning border-warning/30" },
  candidate:   { icon: "📧", color: "bg-info-soft text-info border-info/30" },
  interviewer: { icon: "🎤", color: "bg-accent-soft text-accent-deep border-accent/40" },
  none:        { icon: "—",  color: "bg-surface-alt text-ink-muted border-border-default" },
};

function WaitBadge({ stage }: { stage: Candidate["stage"] }) {
  const w = STAGE_WAITER[stage];
  if (w.who === "none") return null;
  const m = WAITER_META[w.who];
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md border ${m.color}`}
      title={w.label}
    >
      <span>{m.icon}</span>
      <span>{w.label}</span>
    </span>
  );
}

function RecBadge({ rec }: { rec: string }) {
  // 강력추천 / 비추천 만 노출. 중간 단계(추천·보류)는 점수로 판단.
  const colorMap: Record<string, string> = {
    강력추천: "bg-primary text-surface",
    비추천: "bg-danger-soft text-danger",
  };
  if (!(rec in colorMap)) return null;
  return (
    <span
      className={`text-[11px] px-2 py-0.5 rounded-md font-medium ${colorMap[rec]}`}
    >
      {rec}
    </span>
  );
}

function CandidateScores({
  c,
  onRetry,
}: {
  c: Candidate;
  onRetry: (cid: number) => void | Promise<void>;
}) {
  if (c.queueStatus === "queued") {
    // 백오프(재시도 대기 중)면 직전 오류 사유 표시
    const isBackoff = c.queueAttempts >= 1 && !!c.lastError;
    return (
      <div className="shrink-0 flex flex-col items-end gap-1">
        <div
          className={
            "px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 " +
            (isBackoff
              ? "bg-orange-50 text-orange-700 border border-orange-200"
              : "bg-amber-50 text-amber-700")
          }
          title={isBackoff ? c.lastError ?? "" : undefined}
        >
          <span
            className={
              "w-1.5 h-1.5 rounded-full " +
              (isBackoff ? "bg-orange-500" : "bg-amber-500")
            }
          />
          {isBackoff
            ? `재시도 대기 (${c.queueAttempts}회 시도)`
            : `대기중${c.queuePosition ? ` (${c.queuePosition}번째)` : ""}`}
        </div>
        {isBackoff && (
          <span className="text-[10px] text-orange-600 max-w-[180px] truncate">
            {shortenError(c.lastError)}
          </span>
        )}
      </div>
    );
  }
  if (c.queueStatus === "processing") {
    return (
      <div className="shrink-0 px-2.5 py-1 rounded-md bg-primary-soft text-primary-deep text-xs font-medium flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
        평가중
      </div>
    );
  }
  if (c.lastJobStatus === "failed") {
    return (
      <div className="shrink-0 flex flex-col items-end gap-1">
        <div
          className="px-2.5 py-1 rounded-md bg-danger-soft text-danger border border-danger/30 text-xs font-medium"
          title={c.lastError ?? "오류 사유 정보 없음"}
        >
          평가 실패
        </div>
        {c.lastError && (
          <span className="text-[10px] text-danger max-w-[200px] truncate">
            {shortenError(c.lastError)}
          </span>
        )}
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void onRetry(c.id);
          }}
          className="text-[11px] px-2 py-0.5 rounded border border-danger/40 text-danger hover:bg-danger-soft font-medium transition-colors"
        >
          🔄 재시도
        </button>
      </div>
    );
  }

  const composite = compositeScore(c.screeningScore, c.latestInterviewScore);
  const showComposite = c.latestInterviewScore != null;
  const interview = interviewBadge(c.latestInterviewStatus);

  return (
    <div className="shrink-0 grid grid-cols-3 gap-3 text-center min-w-[200px]">
      <ScoreBlock label="서류" score={c.screeningScore} accent="slate" />
      <ScoreBlock
        label="면접"
        score={c.latestInterviewScore}
        placeholder={interview}
        accent="slate"
      />
      <ScoreBlock
        label="종합"
        score={showComposite ? composite : null}
        accent="blue"
      />
    </div>
  );
}

function ScoreBlock({
  label,
  score,
  placeholder,
  accent,
}: {
  label: string;
  score: number | null;
  placeholder?: { text: string; bg: string };
  accent: "slate" | "blue";
}) {
  const isBlue = accent === "blue";
  return (
    <div className="flex flex-col items-center">
      <span className="text-[10px] text-slate-500 uppercase tracking-wider">
        {label}
      </span>
      {score != null ? (
        <span
          className={`text-xl font-bold leading-tight ${
            isBlue ? "text-primary" : "text-slate-900"
          }`}
        >
          {score}
        </span>
      ) : placeholder ? (
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded mt-0.5 ${placeholder.bg}`}
        >
          {placeholder.text}
        </span>
      ) : (
        <span className="text-slate-300 text-xl font-bold leading-tight">-</span>
      )}
    </div>
  );
}

function UnlockPanel({
  title,
  jobId,
  onUnlocked,
}: {
  title: string;
  jobId: string;
  onUnlocked: () => void;
}) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (pin.length !== 4) {
      setErr("4자리 숫자를 입력하세요.");
      return;
    }
    setErr("");
    setBusy(true);
    const res = await fetch(`/api/jobs/${jobId}/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pin }),
    });
    setBusy(false);
    if (!res.ok) {
      setErr(await res.text());
      setPin("");
      return;
    }
    onUnlocked();
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-10 mt-6 text-center max-w-md mx-auto shadow-sm">
      <div className="text-4xl mb-3">🔒</div>
      <h1 className="text-xl font-bold text-slate-900">{title}</h1>
      <p className="text-sm text-slate-500 mt-1">
        이 공고는 비밀번호로 보호되어 있습니다.
      </p>
      <input
        autoFocus
        type="password"
        inputMode="numeric"
        maxLength={4}
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        className="w-full mt-6 border border-slate-300 rounded-lg px-3 py-3 text-center text-2xl font-mono tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-primary"
        placeholder="••••"
      />
      {err && <div className="text-xs text-danger mt-2">{err}</div>}
      <button
        onClick={submit}
        disabled={busy || pin.length !== 4}
        className="w-full mt-5 px-4 py-2.5 rounded-lg bg-primary hover:bg-primary-deep text-white text-sm font-medium disabled:opacity-50"
      >
        {busy ? "확인 중..." : "잠금 해제"}
      </button>
    </div>
  );
}

function interviewBadge(status: Candidate["latestInterviewStatus"]): {
  text: string;
  bg: string;
} {
  switch (status) {
    case "pending":
      return { text: "발급됨", bg: "bg-surface-alt text-ink-soft" };
    case "in_progress":
      return { text: "진행중", bg: "bg-warning-soft text-warning" };
    case "completed":
      return { text: "평가중", bg: "bg-primary-soft text-primary-deep" };
    case "expired":
      return { text: "만료", bg: "bg-danger-soft text-danger" };
    default:
      return { text: "미시작", bg: "bg-surface-alt text-ink-muted" };
  }
}

type Funnel = {
  stages: Record<string, number>;
  total: number;
  avgScreeningScore: number | null;
  countWithScreeningScore: number;
  decisionBreakdown: Array<{
    outcome: "hired" | "rejected" | "withdrawn" | null;
    fromStage: string | null;
    n: number;
  }>;
  kpi: {
    avgDecisionDays: number | null;
    decidedCount: number;
    aiResponseRate: number | null;
    r1ResponseRate: number | null;
    withdrawnRate: number;
  };
};

function SchedulePropose({
  jobId,
  selectedIds,
  onDone,
}: {
  jobId: number;
  selectedIds: number[];
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [slots, setSlots] = useState<Array<{ start: string; end: string }>>([]);
  const [modeOnline, setModeOnline] = useState(true);
  const [address, setAddress] = useState("");
  const [addressDetail, setAddressDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [results, setResults] = useState<
    | {
        results: {
          candidateId: number;
          status: "sent" | "skipped" | "failed";
          reason?: string;
        }[];
      }
    | null
  >(null);

  // 모달 열릴 때 org 주소 미리 채움
  useEffect(() => {
    if (!open) return;
    void fetch(`/api/orgs/me`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.officeAddress) setAddress(d.officeAddress);
        if (d?.officeAddressDetail) setAddressDetail(d.officeAddressDetail);
      })
      .catch(() => {});
  }, [open]);

  const submit = async () => {
    setBusy(true);
    setErr("");
    setResults(null);
    if (slots.length === 0) {
      setErr("최소 1개 시간을 추가해 주세요.");
      setBusy(false);
      return;
    }
    if (!modeOnline && !address.trim()) {
      setErr("오프라인 면접은 주소가 필요합니다.");
      setBusy(false);
      return;
    }
    const r = await fetch(`/api/jobs/${jobId}/schedule-propose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidateIds: selectedIds,
        slots,
        modeOnline,
        address: modeOnline ? null : address.trim(),
        addressDetail: modeOnline ? null : addressDetail.trim(),
      }),
    });
    setBusy(false);
    if (!r.ok) {
      setErr(await r.text());
      return;
    }
    const data = await r.json();
    setResults({ results: data.results });
  };

  const close = () => {
    setOpen(false);
    setErr("");
    setResults(null);
    setSlots([]);
  };

  const disabled = selectedIds.length === 0;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="ml-auto text-xs px-3 py-1.5 rounded-md bg-accent-deep hover:bg-accent text-surface font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        title={disabled ? "후보자를 체크하세요" : "면접 스케쥴 제시"}
      >
        📅 면접 스케쥴 제시 ({selectedIds.length})
      </button>
      {open && (
        <div
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          onClick={close}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-slate-900">1차 면접 스케쥴 제시</h3>
            <p className="text-xs text-slate-500 mt-1">
              선택한 {selectedIds.length}명에게 메일로 시간 선택 링크를 발송합니다.
            </p>

            {!results ? (
              <>
                <div className="mt-4 space-y-4 text-sm">
                  <div>
                    <label className="text-xs font-medium text-slate-700 mb-2 block">
                      면접 가능 시간 (1~10개)
                    </label>
                    <SlotCalendarPicker value={slots} onChange={setSlots} />
                  </div>

                  <div>
                    <label className="text-xs font-medium text-slate-700 mb-1 block">
                      면접 방식
                    </label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setModeOnline(true)}
                        className={`flex-1 px-3 py-2 rounded-lg border text-sm ${
                          modeOnline
                            ? "bg-primary-soft border-primary/40 text-primary-deep"
                            : "bg-white border-slate-200 text-slate-500"
                        }`}
                      >
                        💻 온라인
                      </button>
                      <button
                        type="button"
                        onClick={() => setModeOnline(false)}
                        className={`flex-1 px-3 py-2 rounded-lg border text-sm ${
                          !modeOnline
                            ? "bg-primary-soft border-primary/40 text-primary-deep"
                            : "bg-white border-slate-200 text-slate-500"
                        }`}
                      >
                        🏢 오프라인
                      </button>
                    </div>
                  </div>

                  {!modeOnline && (
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-slate-700 block">
                        회사 주소
                      </label>
                      <input
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder="예: 서울시 강남구 테헤란로 123"
                        className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
                      />
                      <input
                        value={addressDetail}
                        onChange={(e) => setAddressDetail(e.target.value)}
                        placeholder="상세 (호수·층 등, 선택)"
                        className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
                      />
                      <p className="text-[11px] text-slate-500">
                        법인 설정에 주소가 없으면 자동 저장됩니다.
                      </p>
                    </div>
                  )}
                </div>

                {err && (
                  <div className="mt-3 text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg p-2 whitespace-pre-wrap">
                    {err}
                  </div>
                )}

                <div className="flex gap-2 mt-5">
                  <button
                    onClick={close}
                    className="flex-1 px-4 py-2 rounded-lg border border-border-strong text-sm hover:bg-surface-alt transition-colors"
                  >
                    취소
                  </button>
                  <button
                    onClick={submit}
                    disabled={busy}
                    className="flex-1 px-4 py-2 rounded-lg bg-accent-deep hover:bg-accent text-surface text-sm font-medium disabled:opacity-50 transition-colors"
                  >
                    {busy ? "발송 중..." : "메일 발송"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="mt-4 space-y-2 max-h-[40vh] overflow-y-auto text-xs">
                  {results.results.map((r) => (
                    <div
                      key={r.candidateId}
                      className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border ${
                        r.status === "sent"
                          ? "bg-primary-soft border-primary/30 text-primary-deep"
                          : r.status === "skipped"
                            ? "bg-warning-soft border-warning/30 text-warning"
                            : "bg-danger-soft border-danger/30 text-danger"
                      }`}
                    >
                      <span>후보자 #{r.candidateId}</span>
                      <span className="font-medium">
                        {r.status === "sent"
                          ? "✓ 발송"
                          : r.status === "skipped"
                            ? `건너뜀 (${r.reason})`
                            : `✗ 실패`}
                      </span>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => {
                    close();
                    onDone();
                  }}
                  className="w-full mt-4 px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-white text-sm font-medium"
                >
                  닫기
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function ShareButton({
  jobId,
  jobTitle,
}: {
  jobId: number;
  jobTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const [emails, setEmails] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<
    | {
        results: {
          email: string;
          status: "sent" | "already_member" | "failed";
          error?: string;
        }[];
        invalidInputs: string[];
      }
    | null
  >(null);
  const [err, setErr] = useState("");

  const submit = async () => {
    setBusy(true);
    setErr("");
    setResults(null);
    const r = await fetch(`/api/jobs/${jobId}/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emails }),
    });
    setBusy(false);
    if (!r.ok) {
      const t = await r.text();
      // JSON 에러 응답이면 사람 읽을 수 있는 메시지만 추출
      let display = t || "발송 실패";
      try {
        const j = JSON.parse(t);
        display = j.error || j.message || display;
        if (j.retryAfterSeconds) display += ` (${j.retryAfterSeconds}초 후 재시도)`;
      } catch {
        /* not JSON — keep raw text */
      }
      setErr(display);
      return;
    }
    const data = await r.json();
    setResults({ results: data.results, invalidInputs: data.invalidInputs });
  };

  const close = () => {
    setOpen(false);
    setEmails("");
    setErr("");
    setResults(null);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 rounded-lg border border-primary/30 text-primary-deep hover:bg-primary-soft text-sm"
      >
        공유
      </button>
      {open && (
        <div
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          onClick={close}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-slate-900">공고 공유</h3>
            <p className="text-xs text-slate-500 mt-1 truncate">{jobTitle}</p>
            {!results ? (
              <>
                <label className="block mt-4">
                  <span className="text-xs text-slate-600">
                    이메일 (콤마{" "}
                    <code className="font-mono bg-slate-100 px-1 rounded">,</code>{" "}
                    또는 세미콜론{" "}
                    <code className="font-mono bg-slate-100 px-1 rounded">;</code>{" "}
                    으로 구분, 최대 20명)
                  </span>
                  <textarea
                    value={emails}
                    onChange={(e) => setEmails(e.target.value)}
                    rows={4}
                    placeholder={'alice@example.com, bob@example.com; carol@example.com'}
                    className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary font-mono"
                  />
                </label>
                <p className="text-[11px] text-slate-500 mt-2 bg-primary-soft border border-primary/30 rounded-lg p-2">
                  📨 받는 분이 링크를 클릭하면 별도 합류 요청 없이 즉시 법인 멤버로 합류됩니다. 링크는 1회용, 7일 만료.
                </p>
                {err && (
                  <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg p-3 mt-2">
                    {err}
                  </div>
                )}
                <div className="flex gap-2 mt-5">
                  <button
                    onClick={close}
                    className="flex-1 px-4 py-2 rounded-lg border border-border-strong text-sm hover:bg-surface-alt transition-colors"
                  >
                    취소
                  </button>
                  <button
                    onClick={submit}
                    disabled={busy || emails.trim().length === 0}
                    className="flex-1 px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-surface text-sm font-medium disabled:opacity-50 transition-colors"
                  >
                    {busy ? "발송 중..." : "공유 메일 발송"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="mt-4 space-y-2 max-h-[40vh] overflow-y-auto text-xs">
                  {results.results.map((r) => (
                    <div
                      key={r.email}
                      className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border ${
                        r.status === "sent"
                          ? "bg-primary-soft border-primary/30 text-primary-deep"
                          : r.status === "already_member"
                            ? "bg-surface-alt border-border-default text-ink-soft"
                            : "bg-danger-soft border-danger/30 text-danger"
                      }`}
                    >
                      <span className="truncate">{r.email}</span>
                      <span className="shrink-0 font-medium">
                        {r.status === "sent"
                          ? "✓ 발송"
                          : r.status === "already_member"
                            ? "이미 멤버"
                            : `✗ 실패`}
                      </span>
                    </div>
                  ))}
                  {results.invalidInputs.length > 0 && (
                    <div className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700">
                      잘못된 형식 (무시됨): {results.invalidInputs.join(", ")}
                    </div>
                  )}
                </div>
                <button
                  onClick={close}
                  className="w-full mt-4 px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-white text-sm font-medium"
                >
                  닫기
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function LifecyclePanel({ job, onChanged }: { job: Job; onChanged: () => void }) {
  const [showExtend, setShowExtend] = useState(false);
  const [info, setInfo] = useState<{
    candidateCount: number;
    perResume: number;
    totalCost: number;
    extensionDays: number;
    currentClosesAt: string;
    daysLeft: number | null;
    allowed: boolean;
    reason: "no_candidates" | "too_early" | null;
    visibleWithinDays: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const status = job.status ?? "active";
  const closesAt = job.closesAt;
  const closedAt = job.closedAt;
  const dLeft = closesAt
    ? Math.ceil((new Date(closesAt).getTime() - Date.now()) / 86_400_000)
    : null;

  const openExtend = async () => {
    setShowExtend(true);
    const r = await fetch(`/api/jobs/${job.id}/extend`);
    if (r.ok) setInfo(await r.json());
  };

  const doExtend = async () => {
    setBusy(true);
    const r = await fetch(`/api/jobs/${job.id}/extend`, { method: "POST" });
    setBusy(false);
    const data = await r.json().catch(() => null);
    if (!r.ok) {
      alert(data?.message ?? "연장 실패");
      return;
    }
    alert(
      `공고를 ${data.extensionDays ?? 30}일 연장했습니다. (${data.totalCost} 토큰 차감)`
    );
    setShowExtend(false);
    onChanged();
  };

  return (
    <div className="mt-4 pt-4 border-t border-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
          {status === "closed" ? (
            <>
              <span className="font-medium text-slate-700">
                종결됨
                {closedAt
                  ? ` · ${formatLocalDate(closedAt)}`
                  : ""}
              </span>
              <span className="text-amber-700">
                +7일 후 이력서 PDF 자동 폐기 / +14일 후 후보자 PII 자동 폐기
              </span>
            </>
          ) : (
            <>
              <span>
                종결 예정:{" "}
                <span className="font-medium text-slate-900">
                  {closesAt ? formatLocalDate(closesAt) : "-"}
                </span>{" "}
                {dLeft != null && (
                  <span
                    className={
                      dLeft <= 3
                        ? "text-danger"
                        : dLeft <= 14
                          ? "text-warning"
                          : "text-primary"
                    }
                  >
                    (D-{dLeft})
                  </span>
                )}
              </span>
              {(job.extensionCount ?? 0) > 0 && (
                <span className="text-slate-500">
                  연장 {job.extensionCount}회
                </span>
              )}
            </>
          )}
        </div>
        {status === "active" && dLeft != null && dLeft <= 14 && (
          <button
            onClick={openExtend}
            className="px-3 py-1.5 rounded-lg border border-primary/30 text-primary-deep hover:bg-primary-soft text-sm"
          >
            공고 연장
          </button>
        )}
      </div>

      {showExtend && (
        <div
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          onClick={() => setShowExtend(false)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-slate-900">공고 연장</h3>
            {info ? (
              <div className="mt-4 text-sm text-slate-700 space-y-2">
                <div className="flex justify-between">
                  <span>현재 등록 후보자</span>
                  <span className="font-medium">
                    {info.candidateCount}명
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>이력서 단가</span>
                  <span className="font-medium">{info.perResume} 토큰</span>
                </div>
                <div className="flex justify-between border-t pt-2 text-slate-900">
                  <span>차감 합계</span>
                  <span className="font-bold">
                    {info.totalCost} 토큰
                  </span>
                </div>
                <div className="text-xs text-slate-500 mt-3 bg-slate-50 rounded-lg p-3">
                  종결 예정일이 {info.extensionDays}일 연장됩니다.
                </div>
                {!info.allowed && info.reason === "too_early" && (
                  <div className="text-xs text-amber-800 mt-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
                    ⏳ 종결 {info.visibleWithinDays}일 전부터 연장 가능합니다.
                    (현재 D-{info.daysLeft})
                  </div>
                )}
                {!info.allowed && info.reason === "no_candidates" && (
                  <div className="text-xs text-amber-800 mt-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
                    📋 등록된 이력서가 없어 연장이 불필요합니다. 이력서 등록 후 다시 시도해 주세요.
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-4 text-sm text-slate-500">정보 불러오는 중...</div>
            )}
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setShowExtend(false)}
                className="flex-1 px-4 py-2 rounded-lg border border-slate-300 text-sm"
              >
                취소
              </button>
              <button
                onClick={doExtend}
                disabled={busy || !info || !info.allowed}
                className="flex-1 px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-white text-sm font-medium disabled:opacity-50"
              >
                {busy ? "처리 중..." : "연장"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InterviewersPanel({ jobId }: { jobId: number }) {
  type Row = {
    userId: number;
    name: string;
    email: string;
    assignedAt: string;
  };
  const [data, setData] = useState<{
    interviewers: Row[];
    me: { isInterviewer: boolean };
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = async () => {
    const r = await fetch(`/api/jobs/${jobId}/interviewers`);
    if (r.ok) setData(await r.json());
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const selfAssign = async () => {
    setBusy(true);
    setErr("");
    const r = await fetch(`/api/jobs/${jobId}/interviewers`, { method: "POST" });
    setBusy(false);
    if (!r.ok) {
      setErr(await r.text());
      return;
    }
    void load();
  };

  const remove = async (userId: number) => {
    if (!confirm("면접관에서 제외할까요?")) return;
    setBusy(true);
    const r = await fetch(
      `/api/jobs/${jobId}/interviewers?userId=${userId}`,
      { method: "DELETE" }
    );
    setBusy(false);
    if (!r.ok) {
      setErr(await r.text());
      return;
    }
    void load();
  };

  if (!data) return null;

  return (
    <div className="mt-4 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-900">
          공고 면접관{" "}
          <span className="text-xs text-slate-500 font-normal">
            ({data.interviewers.length}명)
          </span>
        </h3>
        {!data.me.isInterviewer && (
          <button
            onClick={selfAssign}
            disabled={busy}
            className="text-xs px-3 py-1.5 rounded-md bg-primary hover:bg-primary-deep text-white font-medium disabled:opacity-50"
          >
            {busy ? "처리 중..." : "면접관 지정"}
          </button>
        )}
      </div>
      {err && (
        <div className="text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg p-2 mb-3">
          {err}
        </div>
      )}
      {data.interviewers.length === 0 ? (
        <p className="text-xs text-slate-500 italic">
          아직 지정된 면접관이 없습니다.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {data.interviewers.map((r) => (
            <li
              key={r.userId}
              className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200"
            >
              <div className="min-w-0">
                <span className="text-sm font-medium text-slate-900">
                  {r.name}
                </span>
                <span className="text-xs text-slate-500 ml-2">{r.email}</span>
              </div>
              <button
                onClick={() => remove(r.userId)}
                disabled={busy}
                className="text-[11px] text-ink-soft hover:text-danger disabled:opacity-50 transition-colors"
                title="면접관에서 제외"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FunnelPanel({
  jobId,
  refreshKey,
}: {
  jobId: string;
  refreshKey: number;
}) {
  const [data, setData] = useState<Funnel | null>(null);

  useEffect(() => {
    void fetch(`/api/jobs/${jobId}/funnel`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d));
  }, [jobId, refreshKey]);

  if (!data || data.total === 0) return null;

  // 전형 단계 — 1줄 표시. 컬러 스토리: 중립(지원) → 포레스트(서류) → 정보(AI진행) → 애프리콧(사람면접) → 포레스트(합격) → 솔리드(최종)
  const pipelineCells: { stage: string; label: string; color: string }[] = [
    { stage: "applied", label: "지원", color: "bg-surface-alt text-ink-soft" },
    { stage: "screened", label: "서류평가", color: "bg-primary-soft text-primary-deep" },
    { stage: "ai_pending", label: "AI면접·대기", color: "bg-info-soft text-info" },
    { stage: "ai_evaluated", label: "AI면접·평가", color: "bg-info-soft text-info" },
    { stage: "round1_candidate", label: "1차·후보", color: "bg-accent-soft text-accent-deep" },
    { stage: "round1_scheduling", label: "1차·스케쥴", color: "bg-accent-soft text-accent-deep" },
    { stage: "round1_waiting", label: "1차·대기", color: "bg-accent-soft text-accent-deep" },
    { stage: "round1_passed", label: "1차 합격", color: "bg-primary-soft text-primary-deep" },
    { stage: "round2_passed", label: "2차 합격", color: "bg-primary-soft text-primary" },
    { stage: "hired", label: "최종 합격", color: "bg-primary text-surface" },
  ];

  // 결정 단계 — 불합격/지원취소. 최종 합격은 파이프라인에 포함되어 제외.
  const stageLabelMap: Record<string, string> = {
    applied: "지원",
    screened: "서류평가",
    ai_pending: "AI면접·대기",
    ai_evaluated: "AI면접·평가",
    round1_candidate: "1차·후보",
    round1_scheduling: "1차·스케쥴",
    round1_waiting: "1차·대기",
    round1_passed: "1차 합격",
    round2_passed: "2차 합격",
  };
  const rejectedBreakdown = (data.decisionBreakdown ?? []).filter(
    (r) => r.outcome === "rejected"
  );
  const withdrawnBreakdown = (data.decisionBreakdown ?? []).filter(
    (r) => r.outcome === "withdrawn"
  );
  const rejectedTotal = rejectedBreakdown.reduce((s, r) => s + r.n, 0);
  const withdrawnTotal = withdrawnBreakdown.reduce((s, r) => s + r.n, 0);
  const fmtPct = (v: number | null) =>
    v == null ? "-" : `${Math.round(v * 100)}%`;

  return (
    <div className="mt-4 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
      <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
        <h3 className="text-sm font-semibold text-slate-900">전형 단계 현황</h3>
        <div className="text-xs text-slate-500">
          총 <strong className="text-slate-900">{data.total}</strong>명
          {data.avgScreeningScore != null && (
            <>
              {" · "}AI 서류 평균{" "}
              <strong className="text-slate-900">
                {data.avgScreeningScore}
              </strong>
              점 ({data.countWithScreeningScore}명)
            </>
          )}
        </div>
      </div>

      {/* 파이프라인 — 1줄 (가로 스크롤). 화살표로 흐름 표시. */}
      <div className="flex items-stretch gap-1 overflow-x-auto pb-2">
        {pipelineCells.map((cell, i) => {
          const n = data.stages[cell.stage] ?? 0;
          return (
            <div key={cell.stage} className="flex items-center gap-1 shrink-0">
              <div
                className={`rounded-md px-2 py-1.5 text-center min-w-[68px] ${
                  n > 0 ? cell.color : "bg-slate-50 text-slate-300"
                }`}
              >
                <div className="text-[10px] tracking-wider opacity-80 whitespace-nowrap">
                  {cell.label}
                </div>
                <div className="text-base font-bold mt-0.5 tabular-nums">
                  {n}
                </div>
              </div>
              {i < pipelineCells.length - 1 && (
                <span className="text-slate-300 text-xs">▸</span>
              )}
            </div>
          );
        })}
      </div>

      {/* 결정 현황 — 불합격/지원취소만, 컴팩트하게 단계별 breakdown */}
      {(rejectedTotal > 0 || withdrawnTotal > 0) && (
        <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap gap-x-4 gap-y-2 text-[11px]">
          {rejectedTotal > 0 && (
            <div className="flex items-baseline gap-1.5">
              <span className="text-danger font-medium">
                ✗ 불합격 {rejectedTotal}건
              </span>
              <span className="text-slate-400">
                {rejectedBreakdown.map((r, idx) => (
                  <span key={idx}>
                    {idx > 0 && ", "}
                    {r.fromStage
                      ? (stageLabelMap[r.fromStage] ?? r.fromStage)
                      : "단계 미상"}{" "}
                    {r.n}
                  </span>
                ))}
              </span>
            </div>
          )}
          {withdrawnTotal > 0 && (
            <div className="flex items-baseline gap-1.5">
              <span className="text-slate-600 font-medium">
                ↩ 지원취소 {withdrawnTotal}건
              </span>
              <span className="text-slate-400">
                {withdrawnBreakdown.map((r, idx) => (
                  <span key={idx}>
                    {idx > 0 && ", "}
                    {r.fromStage
                      ? (stageLabelMap[r.fromStage] ?? r.fromStage)
                      : "단계 미상"}{" "}
                    {r.n}
                  </span>
                ))}
              </span>
            </div>
          )}
        </div>
      )}

      {/* KPI — 평균 처리 시간 / 응답률 / 취소율 */}
      <div className="mt-4 pt-3 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiItem
          label="평균 처리 시간"
          value={
            data.kpi?.avgDecisionDays != null
              ? `${data.kpi.avgDecisionDays}일`
              : "-"
          }
          sub={`종결 ${data.kpi?.decidedCount ?? 0}건 기준`}
        />
        <KpiItem
          label="AI 면접 응답률"
          value={fmtPct(data.kpi?.aiResponseRate ?? null)}
          sub="발송 → 평가 진행"
        />
        <KpiItem
          label="1차 면접 응답률"
          value={fmtPct(data.kpi?.r1ResponseRate ?? null)}
          sub="일정 발송 → 확정"
        />
        <KpiItem
          label="지원자 취소율"
          value={fmtPct(data.kpi?.withdrawnRate ?? null)}
          sub={`전체 ${data.total}명 중`}
        />
      </div>
    </div>
  );
}

function KpiItem({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
      <div className="text-[10px] text-slate-500 uppercase tracking-wider">
        {label}
      </div>
      <div className="text-lg font-bold text-slate-900 tabular-nums mt-0.5">
        {value}
      </div>
      <div className="text-[10px] text-slate-400 mt-0.5">{sub}</div>
    </div>
  );
}
