"""
개인정보 마스킹.

레벨:
  basic     — 정규식만 (RRN, 전화, 이메일, URL, 생년월일, 우편번호)
  standard  — basic + 라벨 기반(이름/주소/소속) + 사전(대학명, 시도/구)
  strict    — standard + NER (선택 — koelectra-ner 설치 시)

알려진 식별자(이름/전화/이메일 등)는 KnownPII 로 넘겨주면 strict literal 매칭으로 즉시 치환.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data"


# ---------- 알려진 PII (외부 입력) ----------

@dataclass
class KnownPII:
    name: str | None = None
    phones: list[str] = field(default_factory=list)
    emails: list[str] = field(default_factory=list)
    address: str | None = None
    extras: list[str] = field(default_factory=list)  # 사용자 추가 토큰


# ---------- 정규식 (basic) ----------

# 주민등록번호: 6자리-7자리, 두번째 그룹 첫 숫자 1-4 (외국인 5-8 도 포함)
_RE_RRN = re.compile(r"\b\d{6}\s?[-]\s?[1-8]\d{6}\b")
# 한국 휴대전화 / 지역번호 전화 (앞뒤 단어경계 + 공백/점/하이픈 구분자)
_RE_PHONE = re.compile(
    r"(?<!\d)(?:\+?82[-.\s]?)?0?1[016-9][-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)"
    r"|(?<!\d)0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)"
)
_RE_EMAIL = re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b")
_RE_URL = re.compile(r"https?://\S+|www\.\S+")
# 우편번호 (5자리, 단어경계)
_RE_ZIP = re.compile(r"(?<!\d)\d{5}(?!\d)(?=\s*(?:\(\s*우\s*\)|우편|$))|\(\s*\d{5}\s*\)")

# 생년월일 — 한국/중문/숫자 표기
_RE_DOB = re.compile(
    r"(?:"
    # 1990.05.15 / 1990-5-15 / 1990/5/15 / 1990년 5월 15일 / 1990年5月15日
    r"\b(?:19|20)\d{2}\s*[.\-/년年]\s*(?:1[0-2]|0?[1-9])\s*[.\-/월月]\s*(?:3[01]|[12]\d|0?[1-9])\s*[일日]?"
    # 1990년 12월 / 1990年12月 (일 없음)
    r"|\b(?:19|20)\d{2}\s*[년年]\s*(?:1[0-2]|0?[1-9])\s*[월月]"
    r")"
    r"(?:\s*\(?[생出]\)?|\s*출생|\s*出生)?"
)

# 도로명 주소: "OO로 123", "OO길 12-3" + 추가 동/호/번지
_RE_ROAD_ADDR = re.compile(
    r"[가-힣A-Za-z0-9·]+(?:로|길)\s?\d+(?:[-]\d+)?(?:번지?)?"
    r"(?:\s*,?\s*\d+(?:동|호|층))*"
)
# 지번 주소 일부: "OO동 123-45"
_RE_JIBUN = re.compile(r"[가-힣]+동\s?\d+(?:[-]\d+)?(?:번지)?")


# ---------- 라벨 기반 (standard) ----------

# 라벨 → 마스킹 대체 토큰. 한글 / 영문 / 중문(번체+간체) 라벨 모두 지원.
_LABELS: list[tuple[re.Pattern[str], str]] = [
    (
        re.compile(
            r"(이\s*름|성\s*명|성명|Name|姓\s*名)\s*[:：·▶▷-]?\s*([^\n,/]{1,30})"
        ),
        "[이름]",
    ),
    (
        re.compile(
            r"(주\s*소|거주지|현주소|Address|地\s*址|住\s*址)\s*[:：·▶▷-]?\s*([^\n]{2,80})"
        ),
        "[주소]",
    ),
    (
        re.compile(
            r"(생년월일|출생|생일|DOB|Birth|出\s*生(?:\s*日期)?|生\s*日)\s*[:：·▶▷-]?\s*([^\n,]{4,30})"
        ),
        "[생년월일]",
    ),
    (
        re.compile(
            r"(연락처|전화|휴대폰|핸드폰|Mobile|Phone|Tel|電\s*話|电\s*话|手\s*[機机])\s*[:：·▶▷-]?\s*([^\n,]{6,30})"
        ),
        "[전화]",
    ),
    (
        re.compile(
            r"(이메일|메일|E[-]?mail|Email|電\s*郵|电\s*邮|邮\s*箱|郵\s*箱)\s*[:：·▶▷-]?\s*([^\n\s,]{4,80})"
        ),
        "[이메일]",
    ),
]


# ---------- 사전 로딩 (standard) ----------

def _load_dict(filename: str) -> list[str]:
    p = DATA_DIR / filename
    if not p.exists():
        return []
    out: list[str] = []
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        out.append(line)
    # 긴 것부터 매칭하도록 정렬 (예: "서울대학교" 먼저, "서울" 나중)
    return sorted(set(out), key=len, reverse=True)


_UNIVERSITIES: list[str] = []
_REGIONS: list[str] = []


def _ensure_dicts() -> None:
    global _UNIVERSITIES, _REGIONS
    if not _UNIVERSITIES:
        merged = _load_dict("universities.txt") + _load_dict("universities_intl.txt")
        # 다시 길이 내림차순 정렬
        _UNIVERSITIES = sorted(set(merged), key=len, reverse=True)
    if not _REGIONS:
        _REGIONS = _load_dict("regions.txt")


# ---------- masking core ----------

def _apply_basic(text: str) -> str:
    text = _RE_RRN.sub("[주민번호]", text)
    text = _RE_DOB.sub("[생년월일]", text)
    text = _RE_PHONE.sub("[전화]", text)
    text = _RE_EMAIL.sub("[이메일]", text)
    text = _RE_URL.sub("[URL]", text)
    text = _RE_ROAD_ADDR.sub("[주소]", text)
    text = _RE_JIBUN.sub("[주소]", text)
    text = _RE_ZIP.sub("[우편번호]", text)
    return text


def _apply_labels(text: str) -> str:
    def _repl_factory(replacement: str):
        def _r(m: re.Match[str]) -> str:
            label = m.group(1)
            return f"{label}: {replacement}"

        return _r

    for pat, repl in _LABELS:
        text = pat.sub(_repl_factory(repl), text)
    return text


def _apply_dictionaries(text: str) -> str:
    _ensure_dicts()
    # 대학명 — 단어 경계는 한글 환경에서 깨지므로 직접 substring 치환
    for u in _UNIVERSITIES:
        if u in text:
            text = text.replace(u, "[학교]")
    for r in _REGIONS:
        if r in text:
            text = text.replace(r, "[지역]")
    return text


def _apply_known(text: str, known: KnownPII) -> str:
    if known.name:
        # 이름은 2-4자 한글이라 false positive 위험. 그래도 라벨/단독 등장 모두 안전하게 치환.
        text = text.replace(known.name, "[이름]")
    for p in known.phones:
        if p:
            text = text.replace(p, "[전화]")
    for e in known.emails:
        if e:
            text = text.replace(e, "[이메일]")
    if known.address:
        text = text.replace(known.address, "[주소]")
    for ex in known.extras:
        if ex:
            text = text.replace(ex, "[기타]")
    return text


# ---------- 옵션: NER (strict) ----------

def _apply_ner(text: str) -> tuple[str, list[str]]:
    """선택. transformers + 한국어 NER 모델이 있으면 사용."""
    warnings: list[str] = []
    try:
        from transformers import pipeline  # type: ignore
    except ImportError:
        warnings.append(
            "strict 모드: transformers 미설치. `pip install transformers torch` 후 다시 시도."
        )
        return text, warnings
    try:
        # 가벼운 한국어 NER 모델
        ner = pipeline(
            "ner",
            model="monologg/koelectra-base-finetuned-naver-ner",
            aggregation_strategy="simple",
        )
    except Exception as e:  # 모델 로드 실패
        warnings.append(f"strict 모드: NER 모델 로드 실패 ({e}). standard 결과만 적용.")
        return text, warnings

    spans: list[tuple[int, int, str]] = []
    # 모델은 보통 chunk 단위로 자르는 게 안전 — 여기는 단순화
    try:
        entities = ner(text[:5000])  # 안전상 앞 5000자만
    except Exception as e:
        warnings.append(f"strict 모드: NER 추론 실패 ({e}).")
        return text, warnings
    label_map = {"PER": "[이름]", "ORG": "[조직]", "LOC": "[지역]"}
    for ent in entities or []:
        kind = str(ent.get("entity_group", "")).upper()
        repl = label_map.get(kind)
        if not repl:
            continue
        s, e = int(ent["start"]), int(ent["end"])
        spans.append((s, e, repl))
    # 뒤에서부터 치환 (오프셋 안 깨짐)
    spans.sort(key=lambda x: x[0], reverse=True)
    out = text
    for s, e, repl in spans:
        out = out[:s] + repl + out[e:]
    return out, warnings


# ---------- entrypoint ----------

def mask(
    text: str,
    level: str = "standard",
    known: KnownPII | None = None,
) -> tuple[str, list[str]]:
    """
    text 를 마스킹한 (masked, warnings) 반환.
    level: basic | standard | strict
    """
    warnings: list[str] = []
    out = text

    # 1) 알려진 PII 먼저 (가장 정확)
    if known:
        out = _apply_known(out, known)

    # 2) 라벨 기반 (basic 이상)
    if level in ("standard", "strict"):
        out = _apply_labels(out)

    # 3) 정규식 (모든 레벨)
    out = _apply_basic(out)

    # 4) 사전 매칭 (standard 이상)
    if level in ("standard", "strict"):
        out = _apply_dictionaries(out)

    # 5) NER (strict)
    if level == "strict":
        out, ner_warn = _apply_ner(out)
        warnings.extend(ner_warn)

    return out, warnings
