# 디자인 시스템 (v3.1 — Graphite & Signal / Navy)

> **디자인·UI 작업 전 필독.** 새 화면·컴포넌트·색/간격/모서리 변경은 이 문서의 규칙을 따른다.
> - 토큰의 **진실의 원천**: [app/globals.css](../app/globals.css)
> - 공통 컴포넌트(프리미티브): [app/components/ui/](../app/components/ui/)
> - 앱 셸(좌측 레일): [app/components/AppShell.tsx](../app/components/AppShell.tsx) · [AppShellLayout.tsx](../app/components/AppShellLayout.tsx)
> - **살아있는 예시**: `/design` 쇼케이스 페이지(개발용) + 후보자 상세·공고 상세·홈 대시보드(레퍼런스 구현)

---

## 한 줄 철학

**쿨 그래파이트 표면 + 네이비 시그널 하나.** 거의 모노톤, 절제된 톤, 작은 radius.
**색으로 떠들지 않는다.** 구분은 색이 아니라 **굵기·간격·회색조**로 만든다. 네이비는 *액션·강조·active* 에만.

> v2(Forest + Ivory)에서 전환됨. primary 포레스트 그린 → 일렉트릭 인디고 → **네이비(v3.1, 톤다운)**, surface 아이보리 → **쿨 그래파이트**,
> success 는 primary 와 **분리된 그린**(primary 가 "합격"을 뜻하지 않도록).
> 보조 포인트: **코랄(`accent`)** 따뜻한 대비 + **하늘색(`azure`)** 히어로 채팅 데모.

---

## 🎨 색 규칙 (가장 중요)

화면에 색을 넣기 전, **이 순서로** 판단한다:

| # | 무엇인가 | 무엇을 쓰나 |
|---|---|---|
| 1 | **본문 텍스트** | `text-ink` / 보조 `text-ink-soft` / 흐림 `text-ink-muted` — **그 외 색 금지** |
| 2 | **배경** | `bg-surface`(페이지·쿨그래파이트) / `bg-surface-alt`(구분·헤더·비활성) / `bg-card`(카드·모달·순백) |
| 3 | **강조 포인트** | **인디고(`primary`) 하나만** — CTA·active·선택·권한자·active 네비 |
| 4 | **장식 / 카테고리 / 역할 / 단계 (구분용 멀티휴)** | **회색조로 중립화.** 단 *활성·내 할 일* 항목만 예외적으로 인디고 |
| 5 | **진짜 상태** | 합격/완료=`success`(그린) · 대기/주의=`warning` · 오류/삭제=`danger` · 안내=`info`. **꼭 필요할 때만 최소로** |
| 6 | **데이터 시각화** (차트·점수바·퍼널·도넛·레이더) | **다색 보존 OK** — 여기서만 색을 자유롭게 ([components/charts.tsx](../components/charts.tsx) 팔레트 `C`) |

> **핵심**: "예뻐 보이려고" 색을 쓰지 않는다. 색은 **의미(상태·강조)가 있을 때만**.
> 빨강·파랑·노랑으로 "종류"를 구분하던 옛 패턴(역할 배지, 단계 색, 카테고리 알약)은 회색조로.

---

## 토큰 레퍼런스

### 색 (Tailwind 유틸: `bg-primary` `text-ink` `border-border-default` …)

