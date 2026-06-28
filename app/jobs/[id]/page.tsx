"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { upload } from "@vercel/blob/client";
import { JobExpiredDecisionModal } from "@/app/components/JobExpiredDecisionModal";
import { notify, confirmDialog } from "@/app/components/Dialog";
import Link from "next/link";
import { compositeScore, formatKstDateTime } from "@/lib/utils";
import { isEncryptedZipFile } from "@/lib/zip-encrypted-client";
import {
  Loader2,
  CalendarClock,
  BarChart3,
  Check,
  Download,
  Folder,
  Mail,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  Inbox,
  UserCheck,
  X,
} from "lucide-react";
import {
  STAGE_LABELS,
  STAGE_GROUPS,
  STAGE_GROUP_LABELS,
} from "@/lib/stage-meta";
import {
  deriveCandidateState,
  GROUP_ORDER,
  GROUP_META,
  isHrGroup,
  matchesWaiterFilter,
  STAGE_BUCKET,
  WAITER_FILTER_META,
  type GroupKey,
  type WaiterFilter,
} from "@/lib/candidate-state";
import { STAGE_RANK, Tag } from "./badges";
import { CandidateCard } from "./candidate-card";
import ApplyLinkButton from "./ApplyLinkButton";
import ApplyIntakeBanner from "./ApplyIntakeBanner";
import { McqPanel } from "./mcq-panel";
import { BulkDecisionModal, SchedulePropose } from "./bulk-actions";
import { candidateSearchExtras } from "./candidate-scores";
import { ApplicantConsentGate } from "./consent-gate";
import { FunnelPanel } from "./funnel-panel";
import { InterviewersInline, LifecyclePanel } from "./lifecycle-panel";
import { fmtSlotRange, groupRound1Schedule } from "./round1-schedule";
import { ShareButton } from "./share-button";
import { UnlockPanel } from "./unlock-panel";
import type { Candidate, Job, Round1ScheduleItem } from "./types";

