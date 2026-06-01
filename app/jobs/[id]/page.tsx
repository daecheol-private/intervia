"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { upload } from "@vercel/blob/client";
import { CandidateFavoriteStar } from "@/app/components/CandidateFavoriteStar";
import { ScheduleProposeModal } from "@/app/components/ScheduleProposeModal";
import { JobExpiredDecisionModal } from "@/app/components/JobExpiredDecisionModal";
import { notify, confirmDialog } from "@/app/components/Dialog";
import Link from "next/link";
import { compositeScore, formatKstDateTime, formatLocalDate } from "@/lib/utils";
import { isEncryptedZipFile } from "@/lib/zip-encrypted-client";
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
  evaluationFocus?: string;
  companyName?: string | null;
};

type Candidate = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  age: number | null;
  careerYears: number | null;
  careerSummary: string | null;
  educationLevel: string | null;
  educationSchool: string | null;
  educationMajor: string | null;
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
  lastJobStatus: "queued" | "processing" | "done" | "failed" | "paused" | null;
  // 파싱(텍스트 추출+마스킹) 완료 여부 — false = '분석 중', true = 평가 단계.
  parsed: boolean;
  favorited: boolean;
};

/** 1차 면접 확정 일정 항목 (GET /api/jobs/[id]/round1-schedule). */
type Round1ScheduleItem = {
  candidateId: number;
  name: string;
  selectedSlot: { start: string; end: string };
  modeOnline: boolean;
  address: string | null;
  addressDetail: string | null;
  onlineMeetingUrl: string | null;
};

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const jobId = params.id;
  const [job, setJob] = useState<Job | null>(null);
  const [candidatesList, setCandidatesList] = useState<Candidate[]>([]);
  const [uploading, setUploading] = useState(false);
  // 업로드 진행 상태 — null=비활성. phase: 'uploading'(파일 전송) → 'processing'(서버 등록).
  const [uploadProgress, setUploadProgress] = useState<{
    phase: "uploading" | "processing";
    pct: number;
    done: number;
    total: number;
  } | null>(null);
  const [tab, setTab] = useState<"all" | "screened" | "interviewed">("all");
  const [dragOver, setDragOver] = useState(false);
  const [locked, setLocked] = useState<{ title: string } | null>(null);
  const [loadError, setLoadError] = useState<"not_found" | "failed" | null>(null);
  const [search, setSearch] = useState("");
  // 만료 결정 모달 — 닫아도 페이지 상단 띠는 유지. 다시 열기 가능.
  const [expiredModalDismissed, setExpiredModalDismissed] = useState(false);
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
  // 합·불 일괄 처리 모달 — 사유 + 통보 메일 옵션을 받기 위해 confirm 대신 모달 사용.
  const [bulkDecisionState, setBulkDecisionState] = useState<{
    decision: "hired" | "rejected";
    ids: number[];
  } | null>(null);
  const [decideIds, setDecideIds] = useState<number[] | null>(null);
  // 1차 면접 확정 일정 팝업 — null=닫힘, 배열=열림(시간순 정렬된 목록).
  const [round1Schedule, setRound1Schedule] = useState<Round1ScheduleItem[] | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  // 펀널 단계 박스 클릭 시 후보자 목록으로 스크롤할 기준점.
  const listTopRef = useRef<HTMLDivElement>(null);
  // 채용기업이 "지원자가 AI 평가 적용에 동의했음" 을 확인했는가.
  // 미체크 시 업로드 차단 (서버도 게이트 — PIPA 책임 전가 메커니즘).
  // 공고 단위 DB 영구 저장 — job.applicantConsentConfirmedAt 으로 부터 복원.
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [consentBusy, setConsentBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  // 업로드 진행 중 재진입 방지 — state 는 비동기 반영이라 빠른 연속 드롭을 못 막아 ref 로 동기 가드
  const uploadingRef = useRef(false);

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
    // 이미 업로드 진행 중이면 무시 (드래그앤드롭 등으로 인한 중복 업로드 방지)
    if (uploadingRef.current) return;
    // 지원자 동의 확인 가드 — 서버에서도 게이트하지만 UX 위해 사전 차단
    if (!consentConfirmed) {
      notify(
        "이력서를 업로드하기 전, 지원자에게 'AI 평가 적용 + 거부 시 일반 절차 가능' 을 안내하셨는지 체크박스로 확인해 주세요.\n\n표준 안내 문구는 '자세히' 링크에서 확인할 수 있습니다.",
        { tone: "warn", title: "AI 평가 적용 고지 확인 필요" }
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
      notify(
        `다음 파일이 크기 제한을 초과해 업로드를 시작하지 않았습니다.\n\n${tooLarge.join("\n")}\n\n원본 ZIP/파일을 작게 분할하거나 압축률을 높여 다시 시도해 주세요.`,
        { tone: "warn", title: "파일 크기 초과" }
      );
      return;
    }
    const total = entries.reduce((s, e) => s + e.file.size, 0);
    if (total > MAX_TOTAL) {
      notify(
        `업로드 총 용량 ${formatMB(total)} 이 너무 큽니다 (한 번에 최대 ${formatMB(MAX_TOTAL)}).\n\n파일 수를 나눠 여러 번에 걸쳐 업로드해 주세요.`,
        { tone: "warn", title: "총 용량 초과" }
      );
      return;
    }

    // 암호 걸린 ZIP 사전 차단 — 업로드 전 헤더만 읽어 즉시 판정.
    // (fflate 가 암호화 ZIP 미지원 → 그냥 올리면 서버에서 한참 뒤 실패)
    const encryptedZips: string[] = [];
    for (const { file, relativePath } of entries) {
      if (!relativePath.toLowerCase().endsWith(".zip")) continue;
      if (await isEncryptedZipFile(file)) encryptedZips.push(relativePath);
    }
    if (encryptedZips.length > 0) {
      notify(
        `암호가 걸린 압축 파일은 지원하지 않습니다.\n\n${encryptedZips
          .map((n) => `· ${n}`)
          .join("\n")}\n\n압축 비밀번호를 해제한 뒤 다시 업로드해 주세요.`,
        { tone: "warn", title: "암호화 ZIP 미지원" }
      );
      return;
    }

    uploadingRef.current = true;
    setUploading(true);
    // Vercel 서버 함수 본문 한도(4.5MB) 회피 — 브라우저에서 Vercel Blob 으로 직접 업로드 후
    // 서버에는 manifest(JSON) 만 전송. 100MB 까지 가능.
    // dev/blob 미설정 환경에서는 NEXT_PUBLIC_BLOB_CLIENT_UPLOAD!=1 → 기존 FormData 경로.
    const useBlobUpload = process.env.NEXT_PUBLIC_BLOB_CLIENT_UPLOAD === "1";
    const lines: string[] = [];
    setUploadProgress({ phase: "uploading", pct: 0, done: 0, total: entries.length });
    try {
      let res: Response;
      if (useBlobUpload) {
        const blobs: { url: string; pathname: string; size: number }[] = [];
        // 전체 바이트 대비 진행률 — 파일별 onUploadProgress 를 누적해 표시.
        const totalBytes = entries.reduce((s, e) => s + e.file.size, 0) || 1;
        let uploadedBytes = 0;
        let doneCount = 0;
        for (const { file, relativePath } of entries) {
          // pathname 의 경로 구분자를 살려 서버가 relativePath 로 재구성 가능하게 함.
          // 한글/공백은 upload() 내부에서 인코딩.
          const result = await upload(relativePath, file, {
            access: "public",
            handleUploadUrl: "/api/blob/upload",
            clientPayload: JSON.stringify({ jobId }),
            multipart: file.size > 8 * 1024 * 1024,
            onUploadProgress: (p) => {
              const pct = Math.min(
                99,
                Math.round(((uploadedBytes + p.loaded) / totalBytes) * 100)
              );
              setUploadProgress({
                phase: "uploading",
                pct,
                done: doneCount,
                total: entries.length,
              });
            },
          });
          uploadedBytes += file.size;
          doneCount += 1;
          setUploadProgress({
            phase: "uploading",
            pct: Math.min(99, Math.round((uploadedBytes / totalBytes) * 100)),
            done: doneCount,
            total: entries.length,
          });
          blobs.push({
            url: result.url,
            pathname: relativePath,
            size: file.size,
          });
        }
        // 파일 전송 끝 — 서버가 후보자 등록(껍데기 생성)하는 동안 '처리 중' 표시.
        setUploadProgress({
          phase: "processing",
          pct: 100,
          done: entries.length,
          total: entries.length,
        });
        res = await fetch(`/api/jobs/${jobId}/candidates`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ blobs, applicantConsentConfirmed: true }),
        });
      } else {
        setUploadProgress({
          phase: "processing",
          pct: 100,
          done: entries.length,
          total: entries.length,
        });
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
    uploadingRef.current = false;
    setUploading(false);
    setUploadProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (lines.length > 0) {
      const hasWarn = lines.some((l) => l.includes("⚠️"));
      notify(lines.join("\n"), {
        title: "업로드 결과",
        tone: hasWarn ? "warn" : "success",
      });
    }
    void loadCandidates();
  };

  const handleDelete = async () => {
    if (
      !(await confirmDialog(
        "공고와 모든 후보자/면접 기록을 삭제합니다. 진행할까요?",
        { tone: "danger", title: "공고 삭제", confirmText: "삭제" }
      ))
    )
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
      notify(text, { tone: "danger", title: "재시도 요청 실패" });
      return;
    }
    void loadCandidates();
  };

  if (locked) {
    return (
      <main className="max-w-5xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
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
        <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
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
        <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
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
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 text-slate-500">
        불러오는 중...
      </main>
    );
  }

  // 공고 만료 — closesAt 지났고 아직 active. HR 액션 UI 잠금.
  const isExpired =
    job.status === "active" &&
    !!job.closesAt &&
    new Date(job.closesAt).getTime() < Date.now();

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
    // "최종 합격"은 stage 가 아니라 outcome 기준 (합격자는 stage 가 round2_passed 등으로 남고
    // outcome 만 "hired"). 특정 단계 필터에서는 hired 후보를 제외 — 펀널이 hired 를 해당 단계에서
    // 빼서 "최종 합격" 박스로 옮겨 표시하므로, 박스 숫자와 목록이 정확히 일치하게 한다.
    if (stageFilter === "hired") {
      if (c.outcome !== "hired") return false;
    } else if (stageFilter !== "all") {
      if (c.stage !== stageFilter || c.outcome === "hired") return false;
    }
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
  // 핀 섹션(즐겨찾기·1차 면접 후보) 전용 일괄 선택 토글.
  const toggleSection = (ids: number[]) => {
    const all = ids.length > 0 && ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (all) next.delete(id);
        else next.add(id);
      }
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
      notify("선택된 후보자 중 평가 가능한 후보가 없습니다.", { tone: "warn" });
      return;
    }
    if (
      !(await confirmDialog(
        `${targets.length}명을 큐에 등록합니다. 토큰이 차감되며 백그라운드에서 순차 평가됩니다.`,
        { title: "AI 검토 요청", confirmText: "등록" }
      ))
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
      notify(await res.text(), { tone: "danger", title: "큐 등록 실패" });
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
    notify(
      `큐 등록: ${data.enqueued}건${data.skipped > 0 ? ` (스킵 ${data.skipped}건)` : ""}${reasonSummary}`,
      { tone: "success", title: "AI 검토 요청 완료" }
    );
    setSelected(new Set());
    void loadCandidates();
  };

  const bulkDelete = async (targetIds: number[]) => {
    if (targetIds.length === 0) return;
    if (
      !(await confirmDialog(`선택된 ${targetIds.length}명을 삭제할까요?`, {
        tone: "danger",
        title: "후보자 삭제",
        confirmText: "삭제",
      }))
    )
      return;
    setBulkBusy(true);
    const res = await fetch("/api/candidates/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: targetIds }),
    });
    setBulkBusy(false);
    if (!res.ok) {
      notify(await res.text(), { tone: "danger", title: "삭제 실패" });
      return;
    }
    setSelected(new Set());
    void loadCandidates();
  };

  // 합·불 일괄 처리 — 사유·통보 메일 옵션을 받기 위해 모달을 연다 (confirm 대신).
  const bulkDecide = (decision: "hired" | "rejected", targetIds: number[]) => {
    if (targetIds.length === 0) return;
    setBulkDecisionState({ decision, ids: targetIds });
  };

  // 모달 확정 시 실제 처리 — 후보자별 outcome + 사유 설정, sendMail 시 통보 메일도 발송.
  // stage PATCH 가 sendNotification/customMessage 를 직접 처리 (별도 메일 호출 불필요).
  const runBulkDecision = async (opts: {
    reason: string;
    sendMail: boolean;
    customMessage: string;
  }) => {
    const st = bulkDecisionState;
    if (!st) return;
    const label = st.decision === "hired" ? "최종합격" : "불합격";
    setBulkBusy(true);
    let ok = 0;
    let fail = 0;
    let mailOk = 0;
    let mailFail = 0;
    for (const id of st.ids) {
      const cand = candidatesList.find((c) => c.id === id);
      // {이름} 토큰을 각 지원자 이름으로 치환. 본문이 비어 있으면 서버 기본 템플릿 사용.
      const personalized = opts.customMessage
        ? opts.customMessage.split("{이름}").join(cand?.name ?? "")
        : undefined;
      const res = await fetch(`/api/candidates/${id}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outcome: st.decision,
          outcomeReason: opts.reason || undefined,
          sendNotification: opts.sendMail,
          customMessage: personalized,
        }),
      });
      if (!res.ok) {
        fail++;
        continue;
      }
      ok++;
      if (opts.sendMail) {
        const data = (await res.json().catch(() => null)) as {
          mail?: { sent?: boolean };
        } | null;
        if (data?.mail?.sent) mailOk++;
        else mailFail++;
      }
    }
    setBulkBusy(false);
    setBulkDecisionState(null);
    notify(
      `${label} 처리: 성공 ${ok}건${fail > 0 ? ` / 실패 ${fail}건` : ""}` +
        (opts.sendMail
          ? ` · 메일 ${mailOk}건 발송${mailFail > 0 ? ` / ${mailFail}건 미발송` : ""}`
          : ""),
      { tone: fail > 0 || mailFail > 0 ? "warn" : "success", title: `${label} 처리 완료` }
    );
    setSelected(new Set());
    void loadCandidates();
  };

  const bulkInterviewSend = async (targetIds: number[]) => {
    if (targetIds.length === 0) return;
    if (
      !(await confirmDialog(
        `선택된 ${targetIds.length}명에게 AI 면접 링크를 일괄 발송할까요?\n\n메일이 발송되며, 토큰은 각 지원자가 동의 후 면접을 시작할 때 차감됩니다 (미응답 링크는 무료).`,
        { title: "AI 면접 링크 발송", confirmText: "발송" }
      ))
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
      notify(text, { tone: "danger", title: "발송 실패" });
      return;
    }
    const data = (await r.json()) as {
      results: { candidateId: number; status: string; reason?: string }[];
    };
    const sent = data.results.filter((x) => x.status === "sent").length;
    const skipped = data.results.filter((x) => x.status === "skipped").length;
    const failed = data.results.filter((x) => x.status === "failed").length;
    notify(
      `AI 면접 메일 발송 결과: 성공 ${sent}건${skipped > 0 ? ` / 건너뜀 ${skipped}건` : ""}${failed > 0 ? ` / 실패 ${failed}건` : ""}`,
      { tone: failed > 0 ? "warn" : "success", title: "AI 면접 발송 결과" }
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
    if (fail > 0)
      notify(`성공 ${ok}건 / 실패 ${fail}건`, { tone: "warn", title: "처리 결과" });
    setSelected(new Set());
    void loadCandidates();
  };

  const openRound1Schedule = async () => {
    setScheduleLoading(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/round1-schedule`);
      if (!res.ok) {
        notify(`일정을 불러오지 못했습니다 (HTTP ${res.status}).`, {
          tone: "danger",
          title: "조회 실패",
        });
        return;
      }
      const data = (await res.json()) as Round1ScheduleItem[];
      setRound1Schedule(data);
    } catch (e) {
      notify(`일정 조회 오류: ${e instanceof Error ? e.message : String(e)}`, {
        tone: "danger",
        title: "조회 오류",
      });
    } finally {
      setScheduleLoading(false);
    }
  };

  // 선택된 후보에 대한 일괄 액션 버튼 묶음. 단계 블록과 즐겨찾기 섹션이 공유한다.
  // (즐겨찾기 후보는 단계 블록에서 제외되므로, 여기서 같은 버튼을 렌더해야 동작함)
  const renderBulkActions = (cands: Candidate[]) => {
    const selectedInBlock = cands.map((c) => c.id).filter((id) => selected.has(id));
    if (selectedInBlock.length === 0) return null;
    const selCands = cands.filter((c) => selected.has(c.id));
    const inProgress = selCands.filter((c) => c.outcome == null);
    const allInProgress =
      selCands.length > 0 && inProgress.length === selCands.length;
    const stages = new Set(inProgress.map((c) => c.stage));
    const onlyStage = allInProgress && stages.size === 1 ? [...stages][0] : null;
    const screenable = selCands.filter(
      (c) =>
        (c.screeningReport == null || c.lastJobStatus === "failed") &&
        c.queueStatus !== "queued" &&
        c.queueStatus !== "processing"
    );
    return (
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
        {(onlyStage === "round1_candidate" ||
          onlyStage === "round1_scheduling") && (
          <SchedulePropose
            jobId={Number(jobId)}
            selectedIds={inProgress.map((c) => c.id)}
            onDone={() => {
              setSelected(new Set());
              void loadCandidates();
            }}
          />
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
    );
  };

  return (
    <main className="max-w-5xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      {/* 만료 결정 모달 — closesAt 지났는데 아직 active 면 노출. 사용자가 닫을 수 있음. */}
      {isExpired && !expiredModalDismissed && (
        <JobExpiredDecisionModal
          jobId={Number(jobId)}
          closesAt={job.closesAt!}
          onResolved={() => {
            setExpiredModalDismissed(false);
            void loadJob();
          }}
          onDismiss={() => setExpiredModalDismissed(true)}
        />
      )}
      {/* 만료 상태 띠 — 모달 닫은 뒤에도 페이지 상단에 항상 노출, 다시 열기 가능 */}
      {isExpired && (
        <div className="mb-3 rounded-lg border border-warning/30 bg-warning-soft/40 px-4 py-2.5 flex items-center gap-3 text-xs flex-wrap">
          <span className="text-warning">⏰</span>
          <span className="text-ink-soft flex-1 min-w-0">
            공고 종결 예정일이 지났습니다. HR 액션이 잠시 중단된 상태입니다.
            <span className="text-danger font-medium ml-1.5">
              ⚠{" "}
              {Math.max(
                0,
                Math.ceil(
                  (new Date(job.closesAt!).getTime() +
                    14 * 86_400_000 -
                    Date.now()) /
                    86_400_000
                )
              )}
              일 후 자동 삭제
            </span>
          </span>
          <button
            type="button"
            onClick={() => setExpiredModalDismissed(false)}
            className="text-xs font-medium text-primary-deep hover:underline"
          >
            연장 / 종결 결정하기 →
          </button>
        </div>
      )}
      <Link
        href="/"
        className="text-sm text-slate-500 hover:text-slate-900 transition-colors"
      >
        ← 대시보드
      </Link>

      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 mt-3 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 leading-tight break-keep">
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
          <div className="flex gap-2 flex-wrap sm:shrink-0 items-center">
            <ShareButton jobId={Number(jobId)} jobTitle={job.title} />
            {(() => {
              const waitingCount = candidatesList.filter(
                (c) => c.stage === "round1_waiting"
              ).length;
              return (
                <button
                  onClick={openRound1Schedule}
                  disabled={waitingCount === 0 || scheduleLoading}
                  title={
                    waitingCount === 0
                      ? "1차 면접 일정이 확정된 대기 후보가 없습니다"
                      : "확정된 1차 면접 일정을 시간순으로 봅니다"
                  }
                  className="px-3 py-1.5 rounded-lg border border-primary/30 text-primary-deep hover:bg-primary-soft text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  🗓 1차 면접 일정{waitingCount > 0 ? ` (${waitingCount})` : ""}
                </button>
              );
            })()}
            <Link
              href={`/jobs/${jobId}/report`}
              className="px-3 py-1.5 rounded-lg border border-primary/30 text-primary-deep hover:bg-primary-soft text-sm font-medium"
              title="채용 결과 리포트 (인쇄/PDF 가능)"
            >
              📊 리포트
            </Link>
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
        {job.evaluationFocus && job.evaluationFocus.trim() && (
          <div className="mt-4 rounded-lg border border-accent/40 bg-accent-soft/30 px-4 py-3">
            <div className="flex items-baseline gap-2 mb-1.5">
              <span className="text-xs font-semibold text-accent-deep">
                🤖 AI 평가 가이드
              </span>
              <span className="text-[10px] text-ink-soft">
                HR 전용 · 후보자에게 비공개
              </span>
            </div>
            <p className="text-xs text-ink-soft whitespace-pre-wrap leading-relaxed">
              {job.evaluationFocus}
            </p>
          </div>
        )}
        <LifecyclePanel
          job={job}
          onChanged={() => void loadJob()}
          rightSlot={<InterviewersInline jobId={Number(jobId)} />}
        />
      </div>

      <FunnelPanel
        jobId={jobId}
        refreshKey={funnelKey}
        activeStage={stageFilter}
        onStageSelect={(s) => {
          setStageFilter(s as typeof stageFilter);
          // 단계 박스 클릭 시 결과 필터는 초기화 — 해당 단계 후보가 결과 필터에 가려지지 않게.
          setOutcomeFilter("all");
          // 목록이 펀널보다 한참 아래라 클릭 효과가 보이도록 스크롤.
          if (s !== "all")
            listTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
      />

      {/* 데스크톱: 동의 게이트 + 업로드 영역 (모바일 완전 숨김 — 업로드는 PC 전용) */}
      <div className="hidden sm:block">
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
            notify(await r.text(), { tone: "danger", title: "고지 확인 저장 실패" });
            return;
          }
          setConsentConfirmed(true);
        }}
        onRevoke={async () => {
          if (
            !(await confirmDialog(
              "고지 확인을 해제합니다.\n지원자에게 안내한 사실이 실제로 없었다면, 업로드한 모든 이력서를 검토·삭제하는 것이 권장됩니다.",
              { tone: "warn", title: "고지 확인 해제", confirmText: "해제" }
            ))
          )
            return;
          setConsentBusy(true);
          const r = await fetch(`/api/jobs/${jobId}/applicant-consent`, {
            method: "DELETE",
          });
          setConsentBusy(false);
          if (!r.ok) {
            notify(await r.text(), { tone: "danger", title: "해제 실패" });
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
          isExpired
            ? "border-slate-200 bg-slate-50 opacity-50 pointer-events-none"
            : uploading
              ? "border-slate-200 bg-slate-50 opacity-60 pointer-events-none"
              : !consentConfirmed
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
            disabled={uploading || !consentConfirmed || isExpired}
            className="text-sm font-medium text-slate-900 disabled:opacity-50 disabled:cursor-not-allowed"
            title={
              isExpired
                ? "공고 종결일이 지났습니다. 연장 후 업로드 가능"
                : !consentConfirmed
                  ? "먼저 AI 평가 적용 고지 확인을 완료해 주세요"
                  : ""
            }
          >
            {isExpired ? (
              "공고 종결일 경과 — 연장 후 업로드 가능"
            ) : uploading ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="w-4 h-4 rounded-full border-2 border-slate-300 border-t-primary animate-spin" />
                업로드 중...
              </span>
            ) : !consentConfirmed ? (
              "AI 평가 적용 고지 확인 후 업로드 가능"
            ) : (
              "파일을 끌어다 놓거나 클릭해 선택"
            )}
          </button>
          <button
            onClick={() => folderInputRef.current?.click()}
            disabled={uploading || !consentConfirmed || isExpired}
            className="text-xs text-slate-600 hover:text-primary hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
          >
            📁 폴더로 선택하기
          </button>
        </div>
        <ul className="text-xs text-slate-500 mt-3 space-y-1 text-left inline-block">
          <li>· PDF · DOCX · HWP · 이미지 · ZIP 지원</li>
          <li>· 여러 파일 한 번에, 폴더 드래그도 가능</li>
          <li>
            · 한 응시자에 이력서 + 포트폴리오를 함께 올리려면 응시자 이름 폴더로 묶어주세요
            <br />
            <span className="ml-2 font-mono text-[10px] text-slate-400">
              예) 홍길동/이력서.pdf, 홍길동/포트폴리오.pdf
            </span>
          </li>
        </ul>

        {uploadProgress && (
          <div className="mt-4 max-w-md mx-auto text-left">
            <div className="flex items-center justify-between text-xs font-medium text-slate-600 mb-1">
              <span>
                {uploadProgress.phase === "uploading"
                  ? `업로드 중… ${uploadProgress.done}/${uploadProgress.total} 파일`
                  : "후보자 등록 중… (분석은 백그라운드에서 계속됩니다)"}
              </span>
              <span className="tabular-nums">{uploadProgress.pct}%</span>
            </div>
            <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-200 ${
                  uploadProgress.phase === "processing"
                    ? "bg-primary animate-pulse"
                    : "bg-primary"
                }`}
                style={{ width: `${uploadProgress.pct}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5">
              업로드가 끝나면 카드가 바로 생기고, 이름·평가는 순차로 채워집니다. 창을 닫아도 분석은 계속됩니다.
            </p>
          </div>
        )}
      </div>
      </div>
      {/* /데스크톱 업로드 영역 */}

      {/* Tabs */}
      <div ref={listTopRef} className="flex gap-1 mt-8 border-b border-slate-200 scroll-mt-4">
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
          <option value="hired">최종 합격</option>
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
          className="hidden sm:block px-3 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm ml-auto"
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
              <div className="flex items-center gap-2 mb-2 px-1 flex-wrap">
                <input
                  type="checkbox"
                  checked={favoriteCandidates.every((c) => selected.has(c.id))}
                  onChange={() =>
                    toggleSection(favoriteCandidates.map((c) => c.id))
                  }
                  className="rounded border-slate-300"
                  title="전체 선택"
                />
                <span className="text-sm font-semibold text-amber-700">
                  ★ 즐겨찾기
                </span>
                <span className="text-xs text-amber-700/80">
                  ({favoriteCandidates.length}명)
                </span>
                {favoriteCandidates.some((c) => selected.has(c.id)) && (
                  <span className="text-xs text-primary-deep font-medium">
                    · {favoriteCandidates.filter((c) => selected.has(c.id)).length}명 선택됨
                  </span>
                )}
                {renderBulkActions(favoriteCandidates)}
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
                      className={`card-hover bg-white border-2 border-amber-300/60 rounded-xl p-4 pl-10 flex justify-between items-start gap-2 sm:gap-4 block ${stageGroupBorder(c.stage, c.outcome)} ${dimIfClosed(c.outcome)}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <CandidateFavoriteStar
                            candidateId={c.id}
                            initial={c.favorited}
                            onToggle={() => void loadCandidates()}
                          />
                          <span className="font-semibold text-slate-900">{c.name}</span>
                          {c.outcome !== "hired" && <StageBadge stage={c.stage} />}
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
                          {(c.educationLevel ||
                            c.educationSchool ||
                            c.educationMajor) && (
                            <span className="text-slate-600">
                              {[
                                c.educationSchool,
                                c.educationMajor,
                                c.educationLevel,
                              ]
                                .filter(Boolean)
                                .join(" ")}
                            </span>
                          )}
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
                          {formatKstDateTime(c.createdAt)} 업로드
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
              <div className="flex items-center gap-2 mb-2 px-1 flex-wrap">
                <input
                  type="checkbox"
                  checked={round1Candidates.every((c) => selected.has(c.id))}
                  onChange={() =>
                    toggleSection(round1Candidates.map((c) => c.id))
                  }
                  className="rounded border-slate-300"
                  title="전체 선택"
                />
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
                      className={`card-hover bg-card border-2 border-accent/60 rounded-xl p-4 pl-10 flex justify-between items-start gap-2 sm:gap-4 block ${stageGroupBorder(c.stage, c.outcome)} ${dimIfClosed(c.outcome)}`}
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
                          {c.outcome !== "hired" && <StageBadge stage={c.stage} />}
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
                          {(c.educationLevel ||
                            c.educationSchool ||
                            c.educationMajor) && (
                            <span className="text-slate-600">
                              {[
                                c.educationSchool,
                                c.educationMajor,
                                c.educationLevel,
                              ]
                                .filter(Boolean)
                                .join(" ")}
                            </span>
                          )}
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
                          {formatKstDateTime(c.createdAt)} 업로드
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
                  {hasSel && renderBulkActions(items)}
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
                        className={`card-hover bg-white border border-slate-200 rounded-xl p-4 pl-10 flex justify-between items-start gap-2 sm:gap-4 block ${stageGroupBorder(c.stage, c.outcome)} ${dimIfClosed(c.outcome)}`}
                      >
                        <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <CandidateFavoriteStar
                            candidateId={c.id}
                            initial={c.favorited}
                            onToggle={() => void loadCandidates()}
                          />
                          <span className="font-semibold text-slate-900">{c.name}</span>
                          {c.outcome !== "hired" && <StageBadge stage={c.stage} />}
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
                          {(c.educationLevel ||
                            c.educationSchool ||
                            c.educationMajor) && (
                            <span className="text-slate-600">
                              {[
                                c.educationSchool,
                                c.educationMajor,
                                c.educationLevel,
                              ]
                                .filter(Boolean)
                                .join(" ")}
                            </span>
                          )}
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
                          {formatKstDateTime(c.createdAt)} 업로드
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

      {bulkDecisionState && (
        <BulkDecisionModal
          decision={bulkDecisionState.decision}
          count={bulkDecisionState.ids.length}
          stages={candidatesList
            .filter((c) => bulkDecisionState.ids.includes(c.id))
            .map((c) => c.stage)}
          jobTitle={job?.title ?? "공고"}
          companyName={job?.companyName ?? null}
          busy={bulkBusy}
          onCancel={() => setBulkDecisionState(null)}
          onConfirm={(opts) => void runBulkDecision(opts)}
        />
      )}

      {round1Schedule && (
        <div
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          onClick={() => setRound1Schedule(null)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-2xl max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="font-bold text-slate-900">🗓 1차 면접 확정 일정</h3>
              <span className="text-xs text-slate-400">
                {round1Schedule.length}명 · 시간순
              </span>
            </div>
            {round1Schedule.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500 text-center py-6">
                확정된 1차 면접 일정이 없습니다.
              </p>
            ) : (
              <ol className="mt-4 space-y-2 overflow-y-auto">
                {groupRound1Schedule(round1Schedule).map((g, i) => (
                  <li
                    key={g.key}
                    className="flex items-start gap-3 border border-slate-200 rounded-xl p-3"
                  >
                    <span className="shrink-0 w-6 h-6 rounded-full bg-primary-soft text-primary-deep text-xs font-bold flex items-center justify-center mt-0.5">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-sm font-semibold text-slate-900 tabular-nums">
                          {fmtSlotRange(g.selectedSlot)}
                        </span>
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded ${
                            g.modeOnline
                              ? "bg-sky-100 text-sky-700"
                              : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {g.modeOnline ? "온라인" : "오프라인"}
                        </span>
                        {g.members.length > 1 && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                            {g.members.length}명
                          </span>
                        )}
                        {!g.modeOnline && g.address && (
                          <span className="text-xs text-slate-500">
                            {g.address}
                            {g.addressDetail ? ` ${g.addressDetail}` : ""}
                          </span>
                        )}
                      </div>
                      <ul className="mt-1.5 space-y-1">
                        {g.members.map((m) => (
                          <li
                            key={m.candidateId}
                            className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600"
                          >
                            <span className="font-medium text-slate-800">
                              {m.name}
                            </span>
                            {g.modeOnline && m.onlineMeetingUrl && (
                              <a
                                href={m.onlineMeetingUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary-deep underline break-all"
                              >
                                미팅 링크
                              </a>
                            )}
                            <Link
                              href={`/candidates/${m.candidateId}`}
                              className="text-slate-400 hover:text-primary-deep"
                            >
                              상세 →
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            <button
              onClick={() => setRound1Schedule(null)}
              className="mt-4 px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm hover:bg-slate-50 shrink-0"
            >
              닫기
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

/** 같은 시각·같은 방식(온/오프라인)·같은 장소의 일정을 하나로 묶음. */
type Round1ScheduleGroup = {
  key: string;
  selectedSlot: { start: string; end: string };
  modeOnline: boolean;
  address: string | null;
  addressDetail: string | null;
  members: Round1ScheduleItem[];
};

function groupRound1Schedule(
  items: Round1ScheduleItem[]
): Round1ScheduleGroup[] {
  const map = new Map<string, Round1ScheduleGroup>();
  for (const s of items) {
    const key = [
      s.selectedSlot.start,
      s.selectedSlot.end,
      s.modeOnline ? "on" : "off",
      s.address ?? "",
      s.addressDetail ?? "",
    ].join("|");
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        selectedSlot: s.selectedSlot,
        modeOnline: s.modeOnline,
        address: s.address,
        addressDetail: s.addressDetail,
        members: [],
      };
      map.set(key, g);
    }
    g.members.push(s);
  }
  // items 가 이미 시간순 → Map 삽입순(시간순) 유지.
  return Array.from(map.values());
}

/** 팝업용 슬롯 포맷 — "2026. 06. 03. (수) 13:30 ~ 14:30" (KST). */
function fmtSlotRange(slot: { start: string; end: string }): string {
  const s = new Date(slot.start);
  const e = new Date(slot.end);
  const datePart = s.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const endTime = e.toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${datePart} ~ ${endTime}`;
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

/**
 * 후보자 카드의 stage 그룹 색 — 깔때기(FunnelPanel) 그룹과 동일.
 * G1 서류(slate) / G2 AI면접(info) / G3 1차(accent) / G4 2차(primary)
 * G5 최종합격(primary deep) / 종결(danger·rose)
 *
 * 좌측 4px border 로 표시 → 어떤 단계 그룹인지 한눈에. 즐겨찾기 amber 외곽과 직교.
 */
/**
 * 종결된 후보(불합격·지원취소) 는 흐리게 표시 — 즐겨찾기·1차후보 섹션에서도 동일.
 * 합격은 그대로(강조 유지).
 */
function dimIfClosed(outcome: Candidate["outcome"]): string {
  if (outcome === "rejected" || outcome === "withdrawn")
    return "opacity-55 grayscale-[20%]";
  return "";
}

function stageGroupBorder(
  stage: Candidate["stage"],
  outcome: Candidate["outcome"]
): string {
  if (outcome === "rejected" || outcome === "withdrawn")
    return "border-l-4 border-l-danger/60";
  if (stage === "hired" || outcome === "hired")
    return "border-l-4 border-l-primary";
  if (stage === "round2_passed") return "border-l-4 border-l-primary";
  if (
    stage === "round1_candidate" ||
    stage === "round1_scheduling" ||
    stage === "round1_waiting" ||
    stage === "round1_passed"
  )
    return "border-l-4 border-l-accent";
  if (stage === "ai_pending" || stage === "ai_evaluated")
    return "border-l-4 border-l-info";
  // applied · screened
  return "border-l-4 border-l-slate-400";
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
  // 파싱 전(분석 중) — 활성 큐인데 아직 텍스트 추출·마스킹이 안 끝난 상태.
  // 업로드 직후 껍데기 카드가 이 상태로 뜬다 (이름은 파일명 기반).
  if (
    (c.queueStatus === "queued" || c.queueStatus === "processing") &&
    !c.parsed
  ) {
    return (
      <div className="shrink-0 px-2.5 py-1 rounded-md bg-sky-50 text-sky-700 border border-sky-200 text-xs font-medium flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" />
        분석 중
      </div>
    );
  }
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
          {isBackoff ? `재시도 대기 (${c.queueAttempts}회 시도)` : "대기중"}
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
  // 잔액 0 이하로 일시정지 — 충전되면 워커가 자동 재개 (재시도 버튼 불필요).
  if (c.lastJobStatus === "paused") {
    return (
      <div
        className="shrink-0 px-2.5 py-1 rounded-md bg-amber-50 text-amber-700 border border-amber-200 text-xs font-medium flex items-center gap-1.5"
        title="토큰 잔액이 부족해 평가가 보류되었습니다. 충전하면 자동으로 재개됩니다."
      >
        💳 충전 대기
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
    <div className="shrink-0 grid grid-cols-3 gap-1.5 sm:gap-3 text-center min-w-[108px] sm:min-w-[200px]">
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
          className={`text-base sm:text-xl font-bold leading-tight ${
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
  /** 결정되지 않은(outcome IS NULL) 후보만 stage 별 카운트. "오늘 결정할 일" 계산용. */
  pendingByStage: Record<string, number>;
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
      <ScheduleProposeModal
        jobId={jobId}
        candidateIds={selectedIds}
        open={open}
        onClose={() => setOpen(false)}
        onDone={onDone}
      />
    </>
  );
}

type MemberResult = {
  userId: number;
  email: string;
  name: string;
  status: "assigned" | "already_assigned" | "skipped_other_org" | "failed";
  error?: string;
};

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
  const [members, setMembers] = useState<
    { id: number; email: string; name: string; role: string }[]
  >([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<number>>(
    new Set()
  );
  const [memberLoading, setMemberLoading] = useState(false);
  const [results, setResults] = useState<
    | {
        results: {
          email: string;
          status: "sent" | "already_member" | "failed";
          error?: string;
        }[];
        memberResults: MemberResult[];
        invalidInputs: string[];
      }
    | null
  >(null);
  const [err, setErr] = useState("");

  // 모달 열릴 때 같은 법인 멤버 로드 (본인 제외, disabled 제외).
  // /api/orgs/members 는 org_admin/system_admin 만 허용 — member 는 403 받고 빈 목록.
  useEffect(() => {
    if (!open) return;
    setMemberLoading(true);
    Promise.all([
      fetch("/api/orgs/members").then((r) =>
        r.ok ? r.json() : Promise.resolve([])
      ),
      fetch("/api/auth/status").then((r) =>
        r.ok ? r.json() : Promise.resolve({ user: null })
      ),
    ])
      .then(([list, status]) => {
        const rows = Array.isArray(list)
          ? (list as {
              id: number;
              email: string;
              name: string;
              role: string;
              status?: string;
            }[])
          : [];
        const myId = status?.user?.id ?? null;
        setMembers(
          rows
            .filter((m) => m.id !== myId && m.status !== "disabled")
            .map((m) => ({
              id: m.id,
              email: m.email,
              name: m.name,
              role: m.role,
            }))
        );
      })
      .catch(() => setMembers([]))
      .finally(() => setMemberLoading(false));
  }, [open]);

  const toggleMember = (id: number) => {
    setSelectedMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    setBusy(true);
    setErr("");
    setResults(null);
    const r = await fetch(`/api/jobs/${jobId}/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        emails,
        memberIds: Array.from(selectedMemberIds),
      }),
    });
    setBusy(false);
    if (!r.ok) {
      const t = await r.text();
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
    setResults({
      results: data.results ?? [],
      memberResults: data.memberResults ?? [],
      invalidInputs: data.invalidInputs ?? [],
    });
  };

  const close = () => {
    setOpen(false);
    setEmails("");
    setSelectedMemberIds(new Set());
    setErr("");
    setResults(null);
  };

  const canSubmit =
    !busy && (emails.trim().length > 0 || selectedMemberIds.size > 0);

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
                {/* 법인 멤버 선택 — 선택 시 면접관 자동 추가 + 알림 메일 */}
                <div className="mt-4">
                  <div className="flex items-baseline justify-between mb-1.5">
                    <span className="text-xs font-semibold text-slate-700">
                      법인 멤버 선택 (면접관으로 자동 추가)
                    </span>
                    {selectedMemberIds.size > 0 && (
                      <span className="text-[11px] text-primary-deep font-medium">
                        {selectedMemberIds.size}명 선택됨
                      </span>
                    )}
                  </div>
                  {memberLoading ? (
                    <div className="text-xs text-slate-400 py-3 px-3 border border-dashed border-slate-200 rounded-lg">
                      멤버 목록 불러오는 중...
                    </div>
                  ) : members.length === 0 ? (
                    <div className="text-xs text-slate-400 py-3 px-3 border border-dashed border-slate-200 rounded-lg">
                      선택 가능한 법인 멤버가 없습니다.
                    </div>
                  ) : (
                    <ul className="max-h-40 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                      {members.map((m) => {
                        const checked = selectedMemberIds.has(m.id);
                        return (
                          <li key={m.id}>
                            <label className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleMember(m.id)}
                                className="w-4 h-4 rounded border-slate-300 accent-primary"
                              />
                              <span className="flex-1 min-w-0">
                                <span className="text-sm font-medium text-slate-900 truncate block">
                                  {m.name}
                                </span>
                                <span className="text-[11px] text-slate-500 truncate block">
                                  {m.email}
                                </span>
                              </span>
                              {m.role !== "member" && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary-soft text-primary-deep font-medium">
                                  {m.role === "system_admin" ? "최고관리자" : "관리자"}
                                </span>
                              )}
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                <label className="block mt-4">
                  <span className="text-xs font-semibold text-slate-700">
                    외부 이메일로 공유 (콤마{" "}
                    <code className="font-mono bg-slate-100 px-1 rounded">,</code>{" "}
                    또는 세미콜론{" "}
                    <code className="font-mono bg-slate-100 px-1 rounded">;</code>{" "}
                    구분, 최대 20명)
                  </span>
                  <textarea
                    value={emails}
                    onChange={(e) => setEmails(e.target.value)}
                    rows={3}
                    placeholder={'alice@example.com, bob@example.com; carol@example.com'}
                    className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary font-mono"
                  />
                </label>
                <p className="text-[11px] text-slate-500 mt-2 bg-primary-soft border border-primary/30 rounded-lg p-2">
                  📨 법인 멤버 — 면접관으로 자동 추가됩니다. 외부 이메일 — 1회용 링크(7일)로 공유, 클릭 시 자동 합류.
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
                    disabled={!canSubmit}
                    className="flex-1 px-4 py-2 rounded-lg bg-primary hover:bg-primary-deep text-surface text-sm font-medium disabled:opacity-50 transition-colors"
                  >
                    {busy ? "발송 중..." : "공유"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="mt-4 space-y-2 max-h-[40vh] overflow-y-auto text-xs">
                  {results.memberResults.length > 0 && (
                    <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold pt-1">
                      법인 멤버
                    </div>
                  )}
                  {results.memberResults.map((m) => (
                    <div
                      key={`m-${m.userId}`}
                      className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border ${
                        m.status === "assigned"
                          ? "bg-primary-soft border-primary/30 text-primary-deep"
                          : m.status === "already_assigned"
                            ? "bg-surface-alt border-border-default text-ink-soft"
                            : m.status === "skipped_other_org"
                              ? "bg-amber-50 border-amber-200 text-amber-700"
                              : "bg-danger-soft border-danger/30 text-danger"
                      }`}
                    >
                      <span className="truncate">
                        {m.name} <span className="opacity-60">({m.email})</span>
                      </span>
                      <span className="shrink-0 font-medium">
                        {m.status === "assigned"
                          ? "✓ 면접관 추가 + 메일 발송"
                          : m.status === "already_assigned"
                            ? "이미 면접관 (메일만 발송)"
                            : m.status === "skipped_other_org"
                              ? "타 법인 — 스킵"
                              : "✗ 실패"}
                      </span>
                    </div>
                  ))}
                  {results.results.length > 0 && (
                    <div className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold pt-2">
                      외부 이메일
                    </div>
                  )}
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

function LifecyclePanel({
  job,
  onChanged,
  rightSlot,
}: {
  job: Job;
  onChanged: () => void;
  rightSlot?: React.ReactNode;
}) {
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
      notify(data?.message ?? "연장 실패", { tone: "danger", title: "연장 실패" });
      return;
    }
    notify(
      `공고를 ${data.extensionDays ?? 30}일 연장했습니다. (${data.totalCost} 토큰 차감)`,
      { tone: "success", title: "공고 연장 완료" }
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
        <div className="flex items-center gap-3 flex-wrap justify-end">
          {status === "active" && dLeft != null && dLeft <= 14 && (
            <button
              onClick={openExtend}
              className="px-3 py-1.5 rounded-lg border border-primary/30 text-primary-deep hover:bg-primary-soft text-sm"
            >
              공고 연장
            </button>
          )}
          {rightSlot}
        </div>
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

/** 헤더 우측 하단 컴팩트 면접관 표시 — 이름 칩 + "면접관 지정"(나를 추가) 버튼. */
function InterviewersInline({ jobId }: { jobId: number }) {
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
    const r = await fetch(`/api/jobs/${jobId}/interviewers`, { method: "POST" });
    setBusy(false);
    if (!r.ok) {
      notify(await r.text(), { tone: "danger", title: "면접관 지정 실패" });
      return;
    }
    void load();
  };

  const remove = async (userId: number, name: string) => {
    if (
      !(await confirmDialog(`${name} 님을 면접관에서 제외할까요?`, {
        tone: "danger",
        title: "면접관 제외",
        confirmText: "제외",
      }))
    )
      return;
    setBusy(true);
    const r = await fetch(`/api/jobs/${jobId}/interviewers?userId=${userId}`, {
      method: "DELETE",
    });
    setBusy(false);
    if (!r.ok) {
      notify(await r.text(), { tone: "danger", title: "제외 실패" });
      return;
    }
    void load();
  };

  if (!data) return null;

  return (
    <div className="flex items-center flex-wrap justify-end gap-1.5 text-xs">
      <span className="text-slate-400">면접관</span>
      {data.interviewers.length === 0 ? (
        <span className="text-slate-400">미지정</span>
      ) : (
        data.interviewers.map((r) => (
          <span
            key={r.userId}
            title={r.email}
            className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-slate-100 text-slate-700"
          >
            {r.name}
            <button
              onClick={() => remove(r.userId, r.name)}
              disabled={busy}
              className="text-slate-400 hover:text-danger disabled:opacity-50 leading-none"
              title="면접관에서 제외"
            >
              ✕
            </button>
          </span>
        ))
      )}
      {!data.me.isInterviewer && (
        <button
          onClick={selfAssign}
          disabled={busy}
          className="px-2 py-0.5 rounded-full border border-primary/40 text-primary-deep hover:bg-primary-soft font-medium disabled:opacity-50"
          title="나를 이 공고의 면접관으로 지정"
        >
          {busy ? "처리 중…" : "+ 면접관 지정"}
        </button>
      )}
    </div>
  );
}

/**
 * 합·불 일괄 처리 모달 — 사유(선택) + 통보 메일 발송 여부 + 맞춤 메시지.
 * 개별 결정(DecisionMenu)과 동일한 입력을 일괄 처리에도 제공한다.
 * 사유 라벨은 서버 전용 모듈(candidate-stage) 의존을 피하려 로컬에 둔다.
 */
function BulkDecisionModal({
  decision,
  count,
  stages,
  jobTitle,
  companyName,
  busy,
  onCancel,
  onConfirm,
}: {
  decision: "hired" | "rejected";
  count: number;
  stages: string[];
  jobTitle: string;
  companyName?: string | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (opts: {
    reason: string;
    sendMail: boolean;
    customMessage: string;
  }) => void;
}) {
  const label = decision === "hired" ? "최종합격" : "불합격";
  const isReject = decision === "rejected";
  const reasonOptions = isReject
    ? [
        { value: "resume_unfit", label: "서류 부적합" },
        { value: "ai_interview_unfit", label: "AI면접 평가 부적합" },
        { value: "round1_unfit", label: "1차 면접 부적합" },
        { value: "round2_unfit", label: "2차 면접 부적합" },
        { value: "offer_declined", label: "처우협의 결렬" },
        { value: "other", label: "기타" },
      ]
    : [{ value: "passed_final", label: "최종 합격 결정" }];
  // 전형(stage)별 기본 불합격 사유 — 선택 후보들의 stage 중 가장 많은 단계 기준 자동 선택.
  const reasonForStage = (s: string): string =>
    s === "applied" || s === "screened"
      ? "resume_unfit"
      : s === "ai_pending" || s === "ai_evaluated"
      ? "ai_interview_unfit"
      : s.startsWith("round1")
      ? "round1_unfit"
      : s === "round2_passed"
      ? "round2_unfit"
      : "other";
  const autoReason = (() => {
    if (!isReject) return "passed_final";
    const counts: Record<string, number> = {};
    for (const s of stages) {
      const r = reasonForStage(s);
      counts[r] = (counts[r] ?? 0) + 1;
    }
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return top ? top[0] : "";
  })();
  // 기본 통보 메일 템플릿 — {이름} 은 발송 시 각 지원자 이름으로 치환된다.
  // (lib/candidate-stage.ts 의 buildDecisionEmail 기본 본문과 동일하게 유지)
  const coName = companyName?.trim() ?? "";
  const co = coName && !jobTitle.includes(coName) ? `${coName} ` : "";
  const defaultBody =
    decision === "hired"
      ? `{이름}님, ${co}${jobTitle} 포지션 최종 합격을 진심으로 축하드립니다.\n\n곧 채용 담당자가 별도로 연락드려 입사 절차를 안내해 드릴 예정입니다.\n감사합니다.`
      : `{이름}님, ${co}${jobTitle} 포지션에 지원해 주셔서 진심으로 감사드립니다.\n\n신중히 검토한 결과, 이번 채용에서는 함께하기 어렵게 되었음을 안내드립니다. 좋은 인연으로 다시 만날 기회가 있기를 기대하며, 앞으로의 여정에 좋은 결과 있으시기를 응원합니다.`;
  const [reason, setReason] = useState<string>(autoReason);
  const [sendMail, setSendMail] = useState(false);
  const [customMessage, setCustomMessage] = useState(defaultBody);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="bg-card rounded-xl shadow-xl border border-border-default w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold text-ink mb-1">{label} 일괄 처리</h3>
        <p className="text-sm text-ink-soft">
          선택된 <strong className="text-ink">{count}</strong>명을 "{label}"으로
          일괄 처리합니다.
        </p>

        <div className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 leading-relaxed">
          {isReject
            ? "⚠️ 종결 결정입니다. 이력서 원본·첨부 파일은 즉시 폐기되고, 공고 종결 +14일 후 후보자 정보 전체가 자동 삭제됩니다."
            : "⚠️ 종결 결정입니다. 최종합격으로 처리되며, 이력서·첨부 파일은 입사 절차를 위해 보존됩니다."}
        </div>

        <div className="mt-4">
          <label className="block text-xs font-semibold text-ink-soft mb-1.5">
            {label} 사유 (선택)
          </label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
            className="w-full px-3 py-2 text-sm border border-border-default rounded-lg bg-card focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
          >
            {isReject && <option value="">선택 안 함</option>}
            {reasonOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <label className="mt-4 flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={sendMail}
            onChange={(e) => setSendMail(e.target.checked)}
            disabled={busy}
            className="mt-0.5 w-4 h-4 rounded border-border-default"
          />
          <span className="text-sm text-ink">
            {label} 통보 메일 발송
            <span className="block text-[11px] text-ink-soft">
              이메일이 등록된 후보자에게만 발송됩니다.
            </span>
          </span>
        </label>
        {sendMail && (
          <div className="mt-2">
            <p className="text-[11px] text-ink-soft mb-1">
              아래 내용으로 발송됩니다.{" "}
              <code className="px-1 rounded bg-surface-alt">{"{이름}"}</code> 자리에
              각 지원자 이름이 자동으로 들어갑니다. 직접 수정할 수 있어요.
            </p>
            <textarea
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              rows={8}
              disabled={busy}
              placeholder="통보 메일 본문"
              className="w-full px-3 py-2 text-sm border border-border-default rounded-lg bg-card focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
            />
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 rounded-lg border border-border-default text-sm text-ink-soft hover:bg-surface-alt disabled:opacity-50"
          >
            취소
          </button>
          <button
            onClick={() => onConfirm({ reason, sendMail, customMessage })}
            disabled={busy}
            className={`px-4 py-2 rounded-lg text-sm font-medium text-surface disabled:opacity-50 ${
              isReject
                ? "bg-danger hover:bg-danger/90"
                : "bg-primary hover:bg-primary-deep"
            }`}
          >
            {busy ? "처리 중..." : `${label} 처리`}
          </button>
        </div>
      </div>
    </div>
  );
}

function FunnelPanel({
  jobId,
  refreshKey,
  activeStage,
  onStageSelect,
}: {
  jobId: string;
  refreshKey: number;
  activeStage?: string;
  onStageSelect?: (stage: string) => void;
}) {
  const [data, setData] = useState<Funnel | null>(null);

  useEffect(() => {
    void fetch(`/api/jobs/${jobId}/funnel`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d));
  }, [jobId, refreshKey]);

  if (!data || data.total === 0) return null;

  // 전형 단계 — 1줄 표시. 그룹별 색 묶음:
  //   G1 스크리닝(지원·서류) / G2 AI면접(대기·평가) / G3 1차(후보·스케쥴·대기·합격) / G4 2차 / G5 최종
  // 그룹별 색상 토큰 — 후보자 카드 좌측 색띠와 동일.
  // active: 값이 있는 셀(테두리 진하고 배경 살짝), empty: 값 0인 셀(테두리만 옅게).
  type PipelineCell = {
    stage: string;
    label: string;
    group: 1 | 2 | 3 | 4 | 5;
    active: string;
    empty: string;
  };
  const pipelineCells: PipelineCell[] = [
    {
      stage: "applied",
      label: "지원",
      group: 1,
      active: "border-slate-400 bg-slate-50 text-slate-700",
      empty: "border-slate-200 text-slate-300",
    },
    {
      stage: "screened",
      label: "서류평가",
      group: 1,
      active: "border-slate-400 bg-slate-50 text-slate-700",
      empty: "border-slate-200 text-slate-300",
    },
    {
      stage: "ai_pending",
      label: "AI면접·대기",
      group: 2,
      active: "border-info bg-info-soft text-info",
      empty: "border-info/30 text-info/40",
    },
    {
      stage: "ai_evaluated",
      label: "AI면접·평가",
      group: 2,
      active: "border-info bg-info-soft text-info",
      empty: "border-info/30 text-info/40",
    },
    {
      stage: "round1_candidate",
      label: "1차·후보",
      group: 3,
      active: "border-accent bg-accent-soft text-accent-deep",
      empty: "border-accent/30 text-accent/40",
    },
    {
      stage: "round1_scheduling",
      label: "1차·스케쥴",
      group: 3,
      active: "border-accent bg-accent-soft text-accent-deep",
      empty: "border-accent/30 text-accent/40",
    },
    {
      stage: "round1_waiting",
      label: "1차·대기",
      group: 3,
      active: "border-accent bg-accent-soft text-accent-deep",
      empty: "border-accent/30 text-accent/40",
    },
    {
      stage: "round1_passed",
      label: "1차 합격",
      group: 3,
      active: "border-accent bg-accent-soft text-accent-deep",
      empty: "border-accent/30 text-accent/40",
    },
    {
      stage: "round2_passed",
      label: "2차 합격",
      group: 4,
      active: "border-primary bg-primary-soft text-primary-deep",
      empty: "border-primary/30 text-primary/40",
    },
    {
      stage: "hired",
      label: "최종 합격",
      group: 5,
      active: "border-primary bg-primary text-surface",
      empty: "border-primary/40 text-primary/50",
    },
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

  // -- "오늘 결정할 일" — HR 액션이 필요한 단계 집계 -------------------------
  // pendingByStage(outcome IS NULL 만) 사용 — 이미 종결된 후보는 카운트에서 제외.
  const pending = data.pendingByStage ?? {};
  const actionItems: { stage: string; label: string; count: number; tone: string }[] = [
    {
      stage: "screened",
      label: "서류평가 후 면접 진행 결정",
      count: pending["screened"] ?? 0,
      tone: "bg-primary-soft text-primary-deep border-primary/30 hover:bg-primary-soft/70",
    },
    {
      stage: "ai_evaluated",
      label: "AI 면접 후 합·불 결정",
      count: pending["ai_evaluated"] ?? 0,
      tone: "bg-accent-soft text-accent-deep border-accent/40 hover:bg-accent-soft/70",
    },
    {
      stage: "round1_candidate",
      label: "1차 면접 일정 제시",
      count: pending["round1_candidate"] ?? 0,
      tone: "bg-primary-soft text-primary-deep border-primary/30 hover:bg-primary-soft/70",
    },
    {
      stage: "round1_passed",
      label: "2차 면접 진행 결정",
      count: pending["round1_passed"] ?? 0,
      tone: "bg-accent-soft text-accent-deep border-accent/40 hover:bg-accent-soft/70",
    },
    {
      stage: "round2_passed",
      label: "최종합격 결정",
      count: pending["round2_passed"] ?? 0,
      tone: "bg-warning-soft text-warning border-warning/30 hover:bg-warning-soft/70",
    },
  ].filter((x) => x.count > 0);
  const actionTotal = actionItems.reduce((s, x) => s + x.count, 0);

  return (
    <div className="mt-4 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
      {/* 🔔 오늘 결정할 일 — 인사담당이 처리해야 할 단계 */}
      {actionTotal > 0 && (
        <div className="mb-4 rounded-xl border border-primary/25 bg-primary-soft/40 p-3">
          <div className="text-[11px] font-semibold text-primary-deep uppercase tracking-wider mb-2 flex items-center gap-1.5">
            🔔 오늘 결정할 일
            <span className="text-ink-soft font-medium normal-case tracking-normal">
              총 {actionTotal}건 — 클릭하면 해당 단계 후보자만 표시됩니다
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {actionItems.map((a) => (
              <a
                key={a.stage}
                href={`?stage=${a.stage}`}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${a.tone}`}
              >
                <span>{a.label}</span>
                <span className="font-bold tabular-nums">{a.count}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-baseline justify-between mb-2 gap-3 flex-wrap">
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

      {/* 파이프라인 — 데스크톱은 1줄 꽉 채움(flex-1), 모바일은 가로 스크롤(셀 최소폭 유지). */}
      <div className="flex items-stretch gap-0.5 pb-2 overflow-x-auto sm:overflow-visible -mx-1 px-1">
        {pipelineCells.map((cell, i) => {
          const n = data.stages[cell.stage] ?? 0;
          const next = pipelineCells[i + 1];
          const isGroupBoundary = next && next.group !== cell.group;
          return (
            <div
              key={cell.stage}
              className="flex items-center gap-0.5 shrink-0 sm:shrink sm:flex-1 min-w-[62px] sm:min-w-0"
            >
              <button
                type="button"
                onClick={() =>
                  onStageSelect?.(
                    activeStage === cell.stage ? "all" : cell.stage
                  )
                }
                title={
                  activeStage === cell.stage
                    ? `${cell.label} 필터 해제`
                    : `${cell.label} 단계만 보기`
                }
                className={`rounded-md text-center flex-1 min-w-0 cursor-pointer transition hover:shadow-sm hover:brightness-95 ${
                  n > 0 ? cell.active : cell.empty
                } ${
                  activeStage === cell.stage
                    ? "border-4 px-0.5 py-1"
                    : "border-2 px-1 py-1.5"
                }`}
              >
                <div className="text-[10px] tracking-wider opacity-80 truncate">
                  {cell.label}
                </div>
                <div className="text-base font-bold mt-0.5 tabular-nums">
                  {n}
                </div>
              </button>
              {i < pipelineCells.length - 1 && (
                <span
                  className={`text-[10px] shrink-0 ${
                    isGroupBoundary
                      ? "text-slate-400 px-0.5"
                      : "text-slate-300"
                  }`}
                >
                  {isGroupBoundary ? "▶" : "▸"}
                </span>
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

    </div>
  );
}

