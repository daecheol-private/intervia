import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  ClipboardList,
  Upload,
  Lock,
  Share2,
  FileSearch,
  MessageSquare,
  ClipboardCheck,
  Mic,
  ShieldAlert,
  CalendarClock,
  ListChecks,
  Bell,
  LayoutDashboard,
  BarChart3,
  Columns3,
  StickyNote,
  Paperclip,
  Fingerprint,
  Target,
  EyeOff,
  MapPin,
  KeyRound,
  ScrollText,
  Building2,
  Server,
  Coins,
} from "lucide-react";
import { SITE_INFO } from "@/lib/site-info";

export const metadata = {
  title: `전체 기능 — ${SITE_INFO.serviceName}`,
  description:
    "공고 등록·AI 서류 평가·3단계 AI 면접·대면 면접 녹음 평가·일정 조율·결과 리포트까지 — Intervia 의 전체 기능을 카테고리별로 정리했습니다.",
};

/**
 * 전체 기능 상세 (공개 페이지). 랜딩의 FEATURES(벤토 그리드)와 같은 항목을
 * 카테고리로 묶어 나열한다. detail 문구는 FEATURES 와 일치 유지.
 */
type Feat = { Icon: LucideIcon; name: string; detail: string; badge?: string };
const GROUPS: { title: string; desc: string; features: Feat[] }[] = [
  {
    title: "지원자 모으기",
    desc: "공고를 만들고, 이력서를 한곳으로 모읍니다.",
    features: [
      {
        Icon: ClipboardList,
        name: "공고 등록",
        detail:
          "채용사이트 URL만 붙여넣으면 제목·자격요건·인재상을 AI가 자동으로 채웁니다.",
      },
      {
        Icon: Upload,
        name: "이력서 업로드",
        detail:
          "지원링크로 받거나 폴더·압축파일을 직접 업로드합니다 (최대 100MB, 개당 10MB).",
      },
      {
        Icon: Lock,
        name: "공고 PIN",
        detail: "공고별 PIN으로 외부 지원 링크를 잠급니다.",
      },
      {
        Icon: Share2,
        name: "공고 공유",
        detail: "같은 법인 멤버·이메일로 공고를 공유합니다.",
      },
    ],
  },
  {
    title: "AI 평가",
    desc: "서류부터 대면 면접까지, 사람이 매번 채점하지 않아도 됩니다.",
    features: [
      {
        Icon: FileSearch,
        name: "이력서 평가",
        detail:
          "직무 적합도를 6축으로 채점하고 JD 충족 여부·자기소개서까지 정성 검토합니다.",
      },
      {
        Icon: MessageSquare,
        name: "AI 면접",
        detail:
          "인성검사 → 직무 객관식 → 꼬리물기 심층 채팅까지 토큰 기반 실시간으로 진행합니다.",
      },
      {
        Icon: ClipboardCheck,
        name: "AI 면접 평가",
        detail:
          "기술·실무·커뮤니케이션·직무적합성을 수치화하고 컬처핏·Big Five 성향까지 분석합니다.",
      },
      {
        Icon: Mic,
        name: "대면 면접 평가",
        detail:
          "녹음 업로드·라이브 녹음으로 면접관/지원자 화자분리·전사 후 AI가 평가합니다.",
        badge: "beta",
      },
      {
        Icon: ShieldAlert,
        name: "부정행위 감지",
        detail:
          "붙여넣기·탭이탈을 집계하고 답변 문체로 대필 가능성을 보조 판단합니다.",
      },
    ],
  },
  {
    title: "면접 진행",
    desc: "일정 조율·질문지·통보를 자동으로 이어 줍니다.",
    features: [
      {
        Icon: CalendarClock,
        name: "면접 일정 · Zoom",
        detail:
          "슬롯을 제안하면 지원자가 확정·역제안하고, Zoom·캘린더가 자동 연동됩니다.",
      },
      {
        Icon: ListChecks,
        name: "면접 문제 생성",
        detail:
          "이력서·평가 기반으로 1차 실무 / 2차 임원 컬처핏 질문지를 자동 생성합니다.",
      },
      {
        Icon: Bell,
        name: "지원자 알림",
        detail:
          "면접 안내·일정 조율·합격 통보를 자사 메일과 카카오톡 알림톡으로 함께 보내 응답률을 높입니다.",
      },
    ],
  },
  {
    title: "관리 · 분석",
    desc: "진행 현황과 결과를 한눈에 보고 함께 결정합니다.",
    features: [
      {
        Icon: LayoutDashboard,
        name: "채용 대시보드",
        detail: "진행 중인 공고와 지금 내가 해야 할 일을 한눈에 모아 봅니다.",
      },
      {
        Icon: BarChart3,
        name: "결과 리포트",
        detail: "단계별 후보 분포와 평균 점수를 펀널로 보여주고 CSV로 내보냅니다.",
      },
      {
        Icon: Columns3,
        name: "후보자 비교",
        detail: "여러 후보의 점수·강점·우려를 한 화면에서 나란히 비교합니다.",
      },
      {
        Icon: StickyNote,
        name: "면접관 메모",
        detail: "면접관별 스코어·메모를 남겨 함께 공유합니다.",
      },
      {
        Icon: Paperclip,
        name: "첨부 분리",
        detail: "포트폴리오·경력기술서를 자동으로 분리합니다.",
      },
      {
        Icon: Fingerprint,
        name: "중복 차단",
        detail: "SHA-256 해시로 중복 이력서를 자동 차단합니다.",
      },
      {
        Icon: Target,
        name: "인재상 · NCS",
        detail: "법인 선호 인재상·NCS 핵심역량을 설정합니다.",
      },
    ],
  },
  {
    title: "보안 · 개인정보",
    desc: "개인정보는 최소한으로, 처리는 투명하게.",
    features: [
      {
        Icon: EyeOff,
        name: "개인정보 마스킹",
        detail:
          "이름·전화·주소를 자동 마스킹하고 이미지 이력서는 OCR로 읽어 처리합니다.",
      },
      {
        Icon: MapPin,
        name: "국내 AI 처리",
        detail: "모든 AI 추론을 서울 리전에서 — 국외이전 없음.",
      },
      {
        Icon: KeyRound,
        name: "계정 보안",
        detail: "MFA(2단계 인증)와 세션 관리를 지원합니다.",
      },
      {
        Icon: ScrollText,
        name: "감사 · 이의제기",
        detail: "데이터 접근을 로그로 추적하고 이의제기를 받습니다.",
      },
      {
        Icon: Building2,
        name: "법인 분리 · 권한",
        detail:
          "이메일 도메인으로 법인을 자동 분리하고, 관리자 승인제 + 3역할로 권한을 나눕니다.",
      },
      {
        Icon: Server,
        name: "메일 서버 연동",
        detail: "법인 자체 SMTP를 연동해 발송합니다 (SPF/DKIM).",
      },
    ],
  },
  {
    title: "과금",
    desc: "쓴 만큼만, 실패하면 소모하지 않습니다.",
    features: [
      {
        Icon: Coins,
        name: "토큰 과금",
        detail:
          "공고·이력서·면접 단위로 과금하고 평가 실패 시 토큰을 소모하지 않습니다.",
      },
    ],
  },
];

