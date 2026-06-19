/**
 * Hero 아래 전체폭 "제품 데모 영상" 섹션.
 * 실제 화면 녹화 영상을 브라우저 프레임에 담아 보여준다 (HowItWorksCarousel 목업과 톤 통일).
 *
 * ── 영상 넣는 법 ──────────────────────────────────────────────
 *  1) 16:9 로 화면 녹화 → webm/mp4 + poster 로 변환
 *  2) interviewer/public/ 에 아래 파일명으로 저장
 *       - hero-demo.webm          (VP9 권장, 우선 로드)
 *       - hero-demo.mp4           (H.264 폴백)
 *       - hero-demo-poster.webp   (첫 프레임 정지 이미지 = 로딩/폴백)
 *  3) 아래 DEMO_VIDEO_READY 를 true 로 변경
 *  4) app/page.tsx 의 Hero 아래(<WhyNotJobBoard /> 위)에 <ProductDemo /> 한 줄 추가
 * ─────────────────────────────────────────────────────────────
 *
 * autoplay 는 muted + playsInline 이어야 모바일에서도 재생된다.
 * poster 는 영상 로드 전·재생 불가 환경에서 정지 이미지로 노출된다.
 */
import { Sparkles, Lock } from "lucide-react";

// 영상 3종을 public/ 에 넣은 뒤 true 로 바꾸세요.
const DEMO_VIDEO_READY = false;

const VIDEO_WEBM = "/hero-demo.webm";
const VIDEO_MP4 = "/hero-demo.mp4";
const POSTER = "/hero-demo-poster.webp";
const DEMO_URL = "intervia.app";

export function ProductDemo() {
  return (
    <section className="relative overflow-hidden bg-surface border-y border-border-default">
      {/* 배경 장식 — Hero 와 동일 톤 (forest glow + dot grid) */}
      <div
        aria-hidden
        className="absolute -z-10 left-1/2 top-0 -translate-x-1/2 w-[900px] h-[600px] rounded-full bg-primary-soft/40 blur-3xl"
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 opacity-[0.04]"
        style={{
          backgroundImage: "radial-gradient(var(--ink) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />

      <div className="max-w-5xl mx-auto px-6 py-16 sm:py-20">
        <div className="text-center mb-8 sm:mb-10">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-card border border-border-default text-[11px] uppercase tracking-widest text-primary font-semibold mb-4">
            <Sparkles className="w-3 h-3" strokeWidth={2.5} />
            제품 데모
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-ink">
            30초로 보는 Intervia
          </h2>
          <p className="mt-3 text-sm text-ink-soft">
            공고 등록부터 AI 면접, 평가 리포트까지 — 실제 화면 그대로.
          </p>
        </div>

        {/* 브라우저 프레임 + 영상 */}
        <div className="rounded-2xl border border-border-default bg-card shadow-2xl ring-1 ring-black/5 overflow-hidden">
          {/* 상단 신호등 + 주소창 */}
          <div className="flex items-center gap-1.5 px-3 py-2.5 bg-surface-alt border-b border-border-default">
            <span className="w-2.5 h-2.5 rounded-full bg-danger/50" />
            <span className="w-2.5 h-2.5 rounded-full bg-warning/50" />
            <span className="w-2.5 h-2.5 rounded-full bg-primary/40" />
            <div className="ml-2 flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-card border border-border-default max-w-[260px]">
              <Lock className="w-2.5 h-2.5 text-ink-muted shrink-0" />
              <span className="text-[10px] text-ink-muted truncate">{DEMO_URL}</span>
            </div>
          </div>

          {/* 16:9 영상 영역 */}
          <div className="relative aspect-video bg-surface">
            {DEMO_VIDEO_READY ? (
              <video
                className="absolute inset-0 w-full h-full object-cover"
                autoPlay
                muted
                loop
                playsInline
                preload="metadata"
                poster={POSTER}
              >
                <source src={VIDEO_WEBM} type="video/webm" />
                <source src={VIDEO_MP4} type="video/mp4" />
              </video>
            ) : (
              <PlaceholderState />
            )}
          </div>
        </div>

        <p className="mt-4 text-center text-[11px] text-ink-muted">
          음성 없이 자동 재생됩니다.
        </p>
      </div>
    </section>
  );
}

/** 영상 파일을 아직 안 넣었을 때 보이는 자리 표시 — 운영 노출 전까지의 안내. */
function PlaceholderState() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 text-center px-6">
      <div className="w-12 h-12 rounded-full bg-primary-soft flex items-center justify-center">
        <Sparkles className="w-5 h-5 text-primary" strokeWidth={2} />
      </div>
      <p className="text-sm font-medium text-ink-soft">제품 데모 영상 자리</p>
      <p className="text-[11px] text-ink-muted max-w-sm leading-relaxed">
        <code>public/</code> 에 hero-demo.webm · hero-demo.mp4 ·
        hero-demo-poster.webp 를 넣고 ProductDemo.tsx 의{" "}
        <code>DEMO_VIDEO_READY</code> 를 true 로 바꾸면 표시됩니다.
      </p>
    </div>
  );
}
