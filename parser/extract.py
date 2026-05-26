#!/usr/bin/env python3
"""
이력서 / 문서 텍스트 추출기.

지원 포맷: .txt, .md, .pdf, .html, .htm
출력: JSON 1줄 (stdout)

사용:
  python extract.py path/to/file.pdf
  python extract.py path/to/file.pdf --pretty
  python extract.py path/to/file.pdf --mask     # 개인정보 마스킹 추가
"""
from __future__ import annotations

import argparse
import io
import json
import re
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path

# Windows 의 CP949 stdout 회피 — JSON은 항상 UTF-8 로 내보냄.
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", line_buffering=True)
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", line_buffering=True)


SUPPORTED_EXT = {".txt", ".md", ".pdf", ".html", ".htm"}
MIN_TEXT_LEN = 30  # interviewer 와 동일 기준


@dataclass
class ExtractResult:
    filename: str
    extension: str
    engine: str
    page_count: int | None
    char_count: int
    text: str
    warnings: list[str] = field(default_factory=list)
    masked_text: str | None = None


# ---------- normalizer ----------

_WS_RE = re.compile(r"[ \t]+")
_NL_RE = re.compile(r"\n{3,}")


def _normalize(text: str) -> str:
    # NBSP, ZWSP 등 제거
    text = text.replace(" ", " ").replace("​", "")
    # 줄 끝 공백 제거 + 공백 압축
    text = "\n".join(_WS_RE.sub(" ", line).rstrip() for line in text.splitlines())
    # 3개 이상 빈 줄 → 2개
    text = _NL_RE.sub("\n\n", text)
    return text.strip()


# ---------- engines ----------

def _read_plain(path: Path) -> ExtractResult:
    raw = path.read_bytes()
    try:
        from charset_normalizer import from_bytes  # type: ignore

        best = from_bytes(raw).best()
        text = str(best) if best else raw.decode("utf-8", errors="replace")
        engine = f"charset_normalizer({best.encoding if best else 'utf-8'})"
    except ImportError:
        text = raw.decode("utf-8", errors="replace")
        engine = "utf-8(fallback)"
    text = _normalize(text)
    return ExtractResult(
        filename=path.name,
        extension=path.suffix.lower().lstrip("."),
        engine=engine,
        page_count=None,
        char_count=len(text),
        text=text,
    )


def _read_pdf(path: Path) -> ExtractResult:
    warnings: list[str] = []
    text = ""
    page_count = 0
    engine = "pymupdf"
    try:
        import pymupdf  # type: ignore
    except ImportError:
        try:
            import fitz as pymupdf  # type: ignore
        except ImportError:
            pymupdf = None  # type: ignore

    if pymupdf is not None:
        with pymupdf.open(path) as doc:
            page_count = doc.page_count
            chunks: list[str] = []
            for page in doc:
                chunks.append(page.get_text("text"))
            text = "\n".join(chunks)
    else:
        # 폴백: pdfplumber
        try:
            import pdfplumber  # type: ignore
        except ImportError as e:
            raise RuntimeError(
                "PDF 라이브러리가 설치되어 있지 않습니다. `pip install pymupdf` 또는 `pip install pdfplumber`."
            ) from e
        engine = "pdfplumber"
        with pdfplumber.open(path) as pdf:
            page_count = len(pdf.pages)
            chunks = [p.extract_text() or "" for p in pdf.pages]
            text = "\n".join(chunks)

    text = _normalize(text)
    if len(text) < MIN_TEXT_LEN:
        warnings.append(
            "텍스트가 너무 짧습니다. 스캔 PDF일 가능성이 높습니다 (이 파서는 OCR 미지원)."
        )
    return ExtractResult(
        filename=path.name,
        extension="pdf",
        engine=engine,
        page_count=page_count,
        char_count=len(text),
        text=text,
        warnings=warnings,
    )


