"use client";

/**
 * 라이브 대면 면접 녹음의 브라우저 로컬 보관 + 서버 업로드 (A안).
 *
 * 라이브 화면(Web Speech 받아쓰기)은 그대로 두고, 오디오는 MediaRecorder 로 **병행** 녹음해
 * 이 모듈이 IndexedDB 에 청크로 쌓는다. 종료 시(또는 새로고침 후 복구 시) 그 오디오를 기존
 * 업로드 파이프라인(recorded_interviews 행에 attach → 워커 재전사·평가)에 태운다.
 *
 * 왜 IndexedDB 인가: 오디오가 브라우저 메모리(MediaRecorder)에만 있으면 새로고침 시 사라진다.
 * 매 청크를 IndexedDB 에 적재해 두면 업로드 도중 새로고침해도 유실 없이 다음 로드에서 재개된다.
 * (in-flight fetch 는 새로고침으로 abort 되지만, 오디오는 IndexedDB 에 남아 재업로드 가능.)
 * 설계: docs/LIVE_INTERVIEW_PLAN.md
 */

import { upload as blobUpload } from "@vercel/blob/client";

// 서버 MAX_AUDIO_BYTES(18MB) 와 동기 — 초과 시 업로드 전에 permanent 처리.
const MAX_AUDIO_BYTES = 18 * 1024 * 1024;

const DB_NAME = "intervia-live-rec";
const DB_VERSION = 1;
const SESSIONS = "sessions";
const CHUNKS = "chunks";

export type LiveRecSession = {
  riId: number;
  candidateId: number;
  round: "round1" | "round2";
  mime: string;
  // recording: 녹음 진행 중 / complete: 녹음 종료·업로드 대기(또는 재시도 대기)
  state: "recording" | "complete";
  durationSeconds: number;
  createdAt: number;
};

// part/offsetMs: 긴 면접은 8분 단위 파트로 나눠 녹음한다(각 파트가 완결 파일 = 개별 전사 가능).
// 한 요청으로 40분 이상을 전사시키면 모델이 발화를 뭉치고 뒷부분을 누락하기 때문(2026-07-30 실측).
// 예전 세션(파트 개념 없음)은 part=0·offsetMs=0 으로 읽혀 그대로 단일 파트 업로드된다.
type ChunkRow = {
  id?: number;
  riId: number;
  blob: Blob;
  part?: number;
  offsetMs?: number;
};