| 그룹 | 토큰 | 값 | 용도 |
|---|---|---|---|
| **브랜드** | `primary` | `#1c3478` (Navy) | CTA·강조·active — **유일한 포인트 컬러** |
| | `primary-deep` | `#13234f` | hover/pressed |
| | `primary-soft` | `#e7eaf3` | 태그·배지·active 네비 배경 |
| | `accent` | `#fb7185` (coral) | 보조 강조 — 네이비와 **따뜻한 대비 포인트**. 절제 있게(통계 숫자·배지·아이콘 점). 밝은 배경 텍스트엔 `accent-deep` 사용 |
| | `accent-deep` | `#e11d48` | hover/pressed·밝은 배경 위 텍스트 |
| | `accent-soft` | `#ffe4e6` | accent 배경 |
| **하늘(데모)** | `azure` | `#7dd3fc` (하늘색) | 히어로 채팅 데모 보조 — 글로우·강조 점 |
| | `azure-soft` | `#e0f2fe` | 채팅 말풍선 배경 |
| | `azure-ink` | `#0c4a6e` | azure-soft 위 텍스트 |
| **표면** | `surface` | `#f7f8fa` (cool graphite) | 페이지 배경 |
| | `surface-alt` | `#eef1f5` | 섹션 구분·테이블 헤더·비활성 |
| | `card` | `#ffffff` | 카드·모달 등 떠 있는 표면 |
| **텍스트** | `ink` | `#0c1116` | 본문 |
| | `ink-soft` | `#2c3540` | 보조 텍스트 |
| | `ink-muted` | `#5a6573` | 흐린 텍스트 |
| **경계** | `border-default` | `#e4e7ec` | 기본 경계선 |
| | `border-strong` | `#cdd2da` | 강조·hover 경계 |
| **상태** | `success` | `#157a54` (그린, **primary 와 분리**) | 합격·완료·진행 중 표시 |
| | `warning` | `#b45309` | 대기·주의 |
| | `danger` | `#dc2626` | 오류·삭제·불합격 |
| | `info` | `#0369a1` | 안내 |

각 상태색은 `-soft`(배경) 변형이 있고, warning/danger 는 `-deep`(hover)도 있다. 전체는 globals.css 참조.

> **그라데이션**(인라인 hex 금지 — globals.css 토큰만 수정): 히어로 헤딩 반사 = `.text-reflect`(`var(--grad-reflect)`), GET STARTED 배너 = `.bg-cta-gradient`(`var(--grad-cta)`).

### 모서리 (radius) — **절제·각진 톤** (Tailwind 기본보다 작게 매핑)

| 유틸 | 값 | 용도 |
|---|---|---|
| `rounded-md` | 4px | 작은 요소 |
| `rounded-lg` | 6px | **버튼·입력** |
| `rounded-2xl` | 8px | **카드·모달** |
| `rounded-full` | — | 알약·아바타·점·아이콘 배지 (그대로 유지) |

> ⚠️ Tailwind 기본값(2xl=16px 등)이 아니라 **`@theme`에서 축소 재정의**돼 있다. `rounded-2xl`을 써도 8px이다.

### 그림자 / 타이포

- **그림자**: `shadow-xs`~`shadow-2xl` (graphite/ink 틴트, 2-레이어). 클릭 가능한 카드는 `.card-hover`(globals.css) 또는 `<Card hover>`.
- **폰트**: Pretendard Variable. `html { font-size: 105% }`(접근성 배율 존중), `letter-spacing: 0`(한글 가독성), `ss06/ss07` 글리프 보정.
- **제목**: `h1~h4`는 `@layer base`에서 `font-weight:700` + `color: ink`. (아래 함정 참조)

---

## 🧭 앱 셸 (좌측 레일) — 인증 영역 공통 레이아웃

로그인 후 모든 화면은 **좌측 레일 셸**(AppShell)을 쓴다. 상단 NavBar 는 비로그인 공개 페이지(랜딩·로그인·약관)에만.

- **정의 단일화**: [AppShell.tsx](../app/components/AppShell.tsx)(레일 UI) + [AppShellLayout.tsx](../app/components/AppShellLayout.tsx)(getCurrentUser → AppShell).
  각 인증 섹션의 `layout.tsx` 는 한 줄로 재노출: `export { default } from "@/app/components/AppShellLayout";`
- **적용 경로**: `/` (대시보드, page 내 inline) · `/candidates/[id]` · `/jobs`(목록·new·[id] 전부) · `/org/*` · `/admin/*` · `/account` · `/notifications` · `/support`.
- **레일 구성**: 상단 로고(+DEV 배지) / 역할별 네비(active=`bg-primary-soft text-primary-deep`) / 하단 알림·고객센터 + 사용자 메뉴(계정·로그아웃). 데스크톱 `lg:` 고정 레일(228px, `print:hidden`), 모바일은 햄버거 상단바 + 드로어.
- **전역 NavBar/Footer 가드**(components/NavBar·Footer): 토큰 페이지(/interview·/schedule·/apply·/unsubscribe·/invite)는 항상 숨김 + `usesAppShell` 경로는 **로그인 시에만** 숨김(중복 방지). 새 인증 섹션을 추가하면 이 `usesAppShell` 목록에도 추가할 것.
- 페이지 본문은 그대로 자기 `max-w-* mx-auto` 컨테이너를 쓰면 된다(레일 옆 flex-1 영역에서 중앙 정렬). 중첩 `<main>` 은 기존 패턴(허용).

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
| `Alert` | `tone`: info · danger · warning · success · brand | 폼 에러/안내 박스 통일 |
| `Container` / `SectionHeading` / `Field` / `Input` / `Checkbox` / `Reveal` | — | props는 코드 참조 |

