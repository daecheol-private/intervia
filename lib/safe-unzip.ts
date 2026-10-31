/**
 * 압축폭탄 안전 ZIP 해제 (DOCX/HWPX/ZIP 공용, 보안감사 H9).
 *
 * fflate `unzipSync` 는 엔트리마다 선언 크기(originalSize)만큼 버퍼를 잡고 전부 푼 뒤에야
 * 호출부가 크기를 볼 수 있다 → 선언 크기 합이 수 GB 면 OOM. 선언 크기를 속이면(작게 선언)
 * 메모리는 막혀도 실제 팽창량만큼 동기 CPU 를 태운다.
 *
 * 그래서 중앙 디렉토리를 직접 읽어(fflate unzipSync 와 같은 규칙) ①해제 전에 엔트리 수·
 * 선언 크기 합을 검사하고 ②필요한 엔트리만 스트리밍 inflate 하며 실제 출력이 선언 크기를
 * 넘는 순간 중단한다. 정상 파일의 결과는 unzipSync 와 동일하다.
 */
import { Inflate, strFromU8 } from "fflate";

export type ZipEntryMeta = {
  name: string;
  size: number; // 압축 크기
  originalSize: number; // 선언된 해제 크기
  compression: number;
};

export type ZipLimits = {
  maxEntries: number; // 중앙 디렉토리 전체 엔트리 수
  maxEntryBytes: number; // 해제 대상 엔트리 1개
  maxTotalBytes: number; // 해제 대상 엔트리 합계
};

export class ZipLimitError extends Error {
  constructor(
    public readonly code:
      | "too_many_entries"
      | "entry_too_large"
      | "total_too_large"
      | "size_mismatch",
    message: string
  ) {
    super(message);
    this.name = "ZipLimitError";
  }
}

const b2 = (d: Uint8Array, b: number) => d[b] | (d[b + 1] << 8);
const b4 = (d: Uint8Array, b: number) =>
  (d[b] | (d[b + 1] << 8) | (d[b + 2] << 16) | (d[b + 3] << 24)) >>> 0;
const b8 = (d: Uint8Array, b: number) => b4(d, b) + b4(d, b + 4) * 4294967296;

type Located = ZipEntryMeta & { start: number };

/** 중앙 디렉토리 순회 (fflate unzipSync 와 동일 규칙). 해제는 하지 않는다. */
function walkCentralDirectory(
  data: Uint8Array,
  maxEntries: number,
  visit: (e: Located) => void
): void {
  if (data.length < 22) throw new Error("invalid zip data");
  let e = data.length - 22;
  for (; b4(data, e) != 0x6054b50; --e) {
    if (!e || data.length - e > 65558) throw new Error("invalid zip data");
  }
  let c = b2(data, e + 8);
  if (!c) return;
  let o = b4(data, e + 16);
  let z = b4(data, e - 20) == 0x7064b50;
  if (z) {
    const ze = b4(data, e - 12);
    z = b4(data, ze) == 0x6064b50;
    if (z) {
      c = b4(data, ze + 32);
      o = b4(data, ze + 48);
    }
  }
  if (c > maxEntries)
    throw new ZipLimitError("too_many_entries", `압축 항목이 너무 많습니다 (최대 ${maxEntries}개).`);
  for (let i = 0; i < c; ++i) {
    const fnl = b2(data, o + 28);
    const efl = b2(data, o + 30);
    const name = strFromU8(data.subarray(o + 46, o + 46 + fnl), !(b2(data, o + 8) & 2048));
    const es = o + 46 + fnl;
    let sc = b4(data, o + 20);
    let su = b4(data, o + 24);
    let off = b4(data, o + 42);
    const nsc = sc == 4294967295 ? 1 : 0;
    const nsu = su == 4294967295 ? 1 : 0;
    const noff = off == 4294967295 ? 1 : 0;
    if (z && nsc + nsu + noff) {
      let found = false;
      for (let b = es; b + 4 < es + efl; b += 4 + b2(data, b + 2)) {
        if (b2(data, b) == 1) {
          const nsc2 = nsc ? b8(data, b + 4 + 8 * nsu) : sc;
          const nsu2 = nsu ? b8(data, b + 4) : su;
          off = noff ? b8(data, b + 4 + 8 * (nsu + nsc)) : off;
          sc = nsc2;
          su = nsu2;
          found = true;
          break;
        }
      }
      if (!found) throw new Error("invalid zip data");
    }
    const compression = b2(data, o + 10);
    o = es + efl + b2(data, o + 32);
    const start = off + 30 + b2(data, off + 26) + b2(data, off + 28);
    visit({ name, size: sc, originalSize: su, compression, start });
  }
}