function hasIdb(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SESSIONS))
        db.createObjectStore(SESSIONS, { keyPath: "riId" });
      if (!db.objectStoreNames.contains(CHUNKS)) {
        const os = db.createObjectStore(CHUNKS, {
          keyPath: "id",
          autoIncrement: true,
        });
        os.createIndex("riId", "riId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function reqAsync<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function txDone(t: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/** 세션 시작 기록 (녹음 시작 시 1회). */
export async function idbStartSession(s: LiveRecSession): Promise<void> {
  if (!hasIdb()) return;
  const db = await openDb();
  try {
    const t = db.transaction(SESSIONS, "readwrite");
    t.objectStore(SESSIONS).put(s);
    await txDone(t);
  } finally {
    db.close();
  }
}

/** 오디오 청크 1개 적재 (매 timeslice). 순차 호출로 순서 보존. */
export async function idbAppendChunk(
  riId: number,
  blob: Blob,
  part = 0,
  offsetMs = 0
): Promise<void> {
  if (!hasIdb() || !blob || blob.size === 0) return;
  const db = await openDb();
  try {
    const t = db.transaction(CHUNKS, "readwrite");
    (t.objectStore(CHUNKS) as IDBObjectStore).add({
      riId,
      blob,
      part,
      offsetMs,
    } as ChunkRow);
    await txDone(t);
  } finally {
    db.close();
  }
}

/** 녹음 종료 표시 (state=complete + 실측 길이). 이후 업로드 대상이 된다. */
export async function idbCompleteSession(
  riId: number,
  durationSeconds: number
): Promise<void> {
  if (!hasIdb()) return;
  const db = await openDb();
  try {
    const t = db.transaction(SESSIONS, "readwrite");
    const store = t.objectStore(SESSIONS);
    const cur = (await reqAsync(store.get(riId))) as LiveRecSession | undefined;
    if (cur) store.put({ ...cur, state: "complete", durationSeconds });
    await txDone(t);
  } finally {
    db.close();
  }
}

/** 세션 + 청크 전부 삭제 (업로드 성공/영구실패/정리 시). */
export async function idbDeleteSession(riId: number): Promise<void> {
  if (!hasIdb()) return;
  const db = await openDb();
  try {
    const t = db.transaction([SESSIONS, CHUNKS], "readwrite");
    t.objectStore(SESSIONS).delete(riId);
    const idx = t.objectStore(CHUNKS).index("riId");
    const keys = (await reqAsync(
      idx.getAllKeys(IDBKeyRange.only(riId))
    )) as IDBValidKey[];
    const chunkStore = t.objectStore(CHUNKS);
    for (const k of keys) chunkStore.delete(k);
    await txDone(t);
  } finally {
    db.close();
  }
}

/** 모든 세션 조회 (복구용). */
export async function idbListSessions(): Promise<LiveRecSession[]> {
  if (!hasIdb()) return [];
  const db = await openDb();
  try {
    const t = db.transaction(SESSIONS, "readonly");
    const all = (await reqAsync(
      t.objectStore(SESSIONS).getAll()
    )) as LiveRecSession[];
    return all;
  } finally {
    db.close();
  }
}

type AssembledPart = { part: number; offsetMs: number; blob: Blob };

/** 파트별로 조립 — 같은 part 의 timeslice 청크들을 이어 붙여 완결 파일 1개로 만든다. */
async function idbAssembleParts(
  riId: number,
  mime: string
): Promise<AssembledPart[]> {
  if (!hasIdb()) return [];
  const db = await openDb();
  try {
    const t = db.transaction(CHUNKS, "readonly");
    const idx = t.objectStore(CHUNKS).index("riId");
    const rows = (await reqAsync(
      idx.getAll(IDBKeyRange.only(riId))
    )) as ChunkRow[];
    // 삽입 순서(id) 보장 — 인덱스 getAll 이 뒤섞여도 안전하게 정렬.
    rows.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
    if (rows.length === 0) return [];
    const groups = new Map<number, { offsetMs: number; blobs: Blob[] }>();
    for (const r of rows) {
      const p = r.part ?? 0;
      const g = groups.get(p);
      if (g) g.blobs.push(r.blob);
      else groups.set(p, { offsetMs: r.offsetMs ?? 0, blobs: [r.blob] });
    }
    return [...groups.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([part, g]) => ({
        part,
        offsetMs: g.offsetMs,
        blob: new Blob(g.blobs, { type: mime }),
      }))
      .filter((p) => p.blob.size > 0);
  } finally {
    db.close();
  }
}

export type UploadResult = "uploaded" | "empty" | "permanent" | "retry";

/**
 * IndexedDB 에 쌓인 오디오를 조립해 기존 recorded_interviews 행에 attach(업로드).
 *  - uploaded  : 서버가 queued 로 받음 → IndexedDB 정리.
 *  - empty     : 청크 없음(오디오 미생성) → 정리. 호출자는 텍스트 폴백으로.
 *  - permanent : 4xx(파일 문제·크기초과 등) → 재시도 무의미, 정리 + 사용자 통지.
 *  - retry     : 네트워크/5xx → IndexedDB 유지, 다음 로드에서 복구가 재시도.
 */
export async function uploadLiveRecording(
  s: LiveRecSession
): Promise<UploadResult> {
  const parts = await idbAssembleParts(s.riId, s.mime);
  if (parts.length === 0) {
    await idbDeleteSession(s.riId);
    return "empty";
  }
  // 파트 1건 크기 초과는 재시도해도 무의미 — 정리 + permanent(호출자가 '파일 다시 올려주세요' 통지).
  if (parts.some((p) => p.blob.size > MAX_AUDIO_BYTES)) {
    await idbDeleteSession(s.riId);
    return "permanent";
  }
  const ext = s.mime.includes("mp4") ? "mp4" : s.mime.includes("ogg") ? "ogg" : "webm";
  const files = parts.map((p) => ({
    offsetMs: p.offsetMs,
    file: new File([p.blob], `live-${s.riId}-p${p.part}.${ext}`, { type: s.mime }),
  }));
  const durationSeconds = Math.max(0, Math.round(s.durationSeconds));

  // Vercel 함수 본문 한도(4.5MB) 회피 — Blob 직접 업로드 후 서버엔 URL manifest 만 전송.
  // dev/blob 미설정은 FormData 폴백. 업로드/전송 실패는 retry(IndexedDB 유지 → 다음 로드 재개).
  const useBlobUpload = process.env.NEXT_PUBLIC_BLOB_CLIENT_UPLOAD === "1";
  let r: Response;
  try {
    if (useBlobUpload) {
      const uploaded: Array<{ url: string; offsetMs: number; size: number }> = [];
      for (const f of files) {
        const up = await blobUpload(f.file.name, f.file, {
          access: "private",
          handleUploadUrl: `/api/blob/upload`,
          clientPayload: JSON.stringify({
            candidateId: s.candidateId,
            kind: "audio",
          }),
          multipart: f.file.size > 8 * 1024 * 1024,
        });
        uploaded.push({
          url: up.url,
          offsetMs: f.offsetMs,
          size: f.file.size,
        });
      }
      r = await fetch(`/api/candidates/${s.candidateId}/recorded-interview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioParts: uploaded,
          audioMime: s.mime,
          round: s.round,
          consentConfirmed: true,
          recordedInterviewId: s.riId,
          durationSeconds,
        }),
      });
    } else {
      const fd = new FormData();
      // 파트가 여럿이면 audio 필드를 여러 번 — 서버가 getAll 로 순서대로 받는다.
      for (const f of files) fd.append("audio", f.file);
      fd.append("offsets", JSON.stringify(files.map((f) => f.offsetMs)));
      fd.append("round", s.round);
      fd.append("consentConfirmed", "true");
      fd.append("recordedInterviewId", String(s.riId));
      fd.append("durationSeconds", String(durationSeconds));
      r = await fetch(`/api/candidates/${s.candidateId}/recorded-interview`, {
        method: "POST",
        body: fd,
      });
    }
  } catch {
    return "retry"; // 네트워크·업로드 실패 — 유실 없이 다음 로드에서 재시도.
  }
  if (r.ok) {
    await idbDeleteSession(s.riId);
    return "uploaded";
  }
  if (r.status >= 400 && r.status < 500) {
    await idbDeleteSession(s.riId);
    return "permanent";
  }
  return "retry"; // 5xx — 서버 일시 오류, 재시도 대상.
}