---

## 아이콘 규칙

**단일 소스: `lucide-react` 하나만.** 버튼·링크·토글의 leading 아이콘에 이모지(📎🔄📅📧⭐💬🗑 …)나 유니코드 기호(`▶ ■ ✕ ✓ ✗ ★ ▲ ▾`)를 쓰지 않는다. 이모지는 OS/브라우저마다 모양·색·크기가 달라 lucide 라인 아이콘과 시각 언어가 충돌한다.

- **크기**: 작은 `text-xs` 액션 버튼 `w-3.5 h-3.5`, 기본/큰 버튼 `w-4 h-4`. 텍스트 **왼쪽(leading)** + `inline-flex items-center gap-1`(또는 `gap-1.5`).
- **색**: 아이콘에 색을 지정하지 말고 버튼 텍스트색(`currentColor`)을 따른다.
- **의미 1:1 재사용** — 같은 뜻엔 항상 같은 아이콘(화면 전체에서 "이 모양=이 의미" 학습되게):

| 의미 | 아이콘 | 의미 | 아이콘 |
|---|---|---|---|
| 이력서·파일 다운로드 | `FileDown` | 첨부/파일선택 | `Paperclip` |
| 마스킹/내용 보기·숨기기 | `Eye`/`EyeOff` | 재평가·재시도·새로고침 | `RefreshCw` |
| 일정 제시·조정 | `CalendarClock` | 메일 발송·통보 | `Mail` |
| 공유/전송 | `Send` | 후보 승급·지정 | `UserCheck` |
| 즐겨찾기 | `Star`/`StarOff` | 토론/코멘트 | `MessageSquare` |
| 단계 변경(다음으로) | `ChevronRight` | 종결 결정 | `Flag` |
| 합격/확인 | `Check` | 불합격/닫기·취소 | `X` |
| 삭제 | `Trash2` | 수정 | `Pencil` |
| 링크 | `Link2` | 검색 | `Search` |
| 복사 | `Copy` | 가져오기 | `Download` |
| 녹음·마이크 | `Mic` | 녹음 정지 | `Square`(fill) |
| 화상/줌 | `Video` | 추가 | `Plus` |
| 알림 | `Bell` | 설정 | `Settings` |
| 가이드·설명서 | `BookOpen` | 강제 로그아웃 | `LogOut` |

**예외(유지해도 됨)**: 네비 "← 뒤로" 링크, 본문 문장 속 전이 화살표(`A → B`), 빈 상태의 큰 일러스트 이모지(`text-2xl`+), 경고/안내 박스 prose 속 이모지, 상태 배지 라벨 — 이들은 버튼 아이콘이 아니라 손대지 않는다.

---

## 자주 쓰는 패턴 (레퍼런스 구현 기준)

리디자인된 3화면이 곧 레퍼런스다. 새 화면은 이 패턴을 재사용한다.

