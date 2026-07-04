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

type ChunkRow = { id?: number; riId: number; blob: Blob };

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
export async function idbAppendChunk(riId: number, blob: Blob): Promise<void> {
  if (!hasIdb() || !blob || blob.size === 0) return;
  const db = await openDb();
  try {
    const t = db.transaction(CHUNKS, "readwrite");
    (t.objectStore(CHUNKS) as IDBObjectStore).add({ riId, blob } as ChunkRow);
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

async function idbAssembleBlob(riId: number, mime: string): Promise<Blob | null> {
  if (!hasIdb()) return null;
  const db = await openDb();
  try {
    const t = db.transaction(CHUNKS, "readonly");
    const idx = t.objectStore(CHUNKS).index("riId");
    const rows = (await reqAsync(
      idx.getAll(IDBKeyRange.only(riId))
    )) as ChunkRow[];
    // 삽입 순서(id) 보장 — 인덱스 getAll 이 뒤섞여도 안전하게 정렬.
    rows.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
    if (rows.length === 0) return null;
    return new Blob(
      rows.map((r) => r.blob),
      { type: mime }
    );
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
  const blob = await idbAssembleBlob(s.riId, s.mime);
  if (!blob || blob.size === 0) {
    await idbDeleteSession(s.riId);
    return "empty";
  }
  const ext = s.mime.includes("mp4") ? "mp4" : s.mime.includes("ogg") ? "ogg" : "webm";
  const fd = new FormData();
  fd.append("audio", new File([blob], `live-${s.riId}.${ext}`, { type: s.mime }));
  fd.append("round", s.round);
  fd.append("consentConfirmed", "true");
  fd.append("recordedInterviewId", String(s.riId));
  fd.append("durationSeconds", String(Math.max(0, Math.round(s.durationSeconds))));

  let r: Response;
  try {
    r = await fetch(`/api/candidates/${s.candidateId}/recorded-interview`, {
      method: "POST",
      body: fd,
    });
  } catch {
    return "retry"; // 네트워크 — 유실 없이 다음 로드에서 재시도.
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