// 상단 대표 화면 갤러리 — 실제 제품 스크린샷 (public/).
const SHOTS = [
  {
    src: "/feat-dashboard.png",
    alt: "채용 대시보드 화면",
    caption: "채용 대시보드 — 진행 현황·파이프라인·오늘 할 일을 한눈에",
  },
  {
    src: "/feat-compare.png",
    alt: "후보자 비교 화면",
    caption: "후보자 비교 — 6축 적합도로 여러 후보를 나란히",
  },
  {
    src: "/feat-ai-eval.png",
    alt: "AI 면접 평가 화면",
    caption: "AI 면접 평가 — 컬처핏·Big Five 성향 분석",
  },
  {
    src: "/feat-resume-6axis.png",
    alt: "종합 평가 화면",
    caption: "종합 평가 — 6축 적합도와 추천 등급",
  },
];

export default function FeaturesPage() {
  return (
    <main className="max-w-4xl mx-auto w-full px-6 py-10">
      <Link href="/" className="text-xs text-ink-muted hover:underline">
        ← 홈
      </Link>
      <h1 className="text-2xl font-bold text-ink mt-3">전체 기능</h1>
      <p className="text-sm text-ink-soft leading-relaxed mt-2">
        공고 등록부터 합·불 통보까지, Intervia 는 채용 한 사이클에 필요한 기능을 한
        곳에 담았습니다. 필요한 기능만 골라 쓸 수 있습니다.
      </p>

      {/* 대표 화면 갤러리 */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {SHOTS.map((s) => (
          <figure
            key={s.src}
            className="overflow-hidden rounded-xl border border-border-default shadow-sm"
          >
            <img
              src={s.src}
              alt={s.alt}
              loading="lazy"
              className="block w-full"
            />
            <figcaption className="border-t border-border-default bg-card px-3 py-2 text-xs text-ink-soft">
              {s.caption}
            </figcaption>
          </figure>
        ))}
      </div>

      {GROUPS.map((g) => (
        <section key={g.title} className="mt-10">
          <div className="border-b border-border-default pb-2">
            <h2 className="text-base font-semibold text-ink">{g.title}</h2>
            <p className="text-xs text-ink-soft mt-0.5">{g.desc}</p>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {g.features.map((f) => (
              <div
                key={f.name}
                className="flex items-start gap-3 rounded-xl border border-border-default bg-card p-4"
              >
                <span className="w-9 h-9 rounded-lg bg-primary-soft text-primary-deep flex items-center justify-center shrink-0">
                  <f.Icon className="w-4 h-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-ink flex items-center gap-1.5">
                    {f.name}
                    {f.badge && (
                      <span className="rounded-full bg-accent-soft px-1.5 py-px text-[9px] font-bold uppercase text-accent-deep">
                        {f.badge}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-ink-soft mt-1 leading-relaxed">
                    {f.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      {/* CTA */}
      <div className="mt-12 rounded-2xl border border-border-default bg-surface-alt/50 p-6 text-center">
        <p className="text-sm font-semibold text-ink">
          채용 한 사이클을 Intervia 하나로
        </p>
        <p className="text-xs text-ink-soft mt-1">
          신용카드 등록 없이 무료로 먼저 써 보세요.
        </p>
        <Link
          href="/signup"
          className="mt-4 inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-primary text-surface text-sm font-semibold hover:bg-primary-deep transition-colors"
        >
          무료로 시작하기 <ArrowRight className="w-4 h-4" />
        </Link>
        <div className="mt-4 text-xs text-ink-soft">
          <Link href="/how-it-works" className="text-primary hover:underline">
            작동 방식
          </Link>{" "}
          ·{" "}
          <Link href="/pricing" className="text-primary hover:underline">
            요금
          </Link>{" "}
          ·{" "}
          <Link href="/faq" className="text-primary hover:underline">
            자주 묻는 질문
          </Link>
        </div>
      </div>
    </main>
  );
}