// 후보 목록 폴링 (ms) — 가벼운 "변경 버전(rev)" 만 이 주기로 확인하고, rev 가 바뀐 경우에만
// 전체 목록을 조회한다(변경 감지 후 상세 조회). 트리거가 못 잡는 변화(타 법인 큐 순번 등)
// 대비로, 변화가 없어도 SAFETY 주기마다 1회는 강제로 전체 조회한다(안전망).
const CAND_POLL_INTERVAL = 4000;
const CAND_FULL_SAFETY_MS = 30000;

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const jobId = params.id;
  const [job, setJob] = useState<Job | null>(null);
  const [candidatesList, setCandidatesList] = useState<Candidate[]>([]);
  // 후보 목록 첫 로드 완료 여부 — "아직 로딩 중(0)" 과 "정말 0명" 을 구분(빈 상태 히어로 게이트).
  const [candidatesLoaded, setCandidatesLoaded] = useState(false);
  // 이력서 받기 드로어 열림 상태 — 후보 1명 이상일 때 헤더 버튼으로 연다. 0명이면 인라인 히어로로 대체.
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  // 업로드 진행 상태 — null=비활성. phase: 'uploading'(파일 전송) → 'processing'(서버 등록).
  const [uploadProgress, setUploadProgress] = useState<{
    phase: "uploading" | "processing";
    pct: number;
    done: number;
    total: number;
  } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [locked, setLocked] = useState<{ title: string } | null>(null);
  const [loadError, setLoadError] = useState<"not_found" | "failed" | null>(null);
  const [search, setSearch] = useState("");
  // 불합격 통보 미발송 안내 배너 — 닫은 시점의 미발송 명단 시그니처(공고별 localStorage).
  // 현재 명단과 같으면 숨기고, 새 불합격 미발송이 생겨 명단이 바뀌면 다시 표시한다.
  const [rejectBannerDismissedSig, setRejectBannerDismissedSig] = useState<
    string | null
  >(null);
  // 만료 결정 모달 — 닫아도 페이지 상단 띠는 유지. 다시 열기 가능.
  const [expiredModalDismissed, setExpiredModalDismissed] = useState(false);
  // 단일 필터 — 칩·드롭다운·펀널 박스가 전부 이 하나의 상태를 공유한다.
  // 조합 없음: 어디서든 새로 선택하면 이전 필터를 대체 (리셋 비용 제거).
  // 딥링크: ?stage=(stage·pseudo·bucket·outcome) / ?focus=(대기주체) 모두 이 상태로 수렴.
  type FilterValue =
    | "all"
    | Exclude<WaiterFilter, "all"> // 대기주체 칩 (hr/candidate/interviewer/system/closed)
    | "in_progress"
    | "hired"
    | "rejected"
    | "withdrawn"
    | Candidate["stage"] // 세부 단계 (대시보드 딥링크 호환)
    | "counter_proposed"
    | "ai_link_expired"
    | "result_due"
    | "resume_action"
    | "bucket_resume"
    | "bucket_ai"
    | "bucket_round1"
    | "bucket_round2";
  const [filter, setFilter] = useState<FilterValue>(() => {
    const f = searchParams.get("focus");
    if (f && ["hr", "candidate", "interviewer", "system", "closed"].includes(f))
      return f as FilterValue;
    const s = searchParams.get("stage");
    if (s) return s as FilterValue;
    return "all";
  });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // 실행 중인 일괄 액션 이름 — 해당 버튼만 스피너 표시 (null 이면 유휴)
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
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
  // "AI 이력서 평가 없이 진행" — 동의(고지)를 못 받은 경우 서류 AI평가를 끄고 업로드 허용.
  // true 면: 동의 attest 없이도 업로드 가능 + 업로드된 이력서는 AI 평가 큐에 안 들어감.
  const [aiScreeningDisabled, setAiScreeningDisabled] = useState(false);
  // 업로드 가능 조건 — 동의 확인됨 OR AI 서류평가 끔.
  const canUpload = consentConfirmed || aiScreeningDisabled;
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
      const j = (await r.json()) as Job & {
        applicantConsentConfirmedAt?: string | null;
        aiScreeningDisabled?: boolean;
      };
      setJob(j);
      setConsentConfirmed(!!j.applicantConsentConfirmedAt);
      setAiScreeningDisabled(!!j.aiScreeningDisabled);
    } catch {
      setLoadError("failed");
    }
  };
  const [funnelKey, setFunnelKey] = useState(0);
  // 직전 응답 원문 — 내용이 같으면 setState 를 생략해 전체 리렌더
  // (후보 수백 명 카드 + 파생 계산) + 펀널 refetch 를 유발하지 않게 한다.
  const lastCandidatesJsonRef = useRef("");
  // 마지막으로 확인한 변경 시그니처(최대 updated_at) 와 마지막 전체 조회 시각 — 폴링 루프가 사용.
  const lastSigRef = useRef<string | null>(null);
  const lastFullAtRef = useRef(0);
  const loadCandidates = useCallback(async () => {
    const r = await fetch(`/api/jobs/${jobId}/candidates`);
    if (!r.ok) return;
    setCandidatesLoaded(true);
    const text = await r.text();
    // 전체 조회를 했으면(직접 호출 포함) 안전망 타이머를 리셋한다.
    lastFullAtRef.current = Date.now();
    if (text === lastCandidatesJsonRef.current) return;
    lastCandidatesJsonRef.current = text;
    setCandidatesList(JSON.parse(text));
    // 후보자 목록이 갱신되면 깔때기도 갱신 (stage 변경·삭제·신규 업로드 모두 커버)
    setFunnelKey((k) => k + 1);
  }, [jobId]);
  useEffect(() => {
    void loadJob();
    // 변경 시그니처(최대 updated_at) 만 가볍게 확인 — 실패하면 null(이번 주기는 보수적으로 전체 조회).
    const fetchSig = async (): Promise<string | null> => {
      try {
        const r = await fetch(`/api/jobs/${jobId}/candidates/version`);
        if (!r.ok) return null;
        const d = (await r.json()) as { sig?: string };
        return typeof d.sig === "string" ? d.sig : null;
      } catch {
        return null;
      }
    };
    // 초기 1회: 현재 시그니처를 기록하고 전체 목록을 받는다.
    void (async () => {
      lastSigRef.current = await fetchSig();
      await loadCandidates();
    })();
    // 가벼운 시그니처만 주기적으로 확인 — 값이 바뀌었을 때(변화 발생)만 전체 조회.
    // 같은 초 경계 등으로 못 잡는 변화 대비 안전망: 변화가 없어도 SAFETY 주기마다 1회는 강제 전체 조회.
    // 백그라운드 탭에서는 폴링 중단 — 복귀 시 visibilitychange 가 즉시 1회 갱신.
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (!locked && document.visibilityState === "visible") {
        const sig = await fetchSig();
        const changed = sig === null || sig !== lastSigRef.current;
        const safetyDue =
          Date.now() - lastFullAtRef.current >= CAND_FULL_SAFETY_MS;
        if (changed || safetyDue) {
          lastSigRef.current = sig;
          await loadCandidates();
        }
      }
      timer = setTimeout(tick, CAND_POLL_INTERVAL);
    };
    timer = setTimeout(tick, CAND_POLL_INTERVAL);
    const onVisible = () => {
      if (!locked && document.visibilityState === "visible") void loadCandidates();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, locked]);

  // 불합격 통보 미발송 배너 — 공고별 닫힘 상태 복원(localStorage). 공고 전환 시 갱신.
  useEffect(() => {
    try {
      setRejectBannerDismissedSig(
        localStorage.getItem(`iv_reject_banner_dismissed_${jobId}`)
      );
    } catch {
      setRejectBannerDismissedSig(null);
    }
  }, [jobId]);

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
    // 지원자 동의 확인 가드 — 서버에서도 게이트하지만 UX 위해 사전 차단.
    // 단, "AI 이력서 평가 없이 진행"(aiScreeningDisabled)이면 §37의2 고지가 불요라 통과.
    if (!consentConfirmed && !aiScreeningDisabled) {
      notify(
        "이력서를 업로드하기 전, 지원자에게 'AI 평가 적용 + 거부 시 일반 절차 가능' 을 안내하셨는지 체크박스로 확인해 주세요.\n\n표준 안내 문구는 '자세히' 링크에서 확인할 수 있습니다.",
        { tone: "warn", title: "AI 평가 적용 고지 확인 필요" }
      );
      return;
    }
    // 사전 크기 검증 — 서버 도달 전 차단
    const MB = 1024 * 1024;
    const MAX_ZIP = 100 * MB; // ZIP 컨테이너 하드 한도
    const MAX_FILE = 10 * MB; // 개별 파일 한도 — 초과 시 해당 파일만 제외 (동영상 삽입된 PPT 등)
    const MAX_TOTAL = 100 * MB;

    // ZIP 이 하드 한도를 넘으면 컨테이너라 부분 제외가 불가 → 배치 전체 중단
    const oversizeZips: string[] = [];
    for (const { file, relativePath } of entries) {
      if (relativePath.toLowerCase().endsWith(".zip") && file.size > MAX_ZIP) {
        oversizeZips.push(
          `· ${relativePath} (${formatMB(file.size)}) — ZIP 최대 ${formatMB(MAX_ZIP)} 초과`
        );
      }
    }
    if (oversizeZips.length > 0) {
      notify(
        `다음 압축 파일이 크기 제한을 초과해 업로드를 시작하지 않았습니다.\n\n${oversizeZips.join("\n")}\n\nZIP 을 작게 분할하거나 압축률을 높여 다시 시도해 주세요.`,
        { tone: "warn", title: "ZIP 크기 초과" }
      );
      return;
    }

    // 개별 파일(비-ZIP)이 10MB 를 넘으면 해당 파일만 빼고 나머지는 업로드.
    // (동영상이 삽입된 PPT 등. ZIP 안의 파일은 서버가 동일 기준으로 제외)
    const excludedLarge: string[] = [];
    entries = entries.filter(({ file, relativePath }) => {
      const isZip = relativePath.toLowerCase().endsWith(".zip");
      if (!isZip && file.size > MAX_FILE) {
        excludedLarge.push(`${relativePath} (${formatMB(file.size)})`);
        return false;
      }
      return true;
    });
    if (entries.length === 0) {
      notify(
        `업로드할 파일이 모두 10MB 를 초과해 제외되었습니다.\n\n${excludedLarge
          .map((n) => `· ${n}`)
          .join("\n")}`,
        { tone: "warn", title: "10MB 초과 — 업로드 없음" }
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
          body: JSON.stringify({ blobs, applicantConsentConfirmed: consentConfirmed }),
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
        fd.append("applicantConsentConfirmed", consentConfirmed ? "true" : "false");
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
    if (excludedLarge.length > 0) {
      lines.push(
        `ℹ️ 10MB 초과 ${excludedLarge.length}개 제외: ${excludedLarge
          .slice(0, 3)
          .join(", ")}${excludedLarge.length > 3 ? " 외" : ""}`
      );
    }
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

  // 검색은 useDeferredValue 로 지연 — 입력(setSearch)은 즉시 반영되고, 무거운 필터/정렬/그룹핑은
  // 한 박자 늦게(낮은 우선순위) 계산돼 후보가 많아도 타이핑이 끊기지 않는다.
  const deferredSearch = useDeferredValue(search);

  // 후보 목록 파생값 일괄 계산 — lib/candidate-state.ts 단일 진실원천. 그룹·필터·정렬·뱃지 기준.
  // candidatesList(폴링 동일 시 참조 유지)·filter·검색어가 안 바뀌면 통째로 캐시되므로,
  // 선택 토글 같은 다른 리렌더에서 수백 명분 파생계산이 다시 돌지 않는다.
  const {
    waiterCounts,
    filtered,
    favoriteCandidates,
    round1Candidates,
    grouped,
    visibleIds,
  } = useMemo(() => {
    const stateMap = new Map(
      candidatesList.map((c) => [c.id, deriveCandidateState(c)] as const)
    );
    const stateOf = (c: Candidate) =>
      stateMap.get(c.id) ?? deriveCandidateState(c);
    const groupOf = (c: Candidate): GroupKey => stateOf(c).group;
    const GROUP_IDX = new Map(GROUP_ORDER.map((g, i) => [g, i] as const));

    // 대기주체별 카운트 — 필터 칩 뱃지용 (탭/검색과 무관하게 전체 기준)
    const waiterCounts: Record<Exclude<WaiterFilter, "all">, number> = {
      hr: 0,
      candidate: 0,
      interviewer: 0,
      system: 0,
      closed: 0,
    };
    for (const c of candidatesList) {
      const s = stateOf(c);
      if (s.bucket === "closed") waiterCounts.closed++;
      else if (s.waiter !== "none")
        waiterCounts[s.waiter as Exclude<WaiterFilter, "all" | "closed">]++;
    }

    // 단일 필터 판정 — 값 종류별 의미:
    //   대기주체: 파생 상태의 waiter / 결과: outcome ("최종 합격"은 stage 가 아니라 outcome 기준)
    //   할일 pseudo: 파생 그룹 / 버킷·세부 단계: 진행 중(outcome null)만 — 펀널 박스 숫자와 일치,
    //   종결자는 종결 칩·결과 필터로 본다.
    const matchesFilter = (c: Candidate): boolean => {
      switch (filter) {
        case "all":
          return true;
        case "hr":
        case "candidate":
        case "interviewer":
        case "system":
        case "closed":
          return matchesWaiterFilter(stateOf(c), filter);
        case "in_progress":
          return c.outcome == null;
        case "hired":
        case "rejected":
        case "withdrawn":
          return c.outcome === filter;
        case "counter_proposed":
          return stateOf(c).group === "hr_counter";
        case "ai_link_expired":
          return stateOf(c).group === "hr_ai_expired";
        case "result_due":
          return stateOf(c).group === "hr_result_due";
        case "resume_action":
          return stateOf(c).group === "hr_resume_action";
        default:
          if (filter.startsWith("bucket_")) {
            const bucket = filter.slice("bucket_".length);
            return STAGE_BUCKET[c.stage] === bucket && c.outcome == null;
          }
          return c.stage === filter && c.outcome == null;
      }
    };

    const q = deferredSearch.trim().toLowerCase();
    const filteredRaw = candidatesList.filter((c) => {
      if (!matchesFilter(c)) return false;
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
        // 전형·태그·결과·점수·상태도 검색 (예: "비추천", "서류평가", "불합격", "평가 실패")
        candidateSearchExtras(c),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });

    // 그룹 정렬 — 파이프라인 순서 (그룹 정의는 lib/candidate-state.ts).
    // 1차 면접 후보(round1_candidate)는 별도 핀 섹션이라 그룹에서 제외.
    const filtered = [...filteredRaw].sort((a, b) => {
      const ga = GROUP_IDX.get(groupOf(a)) ?? 0;
      const gb = GROUP_IDX.get(groupOf(b)) ?? 0;
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
    // 1차 면접 후보는 별도 섹션 상단 노출 + border 강조 (즐겨찾기는 제외).
    // 단, 종결(합격/불합격/취소)된 후보는 "일정 제시" 액션 대상이 아니므로 핀에서 제외 —
    // 일반 흐름으로 보내면 파생 그룹이 closed_neg/closed_hired 라 맨 뒤로 정렬된다.
    const isActiveRound1Pin = (c: Candidate) =>
      c.stage === "round1_candidate" && c.outcome == null;
    const round1Candidates = filtered.filter(
      (c) => isActiveRound1Pin(c) && !c.favorited
    );
    const otherCandidates = filtered.filter(
      (c) => !isActiveRound1Pin(c) && !c.favorited
    );
    // 그룹별로 미리 분할 — 렌더에서 GROUP_ORDER 마다 다시 filter 하지 않도록.
    const grouped = {} as Record<GroupKey, Candidate[]>;
    for (const c of otherCandidates) {
      (grouped[groupOf(c)] ??= []).push(c);
    }

    const visibleIds = filtered.map((c) => c.id);
    return {
      waiterCounts,
      filtered,
      favoriteCandidates,
      round1Candidates,
      grouped,
      visibleIds,
    };
  }, [candidatesList, filter, deferredSearch]);
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
  const toggleOne = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // 잠금/로딩/삭제됨 가드 — 반드시 모든 Hook 호출 뒤에 둔다.
  // (early-return 위에서 useMemo/useCallback 등을 호출하면 job 로드 직후 호출 Hook 수가
  //  바뀌어 "Rendered more hooks than during the previous render" 로 페이지 전체가 깨진다.)
  if (locked) {
    return (
      <main className="max-w-5xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
        <Link
          href="/"
          className="text-sm text-ink-muted hover:text-ink transition-colors"
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
          <div className="rounded-lg border border-border-default bg-card p-6 text-center">
            <div className="text-ink-soft font-medium">삭제된 공고입니다.</div>
            <div className="mt-1 text-sm text-ink-muted">
              이 공고는 더 이상 존재하지 않습니다.
            </div>
            <button
              onClick={() => router.push("/")}
              className="mt-4 px-4 py-2 rounded-lg border border-border-strong text-sm hover:bg-surface-alt"
            >
              공고 목록으로
            </button>
          </div>
        </main>
      );
    if (loadError === "failed")
      return (
        <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="rounded-lg border border-danger/40 bg-danger-soft p-6 text-center">
            <div className="text-danger font-medium">불러오기에 실패했습니다.</div>
            <div className="mt-1 text-sm text-danger">
              네트워크 상태를 확인하고 다시 시도해 주세요.
            </div>
            <button
              onClick={() => {
                setLoadError(null);
                void loadJob();
              }}
              className="mt-4 px-4 py-2 rounded-lg border border-danger/40 text-sm text-danger hover:bg-danger-soft"
            >
              다시 시도
            </button>
          </div>
        </main>
      );
    return (
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 text-ink-muted">
        불러오는 중...
      </main>
    );
  }

  // 공고 만료 — closesAt 지났고 아직 active. HR 액션 UI 잠금.
  const isExpired =
    job.status === "active" &&
    !!job.closesAt &&
    new Date(job.closesAt).getTime() < Date.now();

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
  // bulk-screen 은 한 요청당 ids 500개 상한 — 전체선택 등 500 초과분은 500씩 잘라 순차 전송.
  // 멱등(이미 큐된 후보는 서버가 skip)이라 중간 청크가 실패해도 재시도하면 나머지가 안전하게 채워진다.
  const BULK_SCREEN_CHUNK = 500;
  const postBulkScreenChunked = async (ids: number[]) => {
    let enqueued = 0;
    let kicked = 0;
    let skipped = 0;
    const reasons: string[] = [];
    for (let i = 0; i < ids.length; i += BULK_SCREEN_CHUNK) {
      const chunk = ids.slice(i, i + BULK_SCREEN_CHUNK);
      const res = await fetch("/api/candidates/bulk-screen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: chunk }),
      });
      if (!res.ok) {
        return {
          ok: false as const,
          error: await res.text(),
          enqueued,
          kicked,
          skipped,
          reasons,
        };
      }
      const data = (await res.json()) as {
        enqueued?: number;
        kicked?: number;
        skipped?: number;
        details?: { skipped?: { reason: string }[] };
      };
      enqueued += data.enqueued ?? 0;
      kicked += data.kicked ?? 0;
      skipped += data.skipped ?? 0;
      if (data.details?.skipped)
        reasons.push(...data.details.skipped.map((s) => s.reason));
    }
    return { ok: true as const, enqueued, kicked, skipped, reasons };
  };

  const bulkScreen = async (targetIds: number[]) => {
    if (targetIds.length === 0) return;
    const targetSet = new Set(targetIds);
    // 신규 평가 대상: 아직 한 번도 평가 시도가 없는 후보 (실패/완료/대기는 '재평가' 가 담당)
    const targets = filtered.filter(
      (c) =>
        targetSet.has(c.id) &&
        c.screeningReport == null &&
        c.lastJobStatus !== "failed" &&
        c.lastJobStatus !== "paused" &&
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
    setBulkBusy("screen");
    const result = await postBulkScreenChunked(targets.map((c) => c.id));
    setBulkBusy(null);
    if (!result.ok) {
      const sent = result.enqueued + result.kicked;
      notify(
        sent > 0
          ? `일부 ${sent}건만 등록됨 — 다시 눌러 나머지를 마저 등록하세요.\n${result.error}`
          : result.error,
        { tone: "danger", title: "큐 등록 실패" }
      );
      void loadCandidates();
      return;
    }
    const reasonSummary = result.reasons.length
      ? `\n스킵: ${result.reasons.join(", ")}`
      : "";
    notify(
      `큐 등록: ${result.enqueued}건${result.skipped > 0 ? ` (스킵 ${result.skipped}건)` : ""}${reasonSummary}`,
      { tone: "success", title: "AI 검토 요청 완료" }
    );
    setSelected(new Set());
    void loadCandidates();
  };

  // 재평가 — 이미 평가가 끝난 후보를 다시 평가 (공고/평가가이드 수정 후 또는 재확인).
  // 기존 결과는 새 평가가 끝나면 대체됨. 과금은 평가 성공 시점에 후보당 1건(오류면 과금 없음).
  const bulkRescreen = async (targetIds: number[]) => {
    if (targetIds.length === 0) return;
    const targetSet = new Set(targetIds);
    // 대상: 평가 완료(재평가) 또는 재시도 대기/백오프(즉시 재시도). 처리중·충전대기는 제외.
    const targets = filtered.filter(
      (c) =>
        targetSet.has(c.id) &&
        c.queueStatus !== "processing" &&
        c.lastJobStatus !== "paused" &&
        (c.screeningReport != null ||
          c.lastJobStatus === "failed" ||
          (c.queueStatus === "queued" && c.queueAttempts >= 1))
    );
    if (targets.length === 0) {
      notify("선택된 후보자 중 재평가 가능한 후보가 없습니다.", { tone: "warn" });
      return;
    }
    if (
      !(await confirmDialog(
        `${targets.length}명을 다시 AI 서류평가합니다.\n완료된 평가는 새 결과로 대체되고, 재시도 대기 중인 건은 즉시 다시 시도합니다.\n평가가 정상 완료되면 후보당 토큰이 차감됩니다 (오류 시 과금 없음).`,
        { title: "재평가", confirmText: "재평가" }
      ))
    )
      return;
    setBulkBusy("rescreen");
    const result = await postBulkScreenChunked(targets.map((c) => c.id));
    setBulkBusy(null);
    if (!result.ok) {
      const sent = result.enqueued + result.kicked;
      notify(
        sent > 0
          ? `일부 ${sent}건만 등록됨 — 다시 눌러 나머지를 마저 등록하세요.\n${result.error}`
          : result.error,
        { tone: "danger", title: "재평가 요청 실패" }
      );
      void loadCandidates();
      return;
    }
    const total = result.enqueued + result.kicked;
    notify(
      `재평가 등록: ${total}건${result.skipped > 0 ? ` (스킵 ${result.skipped}건)` : ""}`,
      { tone: "success", title: "재평가 요청 완료" }
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
    setBulkBusy("delete");
    const res = await fetch("/api/candidates/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: targetIds }),
    });
    setBulkBusy(null);
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
    setBulkBusy("decide");
    let ok = 0;
    let fail = 0;
    let mailOk = 0;
    let mailFail = 0;
    const processOne = async (
      id: number
    ): Promise<{ ok: boolean; mail?: "ok" | "fail" }> => {
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
      if (!res.ok) return { ok: false };
      if (opts.sendMail) {
        const data = (await res.json().catch(() => null)) as {
          mail?: { sent?: boolean };
        } | null;
        return { ok: true, mail: data?.mail?.sent ? "ok" : "fail" };
      }
      return { ok: true };
    };
    // 동시 처리 — 직렬이면 16명 × 파일삭제가 줄줄이 느려진다. 동시성은
    // 서버리스·SMTP 폭주 방지를 위해 6으로 제한 (큐에서 하나씩 꺼내 실행).
    const queue = [...st.ids];
    const runWorker = async () => {
      for (;;) {
        const id = queue.shift();
        if (id === undefined) return;
        const r = await processOne(id);
        if (r.ok) ok++;
        else fail++;
        if (r.mail === "ok") mailOk++;
        else if (r.mail === "fail") mailFail++;
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(6, st.ids.length) }, runWorker)
    );
    setBulkBusy(null);
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

  // 불합격인데 결과 통보 메일이 아직 안 나간 후보자에게 일괄 발송.
  // decision-mail 라우트를 후보자별로 6-worker 동시 호출 (서버리스·SMTP 폭주 방지).
  const bulkDecisionMail = async (targetIds: number[]) => {
    if (targetIds.length === 0) return;
    if (
      !(await confirmDialog(
        `불합격 통보 메일을 아직 받지 못한 ${targetIds.length}명에게 결과 통보 메일을 발송할까요?\n\n각 후보자에게 기본 불합격 안내 메일이 발송됩니다.`,
        { title: "불합격 통보 일괄 발송", confirmText: "발송" }
      ))
    )
      return;
    setBulkBusy("decisionMail");
    let ok = 0;
    let fail = 0;
    const queue = [...targetIds];
    const runWorker = async () => {
      for (;;) {
        const id = queue.shift();
        if (id === undefined) return;
        const res = await fetch(`/api/candidates/${id}/decision-mail`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (res.ok) ok++;
        else fail++;
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(6, targetIds.length) }, runWorker)
    );
    setBulkBusy(null);
    notify(
      `불합격 통보 발송: 성공 ${ok}건${fail > 0 ? ` / 실패 ${fail}건` : ""}`,
      { tone: fail > 0 ? "warn" : "success", title: "통보 메일 발송 결과" }
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
    setBulkBusy("interviewSend");
    const r = await fetch(`/api/jobs/${jobId}/interview-links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateIds: targetIds }),
    });
    setBulkBusy(null);
    if (!r.ok) {
      const text = await r.text();
      notify(text, { tone: "danger", title: "발송 실패" });
      return;
    }
    const data = (await r.json()) as {
      queued?: number;
      results: { candidateId: number; status: string; reason?: string }[];
    };
    const sending = data.results.filter((x) => x.status === "sending").length;
    const skipped = data.results.filter((x) => x.status === "skipped").length;
    notify(
      `AI 면접 메일 ${sending}건 발송을 시작했습니다${skipped > 0 ? ` (건너뜀 ${skipped}건)` : ""}.\n발송 완료까지 잠시 걸릴 수 있으며, 목록의 '발송' 시각으로 확인할 수 있습니다.`,
      { tone: "success", title: "AI 면접 발송 요청 완료" }
    );
    setSelected(new Set());
    void loadCandidates();
    // 백그라운드 발송 직후엔 아직 미반영 — 잠시 후 한 번 더 갱신해 발송 시각 표시.
    setTimeout(() => void loadCandidates(), 5000);
  };

  const bulkAdvance = async (newStage: Candidate["stage"], targetIds: number[]) => {
    if (targetIds.length === 0) return;
    setBulkBusy("advance");
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
    setBulkBusy(null);
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
    // 신규 평가 대상 — 한 번도 시도 안 한 후보만. (실패/완료/대기는 '재평가' 가 담당)
    const screenable = selCands.filter(
      (c) =>
        c.screeningReport == null &&
        c.lastJobStatus !== "failed" &&
        c.lastJobStatus !== "paused" &&
        c.queueStatus !== "queued" &&
        c.queueStatus !== "processing"
    );
    // 재평가 대상 — 완료(재평가) + 실패(재시도) + 재시도 대기/백오프(즉시 재시도). 처리중·충전대기 제외.
    const rescreenable = selCands.filter(
      (c) =>
        c.queueStatus !== "processing" &&
        c.lastJobStatus !== "paused" &&
        (c.screeningReport != null ||
          c.lastJobStatus === "failed" ||
          (c.queueStatus === "queued" && c.queueAttempts >= 1))
    );
    return (
      <div className="flex items-center gap-2 ml-auto flex-wrap">
        <Link
          href={`/jobs/${jobId}/compare?ids=${selectedInBlock.join(",")}`}
          className="px-2.5 py-1.5 rounded-lg bg-primary hover:bg-primary-deep text-surface text-xs font-medium whitespace-nowrap"
        >
          비교
        </Link>
        {screenable.length > 0 && (
          <button
            onClick={() => void bulkScreen(screenable.map((c) => c.id))}
            disabled={bulkBusy !== null}
            className="px-2.5 py-1.5 rounded-lg bg-primary hover:bg-primary-deep text-surface text-xs font-medium disabled:opacity-50 whitespace-nowrap inline-flex items-center justify-center gap-1.5"
            title="평가 안 됐거나 실패한 후보를 다시 큐에 넣습니다"
          >
            {bulkBusy === "screen" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {bulkBusy === "screen" ? "처리 중..." : "AI 검토 요청"}
          </button>
        )}
        {rescreenable.length > 0 && (
          <button
            onClick={() => void bulkRescreen(rescreenable.map((c) => c.id))}
            disabled={bulkBusy !== null}
            className="px-2.5 py-1.5 rounded-lg border border-primary/30 text-primary hover:bg-primary-soft text-xs font-medium disabled:opacity-50 whitespace-nowrap inline-flex items-center justify-center gap-1.5"
            title="이미 평가된 후보를 다시 평가합니다 (공고/평가 가이드 수정 후 등)"
          >
            {bulkBusy === "rescreen" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            {bulkBusy === "rescreen" ? "처리 중..." : "재평가"}
          </button>
        )}
        {(onlyStage === "screened" ||
          onlyStage === "ai_pending" ||
          (aiScreeningDisabled && onlyStage === "applied")) && (
          <button
            onClick={() => void bulkInterviewSend(inProgress.map((c) => c.id))}
            disabled={bulkBusy !== null}
            className="px-2.5 py-1.5 rounded-lg bg-primary hover:bg-primary-deep text-surface text-xs font-medium disabled:opacity-50 whitespace-nowrap inline-flex items-center justify-center gap-1.5"
            title="선택된 후보 전원에게 AI 면접 링크 메일 발송"
          >
            {bulkBusy === "interviewSend" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Mail className="w-3.5 h-3.5" />
            )}
            {bulkBusy === "interviewSend" ? "발송 중..." : "AI 면접 발송"}
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
            disabled={bulkBusy !== null}
            className="px-2.5 py-1.5 rounded-lg bg-primary hover:bg-primary-deep text-surface text-xs font-medium disabled:opacity-50 whitespace-nowrap inline-flex items-center gap-1"
          >
            <UserCheck className="w-3.5 h-3.5" />
            1차 면접 후보로 지정
          </button>
        )}
        {onlyStage === "round1_passed" && (
          <>
            <SchedulePropose
              jobId={Number(jobId)}
              selectedIds={inProgress.map((c) => c.id)}
              round="round2"
              onDone={() => {
                setSelected(new Set());
                void loadCandidates();
              }}
            />
            <button
              onClick={() => void bulkAdvance("round2_passed", inProgress.map((c) => c.id))}
              disabled={bulkBusy !== null}
              className="px-2.5 py-1.5 rounded-lg bg-primary hover:bg-primary-deep text-surface text-xs font-medium disabled:opacity-50 whitespace-nowrap"
            >
              → 2차 합격
            </button>
          </>
        )}
        {allInProgress && (
          <button
            onClick={() => setDecideIds(inProgress.map((c) => c.id))}
            disabled={bulkBusy !== null}
            className="px-2.5 py-1.5 rounded-lg bg-primary hover:bg-primary-deep text-surface text-xs font-medium disabled:opacity-50 whitespace-nowrap"
          >
            합/불 결정
          </button>
        )}
        <button
          onClick={() => void bulkDelete(selectedInBlock)}
          disabled={bulkBusy !== null}
          className="px-2.5 py-1.5 rounded-lg bg-danger hover:bg-danger/85 text-surface text-xs font-medium disabled:opacity-50 whitespace-nowrap inline-flex items-center justify-center gap-1.5"
        >
          {bulkBusy === "delete" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {bulkBusy === "delete" ? "삭제 중..." : "삭제"}
        </button>
      </div>
    );
  };

  // 후보 0명(빈 상태 히어로) vs 1명+(작업대: 펀널·목록·드로어) 분기.
  // isEmpty 는 첫 로드 완료 후에만 true — 로딩 중 0 과 진짜 0 을 구분한다.
  const hasCands = candidatesList.length > 0;
  const isEmpty = candidatesLoaded && candidatesList.length === 0;

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
        className="text-sm text-ink-muted hover:text-ink transition-colors"
      >
        ← 대시보드
      </Link>

      <ApplyIntakeBanner jobId={jobId} />

      {/* Header */}
      <div data-tour="job-header" className="bg-card border border-border-default rounded-2xl p-4 sm:p-6 mt-3 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-ink leading-tight break-keep">
              {job.title}
            </h1>
            <div className="flex flex-wrap gap-1.5 mt-3">
              <Tag>{job.position}</Tag>
              <Tag>{job.level}</Tag>
              <Tag>{job.employmentType}</Tag>
              <Tag>면접 {job.interviewDurationMinutes ?? 20}분</Tag>
            </div>
            <div className="text-xs text-ink-muted mt-3">
              등록 {formatKstDateTime(job.createdAt)}
            </div>
          </div>
          <div className="flex gap-2 flex-wrap sm:shrink-0 items-center">
            {/* 이력서 받기 — 후보가 1명+ 일 때 헤더 1차 버튼(클릭 시 드로어).
               0명이면 헤더 버튼 대신 아래 인라인 히어로로 받는다. */}
            {hasCands && (
              <button
                data-tour="resume-intake-btn"
                onClick={() => setIntakeOpen(true)}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-surface hover:bg-primary-deep text-sm font-medium shadow-sm"
              >
                <Inbox className="w-4 h-4" />
                이력서 받기
              </button>
            )}
            {/* 면접 일정 — 확정된 면접이 있을 때만 표시하고, 색을 채워 눈에 띄게. */}
            {(() => {
              // 확정 면접 대기 = 1차(stage=round1_waiting) + 2차(round1_passed + round2 확정).
              // 종결(outcome) 후보는 제외 — API 조회 조건과 일치시킴.
              const waitingCount = candidatesList.filter(
                (c) =>
                  c.outcome == null &&
                  (c.stage === "round1_waiting" ||
                    (c.stage === "round1_passed" &&
                      c.round2ScheduleStatus === "selected"))
              ).length;
              if (waitingCount === 0) return null;
              return (
                <>
                  <button
                    onClick={openRound1Schedule}
                    disabled={scheduleLoading}
                    title="확정된 1·2차 면접 일정을 시간순으로 봅니다"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-surface hover:bg-primary-deep text-sm font-medium shadow-sm disabled:opacity-50"
                  >
                    <CalendarClock className="w-4 h-4" />
                    면접 일정 ({waitingCount})
                  </button>
                  <span
                    className="hidden sm:block w-px h-5 bg-border-default mx-0.5"
                    aria-hidden
                  />
                </>
              );
            })()}

            {/* 유틸리티 아이콘 묶음 — 공유 · 리포트 · 역량평가 · 수정 · 삭제. */}
            <div className="flex items-center gap-1">
              {/* 역량평가(면접 전 객관식 사전문항) — 적용 시 색이 켜진다. 아이콘 묶음 맨 앞. */}
              <McqPanel jobId={jobId} disabled={isExpired} isDraft={!!job.isDraft} />
              <ShareButton jobId={Number(jobId)} jobTitle={job.title} iconOnly />
              <Link
                href={`/jobs/${jobId}/report`}
                title="채용 결과 리포트 (인쇄/PDF)"
                aria-label="채용 결과 리포트"
                className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-border-strong text-ink-soft hover:bg-surface-alt hover:text-ink transition-colors"
              >
                <BarChart3 className="w-4 h-4" />
              </Link>
              <Link
                href={`/jobs/${jobId}/edit`}
                title="공고 수정"
                aria-label="공고 수정"
                className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-border-strong text-ink-soft hover:bg-surface-alt hover:text-ink transition-colors"
              >
                <Pencil className="w-4 h-4" />
              </Link>
              <button
                onClick={handleDelete}
                title="공고 삭제"
                aria-label="공고 삭제"
                className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-border-strong text-ink-soft hover:border-danger/50 hover:text-danger hover:bg-danger-soft transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
        {job.evaluationFocus && job.evaluationFocus.trim() && (
          <div className="mt-4 rounded-lg border border-border-default bg-surface-alt px-4 py-3">
            <div className="flex items-baseline gap-2 mb-1.5">
              <span className="text-xs font-semibold text-primary-deep">
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

      {/* 이력서 받기 — 데스크톱 전용. 0명: 헤더 아래 인라인 히어로 / 1명+: 헤더 버튼으로 여는
         우측 슬라이드 패널. 업로드 영역(드롭존 ref)은 단일 인스턴스라 두 모드가 같은 본문을
         공유한다. 업로드 진행 중에는(uploading) 빈 상태가 풀려도 진행률이 사라지지 않게 계속 표시.
         두 경로(지원 링크 / 직접 업로드)는 순서가 아니라 택일 — 본문에서 '또는'으로 구분. */}
      {(isEmpty || intakeOpen || uploading) && (
        <div
          className={
            intakeOpen
              ? "fixed inset-0 z-50 hidden sm:flex justify-end"
              : "hidden sm:block mt-3"
          }
        >
          {intakeOpen && (
            <div
              className="absolute inset-0 bg-ink/40"
              onClick={() => setIntakeOpen(false)}
              aria-hidden
            />
          )}
          <div
            className={
              intakeOpen
                ? "relative w-full max-w-xl h-full bg-card shadow-2xl overflow-y-auto p-6"
                : "bg-card border border-border-default rounded-2xl shadow-sm p-6"
            }
          >
            <div className="flex items-start justify-between gap-3 mb-5">
              <div>
                <h2 className="text-lg font-bold text-ink">이력서 받기</h2>
                <p className="text-sm text-ink-muted mt-1">
                  지원 링크를 공유하거나, 보유한 이력서 파일을 직접 올려 평가를 시작하세요.
                </p>
              </div>
              {intakeOpen && (
                <button
                  data-tour="resume-intake-close"
                  onClick={() => setIntakeOpen(false)}
                  aria-label="이력서 받기 닫기"
                  className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg border border-border-strong text-ink-soft hover:bg-surface-alt"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
      {/* 경로 ① 지원자가 직접 올리게: 공개 지원 링크 */}
      <div data-tour="apply-link">
        <p className="text-sm font-semibold text-ink">지원 링크로 직접 받기</p>
        <div className="mt-2">
          <ApplyLinkButton jobId={jobId} disabled={isExpired} />
        </div>
      </div>

      {/* 두 방법은 순서가 아니라 택일 — '또는'으로 구분 */}
      <div className="my-5 flex items-center gap-3">
        <div className="flex-1 border-t border-border-default" />
        <span className="text-xs font-medium text-ink-muted">또는</span>
        <div className="flex-1 border-t border-border-default" />
      </div>

      {/* 경로 ② 보유한 이력서 파일을 직접 올리기 */}
      <p className="text-sm font-semibold text-ink">이력서 직접 업로드</p>
      <p className="mt-1 text-xs text-ink-muted">
        이미 가지고 있는 이력서 파일을 직접 올려 평가합니다.
      </p>
      {/* 지원자 동의 확인 게이트 — 업로드 전 필수 (PIPA §15·§26·§28의8·§37의2)
         체크 시 모달로 명시 재확인을 요구해 "무심코 체크" 차단. */}
      <div data-tour="consent-gate" className="mt-3">
      <ApplicantConsentGate
        confirmed={consentConfirmed}
        busy={consentBusy}
        jobId={jobId}
        aiScreeningDisabled={aiScreeningDisabled}
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
        onSkipScreening={async () => {
          if (
            !(await confirmDialog(
              "AI 이력서 평가 없이 진행합니다.\n이력서는 채용 담당자가 직접 검토하고, AI 는 면접 단계(지원자 동의 후)부터 적용됩니다. 이 경우 공고에 AI 평가 안내를 넣지 않아도 됩니다.",
              { tone: "warn", title: "AI 이력서 평가 없이 진행", confirmText: "진행" }
            ))
          )
            return;
          setConsentBusy(true);
          const r = await fetch(`/api/jobs/${jobId}/skip-screening`, {
            method: "POST",
          });
          setConsentBusy(false);
          if (!r.ok) {
            notify(await r.text(), { tone: "danger", title: "설정 저장 실패" });
            return;
          }
          setAiScreeningDisabled(true);
        }}
        onResumeScreening={async () => {
          setConsentBusy(true);
          const r = await fetch(`/api/jobs/${jobId}/skip-screening`, {
            method: "DELETE",
          });
          setConsentBusy(false);
          if (!r.ok) {
            notify(await r.text(), { tone: "danger", title: "되돌리기 실패" });
            return;
          }
          setAiScreeningDisabled(false);
        }}
      />
      </div>

      {/* Upload zone */}
      <div
        data-tour="upload-zone"
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
            ? "border-border-default bg-surface-alt opacity-50 pointer-events-none"
            : uploading
              ? "border-border-default bg-surface-alt opacity-60 pointer-events-none"
              : !canUpload
              ? "border-border-default bg-surface-alt opacity-60"
              : dragOver
                ? "border-primary bg-primary-soft"
                : "border-border-strong bg-card hover:bg-surface-alt"
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
            disabled={uploading || !canUpload || isExpired}
            className="text-sm font-medium text-ink disabled:opacity-50 disabled:cursor-not-allowed"
            title={
              isExpired
                ? "공고 종결일이 지났습니다. 연장 후 업로드 가능"
                : !canUpload
                  ? "먼저 AI 평가 적용 고지 확인을 완료해 주세요"
                  : ""
            }
          >
            {isExpired ? (
              "공고 종결일 경과 — 연장 후 업로드 가능"
            ) : uploading ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="w-4 h-4 rounded-full border-2 border-border-strong border-t-primary animate-spin" />
                업로드 중...
              </span>
            ) : !canUpload ? (
              "AI 평가 적용 고지 확인 후 업로드 가능"
            ) : (
              "파일을 끌어다 놓거나 클릭해 선택"
            )}
          </button>
          <button
            onClick={() => folderInputRef.current?.click()}
            disabled={uploading || !canUpload || isExpired}
            className="text-xs text-ink-soft hover:text-primary hover:underline disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1"
          >
            <Folder className="w-3.5 h-3.5" />
            폴더로 선택하기
          </button>
        </div>
        <ul className="text-xs text-ink-muted mt-3 space-y-1 text-left inline-block">
          <li>· PDF · DOCX · HWP · 이미지 · ZIP 지원</li>
          <li>· 여러 파일 한 번에, 폴더 드래그도 가능</li>
          <li>· 개별 파일 10MB 초과는 자동 제외 (동영상 삽입된 PPT 등)</li>
          <li>
            · 한 응시자에 이력서 + 포트폴리오를 함께 올리려면 응시자 이름 폴더로 묶어주세요
            <br />
            <span className="ml-2 font-mono text-[10px] text-ink-muted">
              예) 홍길동/이력서.pdf, 홍길동/포트폴리오.pdf
            </span>
          </li>
        </ul>

        {uploadProgress && (
          <div className="mt-4 max-w-md mx-auto text-left">
            <div className="flex items-center justify-between text-xs font-medium text-ink-soft mb-1">
              <span>
                {uploadProgress.phase === "uploading"
                  ? `업로드 중… ${uploadProgress.done}/${uploadProgress.total} 파일`
                  : "후보자 등록 중… (분석은 백그라운드에서 계속됩니다)"}
              </span>
              <span className="tabular-nums">{uploadProgress.pct}%</span>
            </div>
            <div className="h-2 rounded-full bg-surface-alt overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-200 ${
                  uploadProgress.phase === "processing"
                    ? "bg-primary animate-pulse"
                    : "bg-primary"
                }`}
                style={{ width: `${uploadProgress.pct}%` }}
              />
            </div>
            <p className="text-[11px] text-ink-muted mt-1.5">
              업로드가 끝나면 카드가 바로 생기고, 이름·평가는 순차로 채워집니다. 창을 닫아도 분석은 계속됩니다.
            </p>
          </div>
        )}
      </div>
          </div>
        </div>
      )}
      {/* 모바일 빈 상태 — 업로드는 PC 전용이라 안내만 노출 */}
      {isEmpty && (
        <div className="sm:hidden mt-3 rounded-2xl border border-border-default bg-card p-6 text-center text-sm text-ink-muted">
          아직 후보자가 없습니다.
          <br />
          이력서 업로드는 PC 에서 가능합니다.
        </div>
      )}

      {/* 작업대 — 후보 1명+ 일 때만: 전형 단계 현황(펀널=필터) → 필터 → 이력서 목록.
         0명이면 위 인라인 히어로(이력서 받기)가 이 자리를 대신한다. */}
      {hasCands && (
        <>
      <FunnelPanel
        jobId={jobId}
        refreshKey={funnelKey}
        activeStage={filter}
        onStageSelect={(s) => {
          setFilter(s as FilterValue);
          // 목록이 펀널보다 한참 아래라 클릭 효과가 보이도록 스크롤.
          if (s !== "all")
            listTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
      />

      {/* 필터 — 단일 선택. 칩(대기주체)과 드롭다운(단계·결과 상세)이 같은 상태를 공유하며,
         어디서든 새로 고르면 이전 필터를 대체한다 (조합 없음 → 리셋 불필요). */}
      <div
        ref={listTopRef}
        data-tour="candidate-list"
        className="mt-8 flex flex-wrap items-center gap-1.5 scroll-mt-4"
      >
        <button
          onClick={() => setFilter("all")}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
            filter === "all"
              ? "bg-ink text-surface border-ink"
              : "bg-card text-ink-soft border-border-strong hover:bg-surface-alt"
          }`}
          title="필터 해제 — 전체 표시"
        >
          전체 <span className="opacity-70">{candidatesList.length}</span>
        </button>
        {(["hr", "candidate", "interviewer", "system", "closed"] as const).map(
          (k) => {
            const m = WAITER_FILTER_META[k];
            const n = waiterCounts[k];
            const active = filter === k;
            return (
              <button
                key={k}
                onClick={() => setFilter(active ? "all" : k)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  active
                    ? "bg-primary text-surface border-primary"
                    : k === "hr" && n > 0
                      ? "bg-warning-soft text-warning border-warning/40 hover:bg-warning/10"
                      : "bg-card text-ink-soft border-border-strong hover:bg-surface-alt"
                }`}
                title={
                  k === "hr"
                    ? "지금 처리해야 할 후보만 표시"
                    : `${m.label} 상태 후보만 표시`
                }
              >
                {m.icon} {m.label} <span className="opacity-70">{n}</span>
              </button>
            );
          }
        )}
      </div>

      {/* Search + 상세 필터 드롭다운 (칩과 동일한 단일 상태) */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[220px] relative">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름·이메일·전화·요약·전형·태그·결과·점수 검색"
            className="w-full border border-border-strong rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">
            <Search className="w-4 h-4" />
          </span>
        </div>
        <select
          // 칩 값(대기주체)은 드롭다운 옵션에 없으므로 그때는 "전체" 표시 — 활성 상태는 칩이 보여줌.
          value={
            (["hr", "candidate", "interviewer", "system", "closed"] as const).includes(
              filter as Exclude<WaiterFilter, "all">
            )
              ? "all"
              : filter
          }
          onChange={(e) => setFilter(e.target.value as FilterValue)}
          className="border border-border-strong rounded-lg px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="all">상세 필터 — 전체</option>
          <optgroup label="전형 버킷 (진행 중)">
            <option value="bucket_resume">서류</option>
            <option value="bucket_ai">AI 면접</option>
            <option value="bucket_round1">1차 면접</option>
            <option value="bucket_round2">2차 면접</option>
          </optgroup>
          {/* 세부 단계 — 결정(최종 합격)은 아래 "결과" 그룹과 중복이라 제외 */}
          {STAGE_GROUPS.filter((g) => g.group !== "decision").map((g) => (
            <optgroup key={g.group} label={STAGE_GROUP_LABELS[g.group]}>
              {g.stages.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABELS[s]}
                </option>
              ))}
            </optgroup>
          ))}
          {/* pseudo 필터 — 대시보드 할일 알림 딥링크(?stage=...)와 동일 */}
          <optgroup label="할일 바로가기">
            <option value="resume_action">서류 평가 조치 필요</option>
            <option value="counter_proposed">지원자 시간 역제안</option>
            <option value="ai_link_expired">AI 면접 링크 만료</option>
            <option value="result_due">면접 결과 입력 대기</option>
          </optgroup>
          <optgroup label="결과">
            <option value="in_progress">진행 중 (미종결)</option>
            <option value="hired">최종합격</option>
            <option value="rejected">불합격</option>
            <option value="withdrawn">지원취소</option>
          </optgroup>
        </select>
        <a
          href={`/api/jobs/${jobId}/candidates/export`}
          className="hidden sm:inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-border-strong hover:bg-surface-alt text-ink-soft text-sm ml-auto"
          title="후보자 데이터 CSV 다운로드"
        >
          <Download className="w-4 h-4" />
          CSV
        </a>
      </div>

      {/* 불합격 통보 미발송 안내 — 통보는 의무가 아니라 선택이므로 경고가 아닌 중립 안내(톤다운).
          닫으면 같은 미발송 명단에 대해선 다시 뜨지 않고, 새 불합격 미발송이 생기면 다시 표시된다. */}
      {(() => {
        const unnotified = candidatesList.filter(
          (c) => c.outcome === "rejected" && c.decisionEmailCount === 0 && !!c.email
        );
        if (unnotified.length === 0) return null;
        // 현재 미발송 명단 시그니처 — 닫힘 비교 기준. 명단이 바뀌면 다시 노출.
        const sig = unnotified
          .map((c) => c.id)
          .sort((a, b) => a - b)
          .join(",");
        if (rejectBannerDismissedSig === sig) return null;
        const dismiss = () => {
          setRejectBannerDismissedSig(sig);
          try {
            localStorage.setItem(`iv_reject_banner_dismissed_${jobId}`, sig);
          } catch {
            /* localStorage 불가 환경 — 세션 내 숨김만 */
          }
        };
        return (
          <div className="mt-3 flex items-center gap-3 bg-surface-alt border border-border-default rounded-xl px-4 py-3 flex-wrap">
            <Mail className="w-4 h-4 text-ink-muted shrink-0" />
            <span className="text-sm text-ink-soft">
              불합격 통보 메일 미발송 {unnotified.length}명
            </span>
            <button
              onClick={() => setFilter("rejected")}
              className="text-xs px-2.5 py-1 rounded-md border border-border-strong text-ink-soft hover:bg-surface"
            >
              불합격만 보기
            </button>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => void bulkDecisionMail(unnotified.map((c) => c.id))}
                disabled={bulkBusy !== null}
                className="text-xs px-3 py-1.5 rounded-md border border-border-strong text-ink-soft hover:bg-surface font-medium disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
              >
                {bulkBusy === "decisionMail" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {bulkBusy === "decisionMail" ? "발송 중..." : "일괄 통보 발송"}
              </button>
              <button
                onClick={dismiss}
                className="p-1 rounded-md text-ink-muted hover:bg-surface hover:text-ink-soft"
                title="이 안내 닫기"
                aria-label="이 안내 닫기"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        );
      })()}

      {/* Candidate list */}
      {filtered.length === 0 ? (
        <div className="text-center text-ink-muted py-16 bg-card border border-border-default rounded-2xl mt-4">
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
                  className="rounded border-border-strong"
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
                  <CandidateCard
                    key={c.id}
                    c={c}
                    variant="favorite"
                    selected={selected.has(c.id)}
                    onToggleSelect={toggleOne}
                  />
                ))}
              </ul>
            </div>
          )}
          {round1Candidates.length > 0 && (
            <div className="mt-3 mb-4 bg-primary-soft/50 border border-primary/30 rounded-2xl p-3">
              <div className="flex items-center gap-2 mb-2 px-1 flex-wrap">
                <input
                  type="checkbox"
                  checked={round1Candidates.every((c) => selected.has(c.id))}
                  onChange={() =>
                    toggleSection(round1Candidates.map((c) => c.id))
                  }
                  className="rounded border-border-strong"
                  title="전체 선택"
                />
                <span className="text-sm font-semibold text-primary-deep">
                  ⭐ 1차 면접 후보
                </span>
                <span className="text-xs text-primary-deep/80">
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
                  <CandidateCard
                    key={c.id}
                    c={c}
                    variant="round1"
                    selected={selected.has(c.id)}
                    onToggleSelect={toggleOne}
                  />
                ))}
              </ul>
            </div>
          )}
          {GROUP_ORDER.map((gk) => {
            const items = grouped[gk] ?? [];
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
                    className="rounded border-border-strong"
                  />
                  <span className={`text-xs font-semibold ${meta.tone}`}>{meta.label}</span>
                  <span className="text-xs text-ink-muted">({items.length}명)</span>
                  {hasSel && (
                    <span className="text-xs text-primary-deep font-medium">
                      · {selectedInBlock.length}명 선택됨
                    </span>
                  )}
                  {hasSel && renderBulkActions(items)}
                </div>
                <ul className={`space-y-3 ${dimmed ? "opacity-60" : ""}`}>
                  {items.map((c) => (
                    <CandidateCard
                      key={c.id}
                      c={c}
                      selected={selected.has(c.id)}
                      onToggleSelect={toggleOne}
                    />
                  ))}
                </ul>
              </div>
            );
          })}
        </>
      )}
        </>
      )}
      {decideIds && decideIds.length > 0 && (
        <div
          className="fixed inset-0 bg-ink/40 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          onClick={() => setDecideIds(null)}
        >
          <div
            className="bg-card rounded-2xl p-6 w-full max-w-sm shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-ink">합/불 결정</h3>
            <p className="mt-2 text-sm text-ink-soft">
              선택한 {decideIds.length}명에 대한 결정을 선택하세요.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <button
                onClick={() => {
                  const ids = decideIds;
                  setDecideIds(null);
                  void bulkDecide("hired", ids);
                }}
                disabled={bulkBusy !== null}
                className="px-4 py-2.5 rounded-lg bg-primary hover:bg-primary-deep text-surface text-sm font-medium disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                최종합격
              </button>
              <button
                onClick={() => {
                  const ids = decideIds;
                  setDecideIds(null);
                  void bulkDecide("rejected", ids);
                }}
                disabled={bulkBusy !== null}
                className="px-4 py-2.5 rounded-lg bg-ink hover:bg-ink-soft text-surface text-sm font-medium disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-1.5"
              >
                <X className="w-4 h-4" />
                불합격
              </button>
              <button
                onClick={() => setDecideIds(null)}
                className="mt-1 px-4 py-2 rounded-lg border border-border-strong text-ink-soft text-sm hover:bg-surface-alt"
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
          busy={bulkBusy === "decide"}
          onCancel={() => setBulkDecisionState(null)}
          onConfirm={(opts) => void runBulkDecision(opts)}
        />
      )}

      {round1Schedule && (
        <div
          className="fixed inset-0 bg-ink/40 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          onClick={() => setRound1Schedule(null)}
        >
          <div
            className="bg-card rounded-2xl p-6 w-full max-w-lg shadow-2xl max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="font-bold text-ink">🗓 면접 확정 일정</h3>
              <span className="text-xs text-ink-muted">
                {round1Schedule.length}명 · 시간순
              </span>
            </div>
            {round1Schedule.length === 0 ? (
              <p className="mt-4 text-sm text-ink-muted text-center py-6">
                확정된 면접 일정이 없습니다.
              </p>
            ) : (
              <ol className="mt-4 space-y-2 overflow-y-auto">
                {groupRound1Schedule(round1Schedule).map((g, i) => (
                  <li
                    key={g.key}
                    className="flex items-start gap-3 border border-border-default rounded-xl p-3"
                  >
                    <span className="shrink-0 w-6 h-6 rounded-full bg-primary-soft text-primary-deep text-xs font-bold flex items-center justify-center mt-0.5">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded font-semibold ${
                            g.round === "round2"
                              ? "bg-surface-alt text-ink-soft"
                              : "bg-primary-soft text-primary-deep"
                          }`}
                        >
                          {g.round === "round2" ? "2차" : "1차"}
                        </span>
                        <span className="text-sm font-semibold text-ink tabular-nums">
                          {fmtSlotRange(g.selectedSlot)}
                        </span>
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded ${
                            g.modeOnline
                              ? "bg-surface-alt text-ink-soft"
                              : "bg-surface-alt text-ink-soft"
                          }`}
                        >
                          {g.modeOnline ? "온라인" : "오프라인"}
                        </span>
                        {g.members.length > 1 && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-surface-alt text-ink-soft">
                            {g.members.length}명
                          </span>
                        )}
                        {!g.modeOnline && g.address && (
                          <span className="text-xs text-ink-muted">
                            {g.address}
                            {g.addressDetail ? ` ${g.addressDetail}` : ""}
                          </span>
                        )}
                      </div>
                      <ul className="mt-1.5 space-y-1">
                        {g.members.map((m) => (
                          <li
                            key={m.candidateId}
                            className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-soft"
                          >
                            <span className="font-medium text-ink">
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
                              className="text-ink-muted hover:text-primary-deep"
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
              className="mt-4 px-4 py-2 rounded-lg border border-border-strong text-ink-soft text-sm hover:bg-surface-alt shrink-0"
            >
              닫기
            </button>
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
