# 디자인 시스템 (v2 — 절제 / Forest + Ivory)

> **디자인·UI 작업 전 필독.** 새 화면·컴포넌트·색/간격/모서리 변경은 이 문서의 규칙을 따른다.
> - 토큰의 **진실의 원천**: [app/globals.css](../app/globals.css)
> - 공통 컴포넌트(프리미티브): [app/components/ui/](../app/components/ui/)
> - **살아있는 예시**: `/design` 쇼케이스 페이지

---

## 한 줄 철학

**거의 모노톤 + 포레스트 포인트 하나.** 각지고(작은 radius) 절제된 톤. **색으로 떠들지 않는다.**
구분은 색이 아니라 **굵기·간격·회색조**로 만든다.

---

## 🎨 색 규칙 (가장 중요)

화면에 색을 넣기 전, **이 순서로** 판단한다:

| # | 무엇인가 | 무엇을 쓰나 |
|---|---|---|
| 1 | **본문 텍스트** | `text-ink` / 보조 `text-ink-soft` / 흐림 `text-ink-muted` — **그 외 색 금지** |
| 2 | **배경** | `bg-surface`(페이지·ivory) / `bg-surface-alt`(구분·헤더·비활성) / `bg-card`(카드·모달·순백) |
| 3 | **강조 포인트** | **포레스트(`primary`) 하나만** — CTA·active·선택·권한자 |
| 4 | **장식 / 카테고리 / 역할 / 단계 (구분용 멀티휴)** | **회색조로 중립화.** 단 *활성·권한자* 항목만 예외적으로 포레스트 |
| 5 | **진짜 상태** | 합격/완료=`success` · 대기/주의=`warning` · 오류/삭제=`danger` · 안내=`info`. **꼭 필요할 때만 최소로** |
| 6 | **데이터 시각화** (차트·점수바·퍼널·레이더) | **다색 보존 OK** — 여기서만 색을 자유롭게 |

> **핵심**: "예뻐 보이려고" 색을 쓰지 않는다. 색은 **의미(상태·강조)가 있을 때만**.
> 빨강·파랑·노랑으로 "종류"를 구분하던 옛 패턴(역할 배지, 단계 색, 카테고리 알약 등)은 전부 회색조로 바꾼다.

---

## 토큰 레퍼런스

### 색 (Tailwind 유틸: `bg-primary` `text-ink` `border-border-default` …)

| 그룹 | 토큰 | 값 | 용도 |
|---|---|---|---|
| **브랜드** | `primary` | `#0d4f3c` (Deep Forest) | CTA·강조·active — **유일한 포인트 컬러** |
| | `primary-deep` | `#073529` | hover/pressed |
| | `primary-soft` | `#e3ece8` | 태그·배지 배경 |
| | `accent` | `#e8a87c` (apricot) | 보조 강조 — **절제. 실사용 거의 없음(포레스트 우선)** |
| **표면** | `surface` | `#fbf9f5` (ivory) | 페이지 배경 |
| | `surface-alt` | `#f1ede4` | 섹션 구분·테이블 헤더·비활성 |
| | `card` | `#ffffff` | 카드·모달 등 떠 있는 표면 |
| **텍스트** | `ink` | `#0f1a14` | 본문 |
| | `ink-soft` | `#2f3d36` | 보조 텍스트 |
| | `ink-muted` | `#5b6862` | 흐린 텍스트 |
| **경계** | `border-default` | `#e3ddd0` | 기본 경계선 |
| | `border-strong` | `#cfc7b5` | 강조·hover 경계 |
| **상태** | `success` | `#0d4f3c` (= primary, 의도적) | 합격·완료 |
| | `warning` | `#b07424` | 대기·주의 |
| | `danger` | `#a72b3a` | 오류·삭제 |
| | `info` | `#1f5b8c` | 안내 |

각 상태색은 `-soft`(배경), 일부 `-deep`(hover) 변형이 있다. 전체는 globals.css 참조.

### 모서리 (radius) — **절제·각진 톤** (Tailwind 기본보다 작게 매핑)

| 유틸 | 값 | 용도 |
|---|---|---|
| `rounded-md` | 4px | 작은 요소 |
| `rounded-lg` | 6px | **버튼·입력** |
| `rounded-2xl` | 8px | **카드·모달** |
| `rounded-full` | — | 알약·아바타·점 (그대로 유지) |

