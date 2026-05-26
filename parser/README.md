# 텍스트 추출기 (Python)

이력서/문서를 LLM에 넘기기 전에 **정확한 텍스트만** 뽑아내는 CLI.

## 지원 포맷

| 확장자 | 엔진 | 폴백 |
|---|---|---|
| `.pdf` | `pymupdf` (fitz) | `pdfplumber` |
| `.html`, `.htm` | `trafilatura` (본문 추출 — 네비/푸터 자동 제거) | `BeautifulSoup` |
| `.txt`, `.md` | 인코딩 자동감지(`charset-normalizer`) | UTF-8 |

OCR 미지원. 스캔 PDF는 `warnings` 로 안내.

## 설치

```bash
# 1) 가상환경 권장
python -m venv .venv
.venv\Scripts\activate         # Windows
# source .venv/bin/activate    # macOS/Linux

# 2) 의존성
pip install -r requirements.txt
```

## 사용

```bash
# 기본 — JSON 1줄
python extract.py resume.pdf

# 보기 좋게
python extract.py resume.pdf --pretty

# 개인정보 마스킹 (디폴트 = standard)
python extract.py resume.pdf --mask
python extract.py resume.pdf --mask basic       # 정규식만
python extract.py resume.pdf --mask standard    # +라벨+사전
python extract.py resume.pdf --mask strict      # +NER (transformers 필요)

# 이미 알고 있는 PII를 강제 마스킹 (가장 정확)
python extract.py resume.pdf --mask \
  --known-name "홍길동" \
  --known-phone "010-1234-5678" \
  --known-email "hong@example.com" \
  --known-address "서울시 강남구 테헤란로 123"

# 원문 제거하고 마스킹 텍스트만 (LLM 전달용)
python extract.py resume.pdf --mask --masked-only

# 텍스트만 (JSON X)
python extract.py resume.pdf --text-only > resume.txt
```

## 출력 (JSON)

```json
{
  "filename": "resume.pdf",
  "extension": "pdf",
  "engine": "pymupdf",
  "pageCount": 3,
  "charCount": 4521,
  "text": "이력서\n홍길동...",
  "maskedText": null,
  "warnings": []
}
```

`--mask` 사용 시 `maskedText` 채워짐.

## 마스킹 레벨

| 레벨 | 처리 |
|---|---|
| `basic` | 정규식만: 주민번호, 전화, 이메일, URL, 생년월일, 우편번호, 도로명·지번 주소 |
| `standard` (디폴트) | basic + **라벨 기반**(이름·주소·연락처·생년월일·이메일 라벨 다음 토큰) + **사전 매칭**(한국 대학 ~250개, 행정구역 ~200개) |
| `strict` | standard + **NER** (`transformers` + `torch` 설치 시 자동 시도; koelectra-ner 모델). PER/ORG/LOC 추가 마스킹 |

전 레벨 공통: `--known-name/--known-phone/--known-email/--known-address` 로 외부에서 알려진 식별자는 **strict literal 치환** — 가장 정확. interviewer 의 candidates 테이블에 LLM이 미리 추출한 phone/email 등을 함께 넘기면 마스킹 품질이 크게 올라감.

## 마스킹 패턴 (basic)

| 식별자 | 토큰 |
|---|---|
| 한국 휴대/일반 전화 (+82 / 0XX / 010-…) | `[전화]` |
| 이메일 | `[이메일]` |
| 주민등록번호 (6-7자리, 외국인 5-8 포함) | `[주민번호]` |
| 생년월일 (`1990.01.01`, `1990년 1월 1일`, `1990-01-01 생` …) | `[생년월일]` |
| 우편번호 (5자리) | `[우편번호]` |
| 도로명/지번 주소 일부 | `[주소]` |
| URL | `[URL]` |

## 마스킹 패턴 (standard 추가)

- 라벨 기반: `이름/성명/Name`, `주소/Address`, `생년월일/DOB`, `연락처/전화/Phone/Tel`, `이메일/E-mail/Email` 라벨 뒤 토큰
- 사전 매칭: `parser/data/universities.txt` → `[학교]`, `parser/data/regions.txt` → `[지역]`
- 사전은 단순 텍스트 파일이라 자유롭게 추가/수정 가능 (한 줄에 하나, `#` 주석)

## 한계

| 식별자 | 한계 |
|---|---|
| 한글 이름 (라벨 없을 때) | 정규식/사전으로 잡기 어려움. `--known-name` 또는 `strict` 모드 권장 |
| 회사명 | 일반 명사처럼 보이는 회사명은 사전화 불가. `strict` NER 또는 `--known-*` 보강 |
| 사진 | 텍스트 추출 단계에서 자동 제외 (이미지 OCR 안 함) |
| 외국인등록번호 / 사업자번호 | 별도 정규식 미포함 — 필요 시 추가 |

## interviewer 와 연동 (선택)

Next.js 서버에서 subprocess 로 호출:

```ts
import { spawn } from "node:child_process";

function extractWithPython(filePath: string): Promise<{ text: string; warnings: string[] }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("python", ["parser/extract.py", filePath, "--mask"]);
    let out = "";
    let err = "";
    proc.stdout.on("data", (c) => (out += c));
    proc.stderr.on("data", (c) => (err += c));
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(err || `python exit ${code}`));
      try {
        resolve(JSON.parse(out));
      } catch (e) {
        reject(e);
      }
    });
  });
}
```

**제약**: Vercel serverless 에서는 Python 런타임이 별도 함수로만 동작 (Node 함수 안에서 subprocess 호출 불가). 옵션:
1. 로컬/자체 호스팅 (Docker 등) — subprocess OK
2. Vercel Python Function 으로 분리 (`/api/extract.py`) + Next.js 가 fetch
3. 별도 FastAPI 마이크로서비스

## 테스트

```bash
python extract.py ../uploads/<some-resume>.pdf --pretty
```
