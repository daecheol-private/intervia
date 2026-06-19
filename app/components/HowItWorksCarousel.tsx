"use client";

import { useCallback, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Link2,
  Upload,
  FolderUp,
  Mic,
  Send,
  CalendarClock,
  CalendarCheck,
  CornerDownLeft,
  Video,
  ClipboardList,
  Target,
  RefreshCw,
  MailCheck,
  Check,
  Lock,
  ScanSearch,
  AudioLines,
} from "lucide-react";

// ---------------------------------------------------------------------------
// 랜딩 "어떻게 동작하나요?" — 7단계 사용 안내 캐러셀.
// 처음 접하는 사람을 위해 각 단계의 핵심 화면을 고품질 목업으로 재현하고,
// 화면 위 번호 핀 ↔ 우측 말풍선 설명을 같은 번호로 묶어 설명서처럼 보여준다.
// 모든 목업은 같은 높이의 브라우저 프레임에 담겨 슬라이드 간 레이아웃이 흔들리지 않는다.
// ---------------------------------------------------------------------------

/** 목업 화면 위에 얹는 번호 핀 — 우측 말풍선의 번호와 1:1 대응. */
function Pin({ n, className = "" }: { n: number; className?: string }) {
  return (
    <span
      className={`absolute z-20 flex items-center justify-center w-6 h-6 rounded-full bg-accent text-ink text-[11px] font-bold shadow-md ring-2 ring-card ${className}`}
    >
      {n}
    </span>
  );
}

/** 브라우저 창 프레임 — 목업이 "실제 화면"처럼 보이도록 감싼다. 높이 고정. */
function BrowserFrame({
  url,
  children,
}: {
  url: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border-default bg-card shadow-2xl ring-1 ring-black/5 overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 py-2.5 bg-surface-alt border-b border-border-default">
        <span className="w-2.5 h-2.5 rounded-full bg-danger/50" />
        <span className="w-2.5 h-2.5 rounded-full bg-warning/50" />
        <span className="w-2.5 h-2.5 rounded-full bg-primary/40" />
        <div className="ml-2 flex-1 flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-card border border-border-default max-w-[260px]">
          <Lock className="w-2.5 h-2.5 text-ink-muted shrink-0" />
          <span className="text-[10px] text-ink-muted truncate">{url}</span>
        </div>
      </div>
      <div className="relative h-[400px] sm:h-[420px] p-4 sm:p-5 bg-surface flex flex-col">
        {children}
      </div>
    </div>
  );
}

/** 목업 내부 앱 헤더 — 실제 제품 화면처럼 보이게 그라운딩. */
function AppBar({
  title,
  status,
}: {
  title: string;
  status?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between pb-2.5 mb-3 border-b border-border-default shrink-0">
      <div className="flex items-center gap-1.5">
        <span className="flex items-center justify-center w-4 h-4 rounded bg-primary text-surface text-[6px] font-bold tracking-tighter">
          IV<span className="text-accent">.</span>
        </span>
        <span className="text-[10px] font-semibold text-ink">{title}</span>
      </div>
      {status ?? (
        <span className="w-5 h-5 rounded-full bg-gradient-to-br from-primary/25 to-accent/40" />
      )}
    </div>
  );
}