- **KPI 스탯 카드** (홈 대시보드): `KpiCard` — 우상단 아이콘(소프트 원형 `bg-primary-soft`), 큰 숫자(`text-2xl tabular-nums`), 초록 트렌드 한 줄(`text-success` + `TrendingUp`, **실집계만** — 가짜 증감 금지) 또는 보조 sub.
- **메트릭/요약 카드 그리드**: `bg-card border border-border-default rounded-2xl shadow-sm p-5`, 2~4열 `gap-3`.
- **파이프라인/분포 도넛**: [charts.tsx](../components/charts.tsx) `Donut`(서버 렌더 SVG, `{label,value,color}[]` + 중앙 텍스트 + 범례). 단계 색은 `C` 팔레트.
- **목록 = 표(list-row)**: 카드 그리드 대신 행 클릭형 표. 헤더행과 데이터행을 **같은 `flex gap-3` 구조**로 맞춰 열 정렬(`flex-1` 제목 + `w-12/w-14` 우측 스탯 + `ArrowRight`). 모바일은 우측 스탯 `hidden sm:block`, 제목 sub-line 에 인라인 요약.
- **단계 색 띠 카드**(후보자 카드): 좌측 4px `border-l-*`(단계 그룹색, [jobs/[id]/badges.tsx](../app/jobs/[id]/badges.tsx) `stageGroupBorder`). **단일변 보더라 `rounded` 금지가 아니라** 카드 자체는 둥글되 좌측 색은 별도 `<div>` 바 또는 `border-l`. 종결 후보는 `dimIfClosed`(흐리게).
- **적응형 패널/드로어**(공고 상세 "이력서 받기"): 빈 상태=인라인 히어로 / 채워진 상태=헤더 버튼으로 여는 우측 슬라이드(`fixed inset-0 z-50`). 본문은 단일 인스턴스(ref 충돌 방지)로 두 위치가 공유.
- **탭**(후보자 상세): 카드 위 `border-b` 탭, active=`border-primary text-primary-deep`. 콘텐츠는 제목·구분선 없이 카드에 바로.
- **빈 상태**: 액션 우선 패널은 비어도 유지하고 "✓ 처리할 일 없음" 류로 안내. 정보 패널은 점선 카드 + 1차 CTA.

---

## DO / DON'T

**DO**
- 새 강조가 필요하면 **인디고** 하나로. 구분은 회색조·굵기·간격.
- 색 tone(success/warning/danger/info)은 **실제 상태**에만.
- 공통 패턴은 ui/ 프리미티브 + 위 "자주 쓰는 패턴"으로 재사용.
- 새 인증 화면은 섹션 `layout.tsx` 재노출로 **셸을 입히고** NavBar/Footer `usesAppShell` 에 경로 추가.

**DON'T**
- ❌ 역할·카테고리·단계를 빨강/파랑/노랑으로 구분 (→ 회색조)
- ❌ `text-blue-600` 같은 **Tailwind 팔레트 직접 사용** (→ 토큰 `text-ink`/`text-primary`/`text-danger`)
- ❌ 카드/버튼에 큰 radius (→ 토큰 매핑된 `rounded-2xl`/`rounded-lg`)
- ❌ 같은 화면에서 여러 포인트 컬러 경쟁
- ❌ KPI·통계에 **지어낸 수치**(주간 증감 등) — 실집계 가능한 것만, 아니면 보조 문구로

---

## 함정 (꼭 기억)

1. **제목 색 오버라이드** — `h1~h4`는 반드시 `@layer base` 안에 둔다. unlayered면 Tailwind `text-*` 유틸보다 우선해서, **다크 섹션 제목이 ink로 고정돼 안 보이는 버그**가 난다.
2. **`cn()`은 twMerge가 아니다** — falsy만 걸러 join할 뿐 Tailwind 충돌 해소를 안 한다. 같은 속성(두 개의 `bg-*`)을 호출부에서 중복으로 넣지 말 것.
3. **radius/그림자는 토큰이 진실** — Tailwind 기본값을 기억으로 쓰지 말고 globals.css의 `@theme` 매핑을 확인.
4. **success ≠ primary** — v3 부터 합격/완료 그린(`#157a54`)은 인디고와 분리. "합격=초록", "active/강조=인디고"를 섞지 말 것.
5. **Turbopack dev 에서 globals.css 변경이 hot-reload 안 될 수 있음** — CSS 토큰 바꾼 뒤엔 dev 재시작. (검증은 lightningcss 오프라인 컴파일이 확실)
6. **셸 중복** — 한 경로에 layout 이 둘 겹치면 레일이 2개 뜬다. 섹션 layout 을 추가할 땐 상·하위 중복 여부 확인(예: jobs/[id]/layout 은 jobs/layout 으로 통합).

---

*v2(Forest + Ivory) → v3(Graphite & Signal, Electric Indigo) 전면 전환. 리디자인 3화면(후보자 상세·공고 상세·홈 대시보드) + 인증 영역 전체 좌측 레일 셸 적용 시점에 갱신. 토큰/프리미티브/셸이 바뀌면 이 문서도 함께 갱신한다.*
