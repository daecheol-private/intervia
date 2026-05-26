"""마스킹 테스트 — 다양한 언어/포맷 케이스."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from mask import mask, KnownPII  # noqa: E402


# (제목, 입력, 기대 토큰 리스트, 사라져야 할 원본 토큰 리스트, level, known)
CASES: list[tuple[str, str, list[str], list[str], str, KnownPII | None]] = [
    # ---------- 한국어 ----------
    (
        "한글 라벨 - 기본",
        """이름: 홍길동
생년월일: 1990.05.15
연락처: 010-1234-5678
이메일: hong@test.com
주소: 서울시 강남구 테헤란로 123, 4층 501호""",
        ["[이름]", "[생년월일]", "[전화]", "[이메일]", "[주소]"],
        ["홍길동", "1990", "010-1234-5678", "hong@test.com", "테헤란로"],
        "standard",
        None,
    ),
    (
        "한글 - 라벨 없는 이름 (실패 기대)",
        """김철수
백엔드 개발자
경력 5년""",
        [],
        [],
        "standard",
        None,
    ),
    (
        "한글 - known-name 사용",
        """김철수
백엔드 개발자
경력 5년""",
        ["[이름]"],
        ["김철수"],
        "standard",
        KnownPII(name="김철수"),
    ),
    (
        "한글 - 주민번호 다양한 표기",
        """주민번호: 900515-1234567
RRN 800101 - 2345678
외국인등록번호: 950310-5678901""",
        ["[주민번호]"],
        ["900515-1234567", "800101", "950310"],
        "basic",
        None,
    ),
    (
        "한글 - 전화 다양한 표기",
        """+82-10-1234-5678
010 1234 5678
010-1234-5678
02-555-1234
031.987.6543""",
        ["[전화]"],
        ["1234-5678", "555-1234"],
        "basic",
        None,
    ),
    (
        "한글 - 생년월일 다양한 표기",
        """1990.05.15
1990년 5월 15일
1990-05-15
1990/5/15
1990.5.15 (생)
1985년 12월 출생""",
        ["[생년월일]"],
        ["1990.05.15", "1990년", "1985년"],
        "basic",
        None,
    ),
    (
        "한글 - 학교 사전 매칭",
        """학력: 서울대학교 컴퓨터공학과
대학원: KAIST 인공지능 석사
교환학생: 연세대학교""",
        ["[학교]"],
        ["서울대학교", "KAIST", "연세대학교"],
        "standard",
        None,
    ),
    (
        "한글 - 주소 도로명/지번",
        """현주소: 서울특별시 종로구 청계천로 100
구주소: 서대문구 신촌동 134-1""",
        ["[주소]"],
        ["청계천로", "신촌동"],
        "standard",
        None,
    ),
    # ---------- 영문 ----------
    (
        "영문 라벨 - 기본",
        """Name: John Doe
DOB: 1990-05-15
Phone: +1-555-123-4567
Email: john.doe@example.com
Address: 123 Main St, Apt 4B, New York, NY 10001""",
        ["[이름]", "[생년월일]", "[전화]", "[이메일]", "[주소]"],
        ["John Doe", "1990-05-15", "john.doe@example.com"],
        "standard",
        None,
    ),
    (
        "영문 - 외국 학교",
        """Education:
- Harvard University, B.S. Computer Science
- Stanford University, M.S. AI
- MIT Media Lab""",
        ["[학교]"],
        ["Harvard University", "Stanford University", "MIT"],
        "standard",
        None,
    ),
    (
        "영문 - 라벨 없는 이름 + known",
        """John Doe
Senior Software Engineer
5+ years experience""",
        ["[이름]"],
        ["John Doe"],
        "standard",
        KnownPII(name="John Doe"),
    ),
    # ---------- 중문 ----------
    (
        "중문 라벨 - 기본",
        """姓名: 王力宏
出生: 1980年5月1日
電話: +886 912-345-678
電郵: wang@example.com.tw
地址: 台北市信義區忠孝東路五段100號""",
        ["[이름]", "[생년월일]", "[이메일]"],
        ["王力宏", "wang@example.com.tw"],
        "standard",
        None,
    ),
    (
        "중문 - 외국 학교",
        """教育背景:
- 清華大學 計算機科學 學士
- 北京大學 人工智能 碩士
- The University of Tokyo PhD""",
        ["[학교]"],
        ["清華大學", "北京大學", "The University of Tokyo"],
        "standard",
        None,
    ),
    # ---------- 보안 ----------
    (
        "URL 마스킹",
        """포트폴리오: https://johndoe.com/portfolio
GitHub: https://github.com/johndoe
LinkedIn: linkedin.com/in/johndoe""",
        ["[URL]"],
        ["https://johndoe.com", "https://github.com"],
        "basic",
        None,
    ),
    (
        "이메일 다양한 도메인",
        """me@gmail.com
user.name+filter@company.co.kr
admin@subdomain.example.org
test_123@my-domain.io""",
        ["[이메일]"],
        ["me@gmail.com", "user.name", "test_123"],
        "basic",
        None,
    ),
]


# ---------- runner ----------

GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
DIM = "\033[2m"
RESET = "\033[0m"


def run() -> int:
    pass_count = 0
    fail_count = 0
    for title, text, expected, must_disappear, level, known in CASES:
        masked, warns = mask(text, level=level, known=known)

        # 기대 토큰이 모두 등장하는지
        missing_expected = [tok for tok in expected if tok not in masked]
        # 원본 토큰이 모두 사라졌는지
        still_present = [tok for tok in must_disappear if tok in masked]

        ok = not missing_expected and not still_present
        if ok:
            pass_count += 1
            status = f"{GREEN}PASS{RESET}"
        else:
            fail_count += 1
            status = f"{RED}FAIL{RESET}"

        print(f"\n{status}  {title}  [{level}]")
        if missing_expected:
            print(f"  {YELLOW}기대 토큰 누락:{RESET} {missing_expected}")
        if still_present:
            print(f"  {YELLOW}원본 잔존:{RESET} {still_present}")
        if not ok:
            for line in masked.splitlines():
                print(f"  {DIM}|{RESET} {line}")
            if warns:
                print(f"  {DIM}warn: {warns}{RESET}")

    print(f"\n{'='*50}")
    print(f"통과 {GREEN}{pass_count}{RESET} / 실패 {RED}{fail_count}{RESET} / 전체 {len(CASES)}")
    return 0 if fail_count == 0 else 1


if __name__ == "__main__":
    sys.exit(run())