/** 자동 채워진 폼 필드 한 줄. */
function MockField({
  label,
  value,
  multiline,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  return (
    <div>
      <div className="text-[9px] text-ink-muted mb-0.5">{label}</div>
      <div
        className={`px-2 py-1 rounded-md bg-surface-alt/70 border border-border-default text-[10px] text-ink ${
          multiline ? "leading-relaxed" : "truncate"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

/** 점수 막대 한 줄. */
function MiniBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-8 text-[9px] text-ink-soft shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-surface-alt overflow-hidden">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="w-6 text-right text-[9px] font-semibold text-ink tabular-nums">
        {value}
      </span>
    </div>
  );
}

/** 종합 점수 도넛 (conic-gradient). */
function ScoreDonut({ value }: { value: number }) {
  return (
    <div
      className="relative grid place-items-center rounded-full shrink-0 w-12 h-12"
      style={{
        background: `conic-gradient(var(--primary) ${value * 3.6}deg, var(--border) 0)`,
      }}
    >
      <div className="grid place-items-center rounded-full bg-card w-9 h-9">
        <span className="text-[13px] font-bold text-primary tabular-nums leading-none">
          {value}
        </span>
      </div>
    </div>
  );
}

type Slide = {
  route: string;
  title: string;
  subtitle: string;
  mockup: React.ReactNode;
  points: string[];
};

const SLIDES: Slide[] = [
  // 1. 공고 등록 — URL 붙여넣기 자동 채우기
  {
    route: "intervia.app/jobs/new",
    title: "공고 등록",
    subtitle:
      "채용 사이트의 공고 URL만 붙여넣으면, 공고 내용이 자동으로 채워집니다.",
    points: [
      "사람인·잡코리아·원티드 공고 URL을 그대로 붙여넣어요.",
      "'가져오기' 한 번이면 본문과 이미지까지 분석합니다.",
      "제목·직무·자격요건이 자동으로 채워져요 (직접 수정도 가능).",
      "면접 시간만 10·20·30분 중에서 골라주세요.",
    ],
    mockup: (
      <>
        <AppBar title="새 공고 등록" />
        <div className="flex-1 flex flex-col justify-center gap-2.5 text-left">
          <div className="relative rounded-xl border border-primary/25 bg-primary-soft/50 p-3">
            <Pin n={1} className="-top-2.5 -left-2.5" />
            <div className="flex items-center gap-1.5 mb-2">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              <span className="text-[11px] font-semibold text-primary-deep">
                기존 공고 URL로 자동 채우기
              </span>
            </div>
            <div className="flex gap-1.5">
              <div className="flex-1 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-card border border-border-strong min-w-0">
                <Link2 className="w-3 h-3 text-ink-muted shrink-0" />
                <span className="text-[10px] text-ink-soft truncate">
                  saramin.co.kr/zf_user/jobs/view?rec_idx=49…
                </span>
              </div>
              <div className="relative shrink-0">
                <Pin n={2} className="-top-2.5 -right-2.5" />
                <span className="inline-flex px-3 py-1.5 rounded-lg bg-primary text-surface text-[11px] font-medium whitespace-nowrap">
                  가져오기
                </span>
              </div>
            </div>
          </div>

          <div className="relative rounded-xl border border-border-default bg-card p-3 shadow-sm space-y-2.5">
            <Pin n={3} className="-top-2.5 -right-2.5" />
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-semibold text-ink-soft">
                자동으로 채워진 항목
              </span>
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-primary-soft text-primary-deep text-[8px] font-bold">
                <Check className="w-2 h-2" strokeWidth={3} />
                자동 입력됨
              </span>
            </div>
            <MockField label="공고 제목" value="백엔드 개발자 채용" />
            <div className="grid grid-cols-2 gap-2">
              <MockField label="직무" value="백엔드 개발자" />
              <MockField label="직급 / 연차" value="3~5년차 (중급)" />
            </div>
            <MockField
              label="자격 요건"
              value="• Java/Spring 기반 API 개발 경험 3년 이상 …"
              multiline
            />
          </div>

          <div className="relative flex items-center gap-2 pl-1">
            <Pin n={4} className="-top-2.5 -left-2.5" />
            <span className="text-[10px] text-ink-soft">예상 면접 시간</span>
            <div className="flex rounded-lg border border-border-default overflow-hidden">
              <span className="px-2.5 py-1 text-[10px] text-ink-soft">
                10분
              </span>
              <span className="px-2.5 py-1 text-[10px] bg-primary text-surface font-medium">
                20분
              </span>
              <span className="px-2.5 py-1 text-[10px] text-ink-soft">
                30분
              </span>
            </div>
          </div>
        </div>
      </>
    ),
  },

  // 2. 이력서 수집(직접 지원 링크 + 직접 업로드) → 자동 AI 평가
  {
    route: "intervia.app/jobs/12",
    title: "이력서 수집 → 자동 평가",
    subtitle:
      "공고별 '지원하기' 링크로 받거나 직접 올리면, AI가 알아서 채점하고 등급을 매깁니다.",
    points: [
      "공고마다 전용 '지원하기' 링크가 생겨요. 채용 사이트·회사 홈페이지에 붙여넣으면 지원자가 직접 이력서를 올립니다.",
      "보유한 이력서는 파일·폴더·압축파일(ZIP)로 한 번에 업로드해요.",
      "AI가 채점할 때는 이름·연락처 등 개인정보를 마스킹해 전달하므로, 편향 없이 평가합니다.",
      "AI가 6개 항목으로 채점하고 추천 등급까지 매겨줘요.",
    ],
    mockup: (
      <>
        <AppBar title="지원자 · 이력서 수집" />
        <div className="flex-1 flex flex-col justify-center gap-2.5 text-left">
          {/* 공개 지원 링크 — 지원자 직접 지원 */}
          <div className="relative rounded-xl border border-primary/25 bg-primary-soft/40 p-2.5">
            <Pin n={1} className="-top-2.5 -left-2.5" />
            <div className="flex items-center gap-1.5 mb-1.5">
              <Link2 className="w-3 h-3 text-primary" />
              <span className="text-[10px] font-semibold text-primary-deep">
                공개 지원 링크 — 지원자가 직접 지원
              </span>
            </div>
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-card border border-border-default">
              <Lock className="w-2.5 h-2.5 text-ink-muted shrink-0" />
              <span className="text-[9px] text-ink-soft truncate">
                intervia.app/apply/ap_x9k2…
              </span>
              <span className="ml-auto shrink-0 px-1.5 py-0.5 rounded bg-accent-soft text-accent-deep text-[8px] font-bold whitespace-nowrap">
                채용사이트·홈페이지에 붙여넣기
              </span>
            </div>
          </div>

          {/* 또는, 보유 이력서 직접 업로드 (compact) */}
          <div className="relative rounded-xl border-2 border-dashed border-primary/40 bg-primary-soft/20 px-3 py-2.5 flex items-center gap-2.5">
            <Pin n={2} className="-top-2.5 -left-2.5" />
            <span className="flex w-8 h-8 rounded-full bg-primary-soft items-center justify-center shrink-0">
              <Upload className="w-4 h-4 text-primary" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-medium text-ink">
                또는, 보유 이력서를 직접 끌어다 놓기
              </div>
              <div className="text-[9px] text-ink-soft">
                파일 · 폴더 · 압축(ZIP) 한 번에 · PDF DOCX HWP
              </div>
            </div>
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-primary text-surface text-[9px] font-medium shrink-0">
              <FolderUp className="w-3 h-3" />
              24개 완료
            </span>
          </div>

          <div className="relative rounded-xl border border-border-default bg-card p-3 shadow-sm">
            <Pin n={3} className="-top-2.5 -left-2.5" />
            <Pin n={4} className="-top-2.5 -right-2.5" />
            <div className="flex items-center gap-3">
              <ScoreDonut value={88} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-semibold text-ink">
                    지원자 A
                  </span>
                  <span className="px-1 py-0.5 rounded bg-surface-alt text-[7px] text-ink-muted">
                    AI 평가 시 마스킹
                  </span>
                  <span className="ml-auto px-1.5 py-0.5 rounded bg-accent-soft text-accent-deep text-[8px] font-bold">
                    강력추천
                  </span>
                </div>
                <div className="text-[9px] text-ink-soft mt-0.5">
                  백엔드 개발자 · 경력 4년
                </div>
                <div className="mt-1.5 space-y-1">
                  <MiniBar label="기술" value={90} />
                  <MiniBar label="경험" value={84} />
                  <MiniBar label="직무" value={92} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </>
    ),
  },

  // 3. 3단계 AI 면접 (인성검사 → 직무 역량 → 심층 면접)
  {
    route: "intervia.app/interview/···",
    title: "3단계 AI 면접",
    subtitle:
      "후보자는 메일 속 링크만 누르면, 인성검사·직무 역량 평가를 거쳐 AI 면접관과 1:1 심층 면접까지 한 번에 봅니다.",
    points: [
      "인성검사 → 직무 역량 → 심층 면접, 3단계로 검증해요.",
      "심층 면접에선 공고와 이력서를 기반으로 질문하고, 답변마다 꼬리질문으로 더 깊이 파고듭니다.",
      "지원자는 채팅이나 음성으로 답변을 전달할 수 있어요.",
      "붙여넣기·탭 이탈·문체로 외부 AI 보조 신호를 잡아내고, 끝나면 곧바로 자동 평가해요.",
    ],
    mockup: (
      <>
        <AppBar
          title="AI 면접 진행 중"
          status={
            <span className="flex items-center gap-1 text-[9px] text-ink-soft tabular-nums">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              04:12
            </span>
          }
        />
        <div className="flex-1 flex flex-col text-left min-h-0">
          {/* 단계 프로그레스 — 인성검사 ✓ → 직무 역량 ✓ → 심층 면접 ●(현재). 실제 제품 StepProgress 재현 */}
          <div className="relative rounded-xl border border-border-default bg-card px-3 py-2 mb-2 shadow-sm">
            <Pin n={1} className="-top-2.5 -left-2.5" />
            <div className="flex items-center gap-1">
              <span className="flex items-center gap-1 min-w-0">
                <span className="shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary text-surface">
                  <Check className="w-2.5 h-2.5" strokeWidth={3} />
                </span>
                <span className="text-[9px] font-medium text-ink-soft whitespace-nowrap">
                  인성검사
                </span>
              </span>
              <span className="h-px flex-1 min-w-[6px] bg-primary/50" />
              <span className="flex items-center gap-1 min-w-0">
                <span className="shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary text-surface">
                  <Check className="w-2.5 h-2.5" strokeWidth={3} />
                </span>
                <span className="text-[9px] font-medium text-ink-soft whitespace-nowrap">
                  직무 역량
                </span>
              </span>
              <span className="h-px flex-1 min-w-[6px] bg-primary/50" />
              <span className="flex items-center gap-1 min-w-0">
                <span className="shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary text-surface text-[8px] font-bold ring-2 ring-primary/25">
                  3
                </span>
                <span className="text-[9px] font-bold text-primary-deep whitespace-nowrap">
                  심층 면접
                </span>
              </span>
            </div>
          </div>

          <div className="self-start text-[9px] text-ink-soft mb-2">
            백엔드 개발자 · 3~5년차 · 약 20분
          </div>
          <div className="flex-1 flex flex-col justify-end gap-2 rounded-xl border border-border-default bg-gradient-to-b from-surface-alt/30 to-card p-3 overflow-hidden">
            <div className="self-start max-w-[85%] px-3 py-2 rounded-2xl rounded-bl-sm bg-surface-alt text-[10px] text-ink leading-relaxed">
              대규모 트래픽을 처리하며 겪은 가장 큰 병목은 무엇이었고, 어떻게
              해결하셨나요?
            </div>
            <div className="self-end max-w-[85%] px-3 py-2 rounded-2xl rounded-br-sm bg-primary text-surface text-[10px] leading-relaxed">
              DB 커넥션 풀이 병목이었고, 캐시 계층과 읽기 복제본을 도입했습니다.
            </div>
            <div className="relative self-start max-w-[85%]">
              <Pin n={2} className="-top-2.5 -right-2.5" />
              <div className="px-3 py-2 rounded-2xl rounded-bl-sm bg-surface-alt text-[10px] text-ink leading-relaxed">
                복제 지연으로 인한 정합성 문제는 어떻게 다루셨나요?
              </div>
            </div>
          </div>
          <div className="relative flex items-center gap-2 mt-2 rounded-xl border border-border-default bg-card px-3 py-2 shadow-sm">
            <Pin n={3} className="-top-2.5 -left-2.5" />
            <span className="flex-1 text-[10px] text-ink-muted">
              답변을 입력하거나 마이크 버튼을 누르세요
            </span>
            <span className="w-6 h-6 rounded-full bg-primary-soft flex items-center justify-center shrink-0">
              <Mic className="w-3 h-3 text-primary" />
            </span>
            <span className="w-6 h-6 rounded-full bg-primary flex items-center justify-center shrink-0">
              <Send className="w-3 h-3 text-surface" />
            </span>
          </div>
          <div className="relative self-start mt-2 inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-card border border-border-default">
            <Pin n={4} className="-top-2.5 -left-2.5" />
            <ScanSearch className="w-3 h-3 text-warning" />
            <span className="text-[9px] text-ink-soft">
              AI 보조 신호 수집 중 · 붙여넣기 0 · 탭 이탈 1
            </span>
          </div>
        </div>
      </>
    ),
  },

  // 4. 면접 일정 조율
  {
    route: "intervia.app/jobs/12",
    title: "면접 일정 조율",
    subtitle:
      "가능한 시간만 제시하면 후보자가 직접 고르고, Zoom 회의까지 자동으로 만들어집니다.",
    points: [
      "가능한 면접 시간을 여러 개 제시해요.",
      "후보자가 직접 선택하거나, 다른 시간을 역제시합니다.",
      "확정되면 Zoom 회의와 캘린더 초대가 자동 생성·발송돼요.",
    ],
    mockup: (
      <>
        <AppBar title="면접 일정 조율" />
        <div className="flex-1 flex flex-col justify-center gap-3 text-left">
          <div className="relative rounded-xl border border-border-default bg-card p-3 shadow-sm">
            <Pin n={1} className="-top-2.5 -left-2.5" />
            <div className="flex items-center gap-1.5 mb-2 text-[10px] font-semibold text-ink">
              <CalendarClock className="w-3.5 h-3.5 text-primary" />
              면접 가능 시간 제시
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <span className="px-2 py-1.5 rounded-lg bg-surface-alt text-[9px] text-ink-soft border border-border-default text-center leading-tight">
                6/12 (목)
                <br />
                14:00
              </span>
              <span className="relative px-2 py-1.5 rounded-lg bg-primary text-surface text-[9px] font-medium text-center leading-tight">
                <Pin n={2} className="-top-2.5 -right-2.5" />
                6/13 (금)
                <br />
                10:00 ✓
              </span>
              <span className="px-2 py-1.5 rounded-lg bg-surface-alt text-[9px] text-ink-soft border border-border-default text-center leading-tight">
                6/13 (금)
                <br />
                15:00
              </span>
            </div>
            <div className="mt-2 flex items-center gap-1 text-[9px] text-primary-deep">
              <CornerDownLeft className="w-2.5 h-2.5" />
              후보자가 다른 시간을 역제시할 수도 있어요
            </div>
          </div>

          <div className="relative rounded-xl border border-primary/25 bg-primary-soft/40 p-3">
            <Pin n={3} className="-top-2.5 -left-2.5" />
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-primary-deep">
              <Video className="w-3.5 h-3.5" />
              일정 확정 · 6/13 (금) 10:00
            </div>
            <div className="mt-2 flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-card border border-border-default">
              <span className="w-5 h-5 rounded flex items-center justify-center bg-info-soft shrink-0">
                <Video className="w-3 h-3 text-info" />
              </span>
              <div className="min-w-0">
                <div className="text-[9px] font-medium text-ink">
                  Zoom 회의 자동 생성됨
                </div>
                <div className="text-[8px] text-info truncate">
                  zoom.us/j/8842 1957 0098
                </div>
              </div>
            </div>
            <div className="mt-1.5 flex items-center gap-1 text-[9px] text-ink-soft">
              <CalendarCheck className="w-2.5 h-2.5 text-primary" />
              후보자·면접관에게 캘린더 초대 발송 완료
            </div>
          </div>
        </div>
      </>
    ),
  },

  // 5. 맞춤 면접 문항 생성
  {
    route: "intervia.app/candidates/87",
    title: "맞춤 면접 문항 생성",
    subtitle:
      "이력서와 AI 면접 결과를 종합해, 대면 면접에서 그대로 쓸 질문지를 만들어 줍니다.",
    points: [
      "이력서·서류평가·AI 면접 결과를 모두 반영한 맞춤 질문.",
      "질문마다 '무엇을 검증하는지'와 꼬리질문까지 제시해요.",
      "면접관은 그대로 들고 들어가 준비 시간을 단축합니다.",
    ],
    mockup: (
      <>
        <AppBar title="맞춤 면접 질문지" />
        <div className="flex-1 flex flex-col justify-center text-left">
          <div className="relative rounded-xl border border-border-default bg-card p-3.5 shadow-sm">
            <Pin n={1} className="-top-2.5 -left-2.5" />
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-ink">
                <ClipboardList className="w-3.5 h-3.5 text-primary" />
                AI 생성 면접 질문지
              </div>
              <span className="relative px-1.5 py-0.5 rounded bg-accent-soft text-accent-deep text-[8px] font-bold">
                <Pin n={3} className="-top-2.5 -right-2.5" />
                1차 대면용
              </span>
            </div>
            <div className="space-y-2">
              <div className="relative rounded-lg bg-surface-alt/60 border border-border-default/60 p-2.5">
                <Pin n={2} className="-bottom-2.5 -right-2.5" />
                <div className="text-[10px] font-medium text-ink leading-relaxed">
                  Q1. 읽기 복제본 도입 시 데이터 정합성은 어떻게 보장했나요?
                </div>
                <div className="mt-1 flex items-center gap-1 text-[8px] text-primary-deep">
                  <Target className="w-2.5 h-2.5 shrink-0" />
                  검증 포인트: 트레이드오프 이해도
                </div>
                <div className="text-[8px] text-ink-soft pl-3">
                  ↳ 꼬리질문: 복제 지연이 컸다면 어떻게 대응했나요?
                </div>
              </div>
              <div className="rounded-lg bg-surface-alt/60 border border-border-default/60 p-2.5">
                <div className="text-[10px] font-medium text-ink leading-relaxed">
                  Q2. 팀 내 기술 의견 충돌을 조율한 경험을 들려주세요.
                </div>
                <div className="mt-1 flex items-center gap-1 text-[8px] text-primary-deep">
                  <Target className="w-2.5 h-2.5 shrink-0" />
                  검증 포인트: 협업·커뮤니케이션
                </div>
              </div>
              <div className="rounded-lg bg-surface-alt/60 border border-border-default/60 p-2.5">
                <div className="text-[10px] font-medium text-ink leading-relaxed">
                  Q3. 운영 중 장애를 회고해 재발을 막은 사례가 있나요?
                </div>
                <div className="mt-1 flex items-center gap-1 text-[8px] text-primary-deep">
                  <Target className="w-2.5 h-2.5 shrink-0" />
                  검증 포인트: 문제 해결·오너십
                </div>
              </div>
            </div>
            <div className="mt-2.5 flex items-center justify-between">
              <span className="text-[8px] text-ink-muted">
                이력서·서류평가·AI 면접 기반 · 총 12문항
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary-soft text-primary-deep text-[8px] font-medium">
                <RefreshCw className="w-2.5 h-2.5" />
                다시 생성
              </span>
            </div>
          </div>
        </div>
      </>
    ),
  },

  // 6. 대면 면접 녹음/음성 업로드 → AI 평가 (1·2차)
  {
    route: "intervia.app/candidates/87",
    title: "대면 면접 녹음 → AI 평가",
    subtitle:
      "1·2차 대면 면접을 녹음 파일로 올리거나 라이브로 받아쓰면, 화자를 분리해 평가 리포트를 만들어 줍니다.",
    points: [
      "녹음 파일 업로드 또는 브라우저 라이브 녹음으로 1·2차 대면 면접을 기록해요.",
      "전사 후 지원자·면접관 발언을 자동으로 분리합니다.",
      "역량 점수·강점·우려·다음 추천 질문까지 평가 리포트로 정리해요.",
      "녹음 파일은 전사 후 보관하지 않습니다.",
    ],
    mockup: (
      <>
        <AppBar
          title="대면 면접 평가"
          status={
            <span className="flex items-center gap-1 text-[9px] text-ink-soft tabular-nums">
              <span className="w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />
              ● REC 18:24
            </span>
          }
        />
        <div className="flex-1 flex flex-col text-left min-h-0 gap-2.5">
          {/* 녹음 방식 — 업로드 / 라이브 */}
          <div className="relative flex items-center gap-1.5">
            <Pin n={1} className="-top-2.5 -left-2.5" />
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-primary text-surface text-[9px] font-medium">
              <AudioLines className="w-3 h-3" />
              라이브 녹음
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-card border border-border-default text-[9px] text-ink-soft">
              <Upload className="w-3 h-3" />
              녹음 업로드
            </span>
            <span className="ml-auto text-[9px] text-ink-muted">1차 대면 면접</span>
          </div>

          {/* 화자 분리 전사 */}
          <div className="relative flex-1 min-h-0 rounded-xl border border-border-default bg-gradient-to-b from-surface-alt/30 to-card p-3 overflow-hidden space-y-2">
            <Pin n={2} className="-top-2.5 -right-2.5" />
            <div className="flex items-start gap-1.5">
              <span className="shrink-0 mt-px text-[8px] font-semibold px-1.5 py-0.5 rounded bg-surface-alt text-ink-soft border border-border-default">
                면접관
              </span>
              <span className="text-[10px] text-ink leading-relaxed">
                가장 도전적이었던 프로젝트는 무엇이었나요?
              </span>
            </div>
            <div className="flex items-start gap-1.5">
              <span className="shrink-0 mt-px text-[8px] font-semibold px-1.5 py-0.5 rounded bg-card text-info border border-info/30">
                지원자
              </span>
              <span className="text-[10px] text-ink leading-relaxed">
                결제 시스템을 <strong className="font-semibold">무중단으로 마이그레이션</strong>한 경험이 가장 기억에 남습니다.
              </span>
            </div>
            <div className="flex items-start gap-1.5">
              <span className="shrink-0 mt-px text-[8px] font-semibold px-1.5 py-0.5 rounded bg-surface-alt text-ink-soft border border-border-default">
                면접관
              </span>
              <span className="text-[10px] text-ink leading-relaxed">
                정합성은 어떻게 보장하셨나요?
              </span>
            </div>
          </div>

          {/* 평가 요약 */}
          <div className="relative rounded-xl border border-border-default bg-card p-3 shadow-sm">
            <Pin n={3} className="-top-2.5 -left-2.5" />
            <div className="flex items-center gap-3">
              <div className="text-center shrink-0">
                <span className="text-2xl font-bold text-primary tabular-nums leading-none">
                  86
                </span>
                <span className="text-[8px] text-ink-muted"> / 100</span>
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <MiniBar label="역량" value={88} />
                <MiniBar label="소통" value={84} />
              </div>
              <span className="shrink-0 self-start px-1.5 py-0.5 rounded bg-accent-soft text-accent-deep text-[8px] font-bold">
                합격 권장
              </span>
            </div>
          </div>

          {/* 녹음 파일 미보관 */}
          <div className="relative flex items-center gap-1.5 pl-1">
            <Pin n={4} className="-top-2.5 -left-2.5" />
            <Lock className="w-2.5 h-2.5 text-primary shrink-0" />
            <span className="text-[9px] text-ink-soft">
              전사 후 녹음 파일은 보관하지 않습니다
            </span>
          </div>
        </div>
      </>
    ),
  },

  // 7. 결과 리포트 · 합·불 통보
  {
    route: "intervia.app/jobs/12/report",
    title: "결과 리포트 · 합·불 통보",
    subtitle:
      "모든 평가를 한 화면에서 비교하고, 합·불 결정과 동시에 결과 메일까지 자동으로 보냅니다.",
    points: [
      "기술·경험·협업·적합 4영역 점수와 근거를 한눈에.",
      "1·2차 면접관 스코어카드를 나란히 비교해요.",
      "합·불 결정과 동시에 결과 메일이 자동 발송됩니다.",
    ],
    mockup: (
      <>
        <AppBar title="종합 평가 리포트" />
        <div className="flex-1 flex flex-col justify-center gap-2.5 text-left">
          <div className="relative rounded-xl border border-border-default bg-card p-3 shadow-sm">
            <Pin n={1} className="-top-2.5 -left-2.5" />
            <div className="flex items-center gap-3">
              <div className="text-center shrink-0">
                <span className="flex items-center justify-center w-12 h-12 rounded-full bg-primary text-surface text-xl font-bold">
                  A
                </span>
                <div className="text-[8px] text-ink-muted mt-1">추천 등급</div>
              </div>
              <div className="flex-1 min-w-0 space-y-1.5">
                <MiniBar label="기술" value={86} />
                <MiniBar label="경험" value={78} />
                <MiniBar label="협업" value={90} />
                <MiniBar label="적합" value={82} />
              </div>
            </div>
          </div>

          <div className="relative grid grid-cols-2 gap-2">
            <Pin n={2} className="-top-2.5 -left-2.5" />
            <div className="rounded-xl border border-border-default bg-card p-2.5 shadow-sm">
              <div className="text-[9px] text-ink-muted">1차 면접관</div>
              <div className="text-[11px] font-semibold text-ink mt-0.5">
                합격 의견
              </div>
              <div className="text-[9px] text-primary-deep mt-0.5">
                ★ 4.2 / 5
              </div>
            </div>
            <div className="rounded-xl border border-border-default bg-card p-2.5 shadow-sm">
              <div className="text-[9px] text-ink-muted">2차 면접관</div>
              <div className="text-[11px] font-semibold text-ink mt-0.5">
                합격 의견
              </div>
              <div className="text-[9px] text-primary-deep mt-0.5">
                ★ 4.5 / 5
              </div>
            </div>
          </div>

          <div className="relative flex items-center gap-2 rounded-xl border border-primary/25 bg-primary-soft/40 px-3 py-2">
            <Pin n={3} className="-top-2.5 -left-2.5" />
            <span className="w-6 h-6 rounded-full bg-card flex items-center justify-center shrink-0">
              <MailCheck className="w-3.5 h-3.5 text-primary" />
            </span>
            <div>
              <div className="text-[10px] font-medium text-primary-deep">
                합격 통보 메일 발송 완료
              </div>
              <div className="text-[8px] text-ink-soft">
                합·불 결정과 동시에 자동 발송됩니다
              </div>
            </div>
          </div>
        </div>
      </>
    ),
  },
];

function SlideView({
  slide,
  index,
  total,
}: {
  slide: Slide;
  index: number;
  total: number;
}) {
  return (
    <div className="rounded-3xl border border-border-default bg-card/60 backdrop-blur-sm shadow-sm p-5 sm:p-8 lg:p-10">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-center">
        {/* 화면 목업 */}
        <div className="order-2 lg:order-1 min-w-0">
          <BrowserFrame url={slide.route}>{slide.mockup}</BrowserFrame>
        </div>

        {/* 단계 설명 + 말풍선 포인트 */}
        <div className="order-1 lg:order-2 min-w-0">
          <div className="flex items-center gap-2.5 mb-3">
            <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary text-surface text-lg font-bold shadow-sm">
              {index + 1}
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-muted">
              STEP {index + 1} / {total}
            </span>
          </div>
          <h3 className="text-2xl sm:text-3xl font-bold tracking-tight text-ink">
            {slide.title}
          </h3>
          <p className="mt-2.5 text-sm sm:text-base text-ink-soft leading-relaxed">
            {slide.subtitle}
          </p>

          <ul className="mt-6 space-y-3">
            {slide.points.map((p, k) => (
              <li
                key={k}
                className="relative flex items-start gap-3 rounded-2xl bg-surface-alt border border-border-default px-4 py-3"
              >
                {/* 말풍선 꼬리 — 좌측(목업 쪽)을 향하는 삼각형.
                    바깥(테두리색)·안쪽(배경색) 2겹으로 그린다. 밑변이 풍선 본체
                    안쪽까지 파고들도록 오른쪽으로 밀어, 목 부분 테두리 선을 덮는다. */}
                <span
                  aria-hidden
                  className="absolute top-1/2 -translate-y-1/2 -left-[7px] w-0 h-0 border-y-[9px] border-y-transparent border-r-[9px] border-r-[color:var(--border)]"
                />
                <span
                  aria-hidden
                  className="absolute top-1/2 -translate-y-1/2 -left-[6px] w-0 h-0 border-y-[8px] border-y-transparent border-r-[8px] border-r-[color:var(--surface-alt)]"
                />
                <span className="relative shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-accent text-ink text-[11px] font-bold shadow-sm">
                  {k + 1}
                </span>
                <span className="min-w-0 text-sm text-ink leading-relaxed break-words">
                  {p}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export function HowItWorksCarousel() {
  const [i, setI] = useState(0);
  const n = SLIDES.length;
  const touchX = useRef<number | null>(null);

  const go = useCallback((d: number) => setI((p) => (p + d + n) % n), [n]);

  return (
    <div
      role="group"
      aria-roledescription="carousel"
      aria-label="제품 사용 안내 7단계"
      onKeyDown={(e) => {
        // 화살표/점 버튼에 포커스가 있을 때 좌우 키로 이동 (이벤트 버블).
        if (e.key === "ArrowRight") {
          e.preventDefault();
          go(1);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          go(-1);
        }
      }}
    >
      {/* 뷰포트 + 화살표 — sm 이상에서 카드를 안쪽으로 들여 화살표가 박스 바깥에 놓이게 함 */}
      <div className="relative sm:px-16">
        <div
          className="overflow-hidden"
          onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
          onTouchEnd={(e) => {
            if (touchX.current == null) return;
            const dx = e.changedTouches[0].clientX - touchX.current;
            if (dx < -40) go(1);
            else if (dx > 40) go(-1);
            touchX.current = null;
          }}
        >
          <div
            className="flex transition-transform duration-500 ease-out"
            style={{ transform: `translateX(-${i * 100}%)` }}
          >
            {SLIDES.map((s, idx) => (
              <div
                key={idx}
                className="w-full shrink-0 px-0.5"
                aria-hidden={i !== idx}
              >
                <SlideView slide={s} index={idx} total={n} />
              </div>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => go(-1)}
          aria-label="이전 단계"
          className="carousel-nav hidden sm:block absolute left-0 top-1/2 -translate-y-1/2 z-30 p-2 text-ink-soft hover:text-primary hover:scale-110 focus-visible:text-primary focus-visible:scale-110 transition"
        >
          <ChevronLeft className="w-10 h-10 sm:w-12 sm:h-12" strokeWidth={2.5} />
        </button>
        <button
          type="button"
          onClick={() => go(1)}
          aria-label="다음 단계"
          className="carousel-nav hidden sm:block absolute right-0 top-1/2 -translate-y-1/2 z-30 p-2 text-ink-soft hover:text-primary hover:scale-110 focus-visible:text-primary focus-visible:scale-110 transition"
        >
          <ChevronRight className="w-10 h-10 sm:w-12 sm:h-12" strokeWidth={2.5} />
        </button>
      </div>

      {/* 하단 컨트롤 — 모바일은 좌우 버튼+점, 데스크톱은 점+카운터(좌우는 박스 옆 화살표) */}
      <div className="mt-6 sm:mt-7 flex items-center justify-center gap-5 sm:gap-3">
        {/* 모바일 전용 이전 버튼 */}
        <button
          type="button"
          onClick={() => go(-1)}
          aria-label="이전 단계"
          className="carousel-nav sm:hidden shrink-0 p-1.5 text-ink-soft active:text-primary active:scale-90 transition"
        >
          <ChevronLeft className="w-7 h-7" strokeWidth={2.5} />
        </button>

        <div className="flex items-center gap-2">
          {SLIDES.map((_, k) => (
            <button
              key={k}
              type="button"
              onClick={() => setI(k)}
              aria-label={`${k + 1}단계로 이동`}
              aria-current={k === i}
              className={`carousel-nav h-2 rounded-full transition-all focus-visible:bg-primary ${
                k === i
                  ? "w-6 bg-primary"
                  : "w-2 bg-border-strong hover:bg-ink-muted"
              }`}
            />
          ))}
        </div>

        <span className="hidden sm:inline text-xs text-ink-muted tabular-nums">
          {i + 1} / {n}
        </span>

        {/* 모바일 전용 다음 버튼 */}
        <button
          type="button"
          onClick={() => go(1)}
          aria-label="다음 단계"
          className="carousel-nav sm:hidden shrink-0 p-1.5 text-ink-soft active:text-primary active:scale-90 transition"
        >
          <ChevronRight className="w-7 h-7" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