const CHUNK = 32 * 1024; // 32KB 입력당 최대 팽창 ~33MB — 한 push 의 순간 메모리 상한

/** 스트리밍 inflate. 출력이 limit 을 넘는 즉시 중단. out 이 없으면 바이트만 센다. */
function inflateBounded(
  src: Uint8Array,
  limit: number,
  name: string,
  out?: Uint8Array
): number {
  let pos = 0;
  const inf = new Inflate((chunk) => {
    if (pos + chunk.length > limit)
      throw new ZipLimitError("size_mismatch", `압축 항목 크기가 선언과 다릅니다: ${name}`);
    if (out) out.set(chunk, pos);
    pos += chunk.length;
  });
  if (src.length === 0) {
    inf.push(src, true);
    return pos;
  }
  for (let i = 0; i < src.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, src.length);
    inf.push(src.subarray(i, end), end === src.length);
  }
  return pos;
}

function selectEntries(
  data: Uint8Array,
  limits: ZipLimits,
  filter?: (e: ZipEntryMeta) => boolean
): Located[] {
  const picked: Located[] = [];
  let total = 0;
  walkCentralDirectory(data, limits.maxEntries, (e) => {
    if (filter && !filter({ name: e.name, size: e.size, originalSize: e.originalSize, compression: e.compression }))
      return;
    if (e.compression !== 0 && e.compression !== 8)
      throw new Error("unknown compression type " + e.compression);
    // stored 는 fflate 처럼 압축 크기만큼 그대로 복사한다.
    const bytes = e.compression === 0 ? e.size : e.originalSize;
    if (bytes > limits.maxEntryBytes)
      throw new ZipLimitError("entry_too_large", `압축 항목이 너무 큽니다: ${e.name}`);
    total += bytes;
    if (total > limits.maxTotalBytes)
      throw new ZipLimitError("total_too_large", "압축 해제 후 총 크기가 너무 큽니다.");
    picked.push(e);
  });
  return picked;
}

/**
 * `unzipSync(data, { filter })` 의 안전 버전. 반환 형태·이름 디코딩·순서가 동일하다.
 * 한도 초과는 ZipLimitError, 손상 ZIP 은 일반 Error.
 */
export function safeUnzipSync(
  data: Uint8Array,
  limits: ZipLimits,
  filter?: (e: ZipEntryMeta) => boolean
): Record<string, Uint8Array> {
  const picked = selectEntries(data, limits, filter);
  const files: Record<string, Uint8Array> = {};
  for (const e of picked) {
    if (e.compression === 0) {
      // Buffer.slice 는 뷰라서 명시적으로 복사 (fflate slc 와 동일)
      files[e.name] = new Uint8Array(data.subarray(e.start, e.start + e.size));
    } else {
      const out = new Uint8Array(e.originalSize);
      const n = inflateBounded(data.subarray(e.start, e.start + e.size), e.originalSize, e.name, out);
      files[e.name] = out.subarray(0, n);
    }
  }
  return files;
}

/**
 * 해제 결과를 보관하지 않고 한도만 검증 (mammoth 처럼 내부에서 따로 푸는 라이브러리에
 * 넘기기 전 사전검사용). 모든 엔트리를 실제로 스트리밍 해제해 선언 크기 위조까지 잡는다.
 */
export function assertZipWithinLimits(data: Uint8Array, limits: ZipLimits): void {
  for (const e of selectEntries(data, limits)) {
    if (e.compression === 8)
      inflateBounded(data.subarray(e.start, e.start + e.size), e.originalSize, e.name);
  }
}
