/**
 * 브라우저용 — ZIP 파일이 암호(비밀번호)로 보호되어 있는지 빠르게 판별.
 *
 * 서버 `lib/zip-extract.ts` 의 isEncryptedZip 과 동일한 로직
 * (중앙 디렉토리 엔트리의 general purpose bit flag, bit 0 = 암호화).
 * 전체 파일을 읽지 않고 꼬리(EOCD) + 중앙 디렉토리 영역만 슬라이스해 검사하므로
 * 대용량 ZIP 도 업로드 시작 전에 즉시 판정 가능.
 *
 * 판단 불가(EOCD 미발견 등)면 false — 서버가 최종 검증한다.
 */
export async function isEncryptedZipFile(file: File): Promise<boolean> {
  const EOCD_SIG = 0x06054b50; // End Of Central Directory
  const CDH_SIG = 0x02014b50; // Central Directory File Header
  try {
    // EOCD 는 파일 끝에서 최대 22 + 64KB(주석) 이내.
    const maxBack = Math.min(file.size, 22 + 0xffff);
    const tail = new DataView(
      await file.slice(file.size - maxBack, file.size).arrayBuffer()
    );
    let eocd = -1;
    for (let i = tail.byteLength - 22; i >= 0; i--) {
      if (tail.getUint32(i, true) === EOCD_SIG) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) return false;
    const cdOffset = tail.getUint32(eocd + 16, true);
    const cdSize = tail.getUint32(eocd + 12, true);
    if (cdSize === 0) return false;
    const cd = new DataView(
      await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer()
    );
    let p = 0;
    while (p + 46 <= cd.byteLength) {
      if (cd.getUint32(p, true) !== CDH_SIG) break;
      const flag = cd.getUint16(p + 8, true);
      if (flag & 0x0001) return true; // bit 0 = 암호화
      const nameLen = cd.getUint16(p + 28, true);
      const extraLen = cd.getUint16(p + 30, true);
      const commentLen = cd.getUint16(p + 32, true);
      p += 46 + nameLen + extraLen + commentLen;
    }
    return false;
  } catch {
    // 슬라이스/디코딩 실패 — 서버 검증에 위임
    return false;
  }
}