> ⚠️ Tailwind 기본값(2xl=16px 등)이 아니라 **`@theme`에서 축소 재정의**돼 있다. `rounded-2xl`을 써도 8px이다.

### 그림자 / 타이포

- **그림자**: `shadow-xs`~`shadow-2xl` (forest 틴트). 클릭 가능한 카드는 `.card-hover`(globals.css) 또는 `<Card hover>`.
- **폰트**: Pretendard Variable. `html { font-size: 105% }`(접근성 배율 존중), `letter-spacing: 0`(한글 가독성).
- **제목**: `h1~h4`는 `@layer base`에서 `font-weight:700` + `color: ink`. (아래 함정 참조)

---

## UI 프리미티브

```ts
import { Button, Card, Badge, Alert, Container, SectionHeading, Field, Input, Checkbox } from "@/app/components/ui";
```

> **페이지에 인라인 className을 반복하지 말고** 프리미티브를 쓴다. 없으면 ui/에 추가하고 재사용.

| 컴포넌트 | 주요 props | 비고 |
|---|---|---|
| `Button` | `variant`: primary · secondary · accent · ghost · danger / `size`: sm · md · lg / `fullWidth` | `buttonClass({...})`도 export — CTA를 `<Link className>`로 쓸 때 클래스만 사용 |
| `Badge` | `tone`: neutral · brand · accent · success · warning · danger · info / `variant`: soft · solid · outline / `dot` · `icon` | 구분용은 `neutral` 기본. 색 tone은 상태일 때만 |
| `Card` | `padding`: none · sm · md · lg / `tone`: card · surface · alt / `hover` | `rounded-2xl`(8px) + `border-border-default` |
| `Alert` | `tone`: info · danger · warning · success · brand | 폼 에러/안내 박스 통일 (옛 amber/제각각 박스 대체) |
| `Container` | 페이지 폭 제약 래퍼 | props는 코드 참조 |
| `SectionHeading` | eyebrow **칩** + 제목 (옛 알약 라벨 대체) | props는 코드 참조 |
| `Field` / `Input` / `Checkbox` | 폼 요소 (`Field` = label+error 래퍼) | props는 코드 참조 |
| `Reveal` | 스크롤 등장 모션 래퍼 (globals.css `.reveal`) | JS 0, 순수 CSS |

---

## DO / DON'T

**DO**
- 새 강조가 필요하면 **포레스트** 하나로. 구분은 회색조·굵기·간격.
- 색 tone(success/warning/danger)은 **실제 상태**에만.
- 공통 패턴은 ui/ 프리미티브로 빼서 재사용.

**DON'T**
- ❌ 역할·카테고리·단계를 빨강/파랑/노랑으로 구분 (→ 회색조)
- ❌ `text-blue-600` 같은 **Tailwind 팔레트 직접 사용** (→ 토큰 `text-ink`/`text-primary`/`text-danger`)
- ❌ 카드/버튼에 큰 radius (→ 토큰 매핑된 `rounded-2xl`/`rounded-lg`)
- ❌ 같은 화면에서 여러 포인트 컬러 경쟁

---

## 함정 (꼭 기억)

1. **제목 색 오버라이드** — `h1~h4`는 반드시 `@layer base` 안에 둔다. unlayered면 Tailwind `text-*` 유틸보다 우선해서, **다크 섹션 제목이 ink로 고정돼 안 보이는 버그**가 난다 (랜딩 최종 CTA 제목 사고의 원인, v2에서 수정됨).
2. **`cn()`은 twMerge가 아니다** — falsy만 걸러 join할 뿐 Tailwind 충돌 해소를 안 한다. 같은 속성(예: 두 개의 `bg-*`)을 호출부에서 중복으로 넣지 말 것.
3. **radius/그림자는 토큰이 진실** — Tailwind 기본값을 기억으로 쓰지 말고 globals.css의 `@theme` 매핑을 확인.

---

*최초 작성: 디자인 시스템 v2 전면 적용(커밋 `978e898`) 직후. 토큰/프리미티브가 바뀌면 이 문서도 함께 갱신한다.*