def _read_html(path: Path) -> ExtractResult:
    raw = path.read_bytes()
    try:
        from charset_normalizer import from_bytes  # type: ignore

        best = from_bytes(raw).best()
        html = str(best) if best else raw.decode("utf-8", errors="replace")
    except ImportError:
        html = raw.decode("utf-8", errors="replace")

    text = ""
    engine = "trafilatura"
    try:
        import trafilatura  # type: ignore

        extracted = trafilatura.extract(html, include_comments=False, include_tables=True)
        if extracted:
            text = extracted
    except ImportError:
        engine = ""

    if not text:
        # 폴백: BeautifulSoup
        try:
            from bs4 import BeautifulSoup  # type: ignore
        except ImportError as e:
            raise RuntimeError(
                "HTML 라이브러리가 없습니다. `pip install trafilatura beautifulsoup4`."
            ) from e
        engine = "beautifulsoup"
        soup = BeautifulSoup(html, "html.parser")
        for tag in soup(["script", "style", "noscript"]):
            tag.decompose()
        text = soup.get_text("\n")

    text = _normalize(text)
    return ExtractResult(
        filename=path.name,
        extension=path.suffix.lower().lstrip("."),
        engine=engine,
        page_count=None,
        char_count=len(text),
        text=text,
    )


# ---------- dispatcher ----------

def extract(path: Path) -> ExtractResult:
    if not path.is_file():
        raise FileNotFoundError(str(path))
    ext = path.suffix.lower()
    if ext not in SUPPORTED_EXT:
        raise ValueError(f"지원하지 않는 확장자: {ext}")
    if ext == ".pdf":
        return _read_pdf(path)
    if ext in (".html", ".htm"):
        return _read_html(path)
    return _read_plain(path)


# ---------- PII masking ----------
# 실제 마스킹 로직은 mask.py 로 이동.


# ---------- CLI ----------

def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="텍스트 추출기 + PII 마스킹")
    ap.add_argument("path", help="파일 경로")
    ap.add_argument("--pretty", action="store_true", help="JSON pretty print")
    ap.add_argument(
        "--mask",
        nargs="?",
        const="standard",
        choices=["basic", "standard", "strict"],
        help="마스킹 활성화. 인자 없으면 standard. basic=정규식만, strict=NER 시도",
    )
    ap.add_argument(
        "--masked-only",
        action="store_true",
        help="원문 text 는 비우고 maskedText 만 채움 (LLM 전달용)",
    )
    ap.add_argument("--known-name", help="외부에서 알려진 후보자 이름")
    ap.add_argument(
        "--known-phone",
        action="append",
        default=[],
        help="외부에서 알려진 전화 (반복 가능)",
    )
    ap.add_argument(
        "--known-email",
        action="append",
        default=[],
        help="외부에서 알려진 이메일 (반복 가능)",
    )
    ap.add_argument("--known-address", help="외부에서 알려진 주소")
    ap.add_argument("--text-only", action="store_true", help="텍스트만 stdout으로 (JSON X)")
    args = ap.parse_args(argv)

    path = Path(args.path).expanduser().resolve()
    try:
        result = extract(path)
    except FileNotFoundError:
        print(f"파일 없음: {path}", file=sys.stderr)
        return 2
    except ValueError as e:
        print(str(e), file=sys.stderr)
        return 2
    except Exception as e:
        print(f"추출 실패: {e}", file=sys.stderr)
        return 1

    if args.mask:
        from mask import KnownPII, mask as _mask

        known = KnownPII(
            name=args.known_name,
            phones=args.known_phone,
            emails=args.known_email,
            address=args.known_address,
        )
        masked, warns = _mask(result.text, level=args.mask, known=known)
        result.masked_text = masked
        result.warnings.extend(warns)

    if args.text_only:
        out_text = result.masked_text if (args.masked_only and result.masked_text) else result.text
        print(out_text)
        return 0

    payload = asdict(result)
    if args.masked_only and payload["masked_text"]:
        payload["text"] = ""
    # 키 일관성: 카멜 케이스 (interviewer 와 맞춤)
    payload_camel = {
        "filename": payload["filename"],
        "extension": payload["extension"],
        "engine": payload["engine"],
        "pageCount": payload["page_count"],
        "charCount": payload["char_count"],
        "text": payload["text"],
        "maskedText": payload["masked_text"],
        "warnings": payload["warnings"],
    }
    json.dump(
        payload_camel,
        sys.stdout,
        ensure_ascii=False,
        indent=2 if args.pretty else None,
    )
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
