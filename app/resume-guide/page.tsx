import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { BackHomeLink } from "@/app/components/BackHomeLink";
import type { ReactNode } from "react";
import {
  ArrowRight,
  Link2,
  Upload,
  ClipboardList,
  ShieldCheck,
  Info,
  PencilLine,
  MousePointerClick,
  Building2,
  Save,
  Download,
  CheckSquare,
  ShieldOff,
  FilePlus2,
  ClipboardCheck,
  Copy,
  CheckCircle2,
} from "lucide-react";
import { SITE_INFO } from "@/lib/site-info";

/** 방법별 보조 스크린샷 — public/ 에 파일이 있을 때만 렌더한다(없으면 도식만). */
type Shot = { src: string; caption: string };

/**
 * public/ 에 스크린샷 파일이 실제 존재하는지 서버에서 확인.
 * 파일이 없으면 <img> 를 렌더하지 않아 '깨진 이미지'가 뜨지 않는다.
 * 사용자가 나중에 지정 파일명으로 PNG 를 넣으면 코드 수정 없이 자동으로 노출된다.
 */
function assetExists(src: string): boolean {
  try {
    return fs.existsSync(path.join(process.cwd(), "public", src.replace(/^\//, "")));
  } catch {
    return false;
  }
}

/** 흐름 도식 노드 — actor 로 색을 구분해 '지금 어느 화면에서 하는 일'인지 드러낸다. */
type FlowNode = {
  actor: "iv" | "ext";
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
};

const FLOW_1: FlowNode[] = [
  { actor: "iv", Icon: Link2, label: "지원링크 생성" },
  { actor: "ext", Icon: Building2, label: "채용사이트에 링크 게시" },
  { actor: "ext", Icon: Copy, label: "게시된 공고 URL 복사" },
  { actor: "iv", Icon: Download, label: "URL로 가져오기" },
  { actor: "iv", Icon: CheckCircle2, label: "공고 생성" },
];

const FLOW_2: FlowNode[] = [
  { actor: "iv", Icon: Link2, label: "지원링크 생성" },
  { actor: "iv", Icon: Save, label: "임시공고 저장" },
  { actor: "ext", Icon: Building2, label: "채용사이트에 링크 게시" },
  { actor: "iv", Icon: Download, label: "URL로 가져오기" },
  { actor: "iv", Icon: CheckCircle2, label: "정식 공고 생성" },
];

const FLOW_3: FlowNode[] = [
  { actor: "iv", Icon: FilePlus2, label: "공고 생성" },
  { actor: "ext", Icon: ClipboardCheck, label: "안내문구 → 공고 본문" },
  { actor: "iv", Icon: CheckSquare, label: "넣었음 체크" },
  { actor: "iv", Icon: Upload, label: "업로드 → AI 평가" },
];

const FLOW_4: FlowNode[] = [
  { actor: "iv", Icon: FilePlus2, label: "공고 생성" },
  { actor: "iv", Icon: ShieldOff, label: "AI 서류평가 없이 진행" },
  { actor: "iv", Icon: Upload, label: "업로드 → 직접 검토" },
];

export const metadata = {
  title: `이력서 등록 방법 4가지 — ${SITE_INFO.serviceName}`,
  description:
    "Intervia 에 이력서를 넣는 4가지 방법 — 지원 링크로 받기(2가지)와 이력서 파일 직접 업로드(2가지)를 실제 화면 순서 그대로 상세히 안내합니다.",
};

/**
 * 이력서 등록 방법 4가지 (공개 가이드 페이지).
 * 두 그룹(지원 링크로 받기 / 파일 직접 업로드)으로 나눠 방법 1~4 를 실제 UI 라벨
 * (지원링크 생성 · 임시공고 · 기존 공고 URL로 자동 채우기 · 안내 문구 보기 등) 그대로
 * 인용해 단계별로 설명한다. 문구는 실제 화면(app/jobs/new · jobs/[id] · consent-gate)과 일치 유지.
 */
export default function ResumeGuidePage() {
  return (
    <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      <BackHomeLink />
      <h1 className="text-2xl font-bold text-ink mt-3">이력서 등록 방법 4가지</h1>
      <p className="text-sm text-ink-soft leading-relaxed mt-2">
        이력서를 Intervia 로 받는 방법은 크게 두 가지입니다 — <b>지원 링크</b>로 지원자가
        직접 올리게 하거나, 이미 <b>가지고 있는 이력서 파일</b>을 직접 업로드하는 것입니다. 각각
        상황에 따라 2가지씩, 모두 4가지 방법을 순서 그대로 정리했습니다.
      </p>

      {/* 도식 색 범례 — 각 방법 상단 흐름 도식의 노드 색이 무엇을 뜻하는지. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-ink-muted">
        <span className="font-medium text-ink-soft">흐름 도식 색:</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-primary-soft border border-primary/40" />
          인터비아에서 하는 일
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-surface-alt border border-border-strong" />
          채용사이트에서 하는 일
        </span>
      </div>

      {/* 빠른 선택 가이드 */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <PickCard
          icon={<Link2 className="w-5 h-5" />}
          heading="지원자가 직접 올리게 하고 싶다"
          rows={[
            ["채용사이트 등록과 한 번에 끝내기", "방법 1"],
            ["링크 먼저 만들고 공고는 나중에", "방법 2"],
          ]}
        />
        <PickCard
          icon={<Upload className="w-5 h-5" />}
          heading="이력서 파일을 이미 가지고 있다"
          rows={[
            ["AI 서류평가까지 받기 (안내 가능)", "방법 3"],
            ["AI 서류평가 없이 직접 검토", "방법 4"],
          ]}
        />
      </div>

      {/* 그룹 A — 지원 링크로 받기 */}
      <GroupHeading
        icon={<Link2 className="w-5 h-5" />}
        title="지원 링크로 받기"
        desc="공고마다 생기는 전용 링크를 채용사이트에 붙여넣으면, 지원자가 직접 이력서를 올립니다."
      />

      <div className="space-y-5">
        <Method
          n={1}
          category="지원 링크 · 한자리에서 완성"
          title="채용사이트에 올리면서 한 번에 등록하기"
          whenIcon={MousePointerClick}
          when="채용사이트 등록과 인터비아 공고 작성을 한자리에서 끝내고 싶을 때."
          flow={FLOW_1}
          shots={[
            {
              src: "/rg-apply-link.png",
              caption:
                "새 공고 등록 상단 — ‘지원링크 생성’ 버튼과 ‘기존 공고 URL로 자동 채우기’. 방법 2도 같은 화면에서 시작합니다.",
            },
          ]}
        >
          <Step n={1}>
            인터비아에서 <UI>공고</UI> → <UI>새 공고 등록</UI>으로 들어가{" "}
            <UI>지원링크 생성</UI>을 누릅니다. 지원 링크(URL)가 발급됩니다.{" "}
            <b>이 탭은 닫지 말고</b> 그대로 둡니다.
          </Step>
          <Step n={2}>
            새 탭에서 사람인·잡코리아 등 채용사이트에 공고를 올릴 때,{" "}
            <UI>홈페이지 지원</UI>(자사 양식 지원) 링크란에 방금 발급된 인터비아 지원
            링크를 붙여넣고 공고를 게시합니다.
          </Step>
          <Step n={3}>게시된 채용사이트 공고의 URL을 복사합니다.</Step>
          <Step n={4}>
            열어둔 인터비아 새 공고 탭으로 돌아와 <UI>기존 공고 URL로 자동 채우기</UI>에
            그 URL을 붙여넣고 <UI>가져오기</UI>를 누르면, 제목·직무·자격요건이 자동으로
            채워집니다.
          </Step>
          <Step n={5}>
            내용을 확인·보완한 뒤 <UI>공고 생성</UI>을 누르면 정식 공고가 되고, 붙여둔
            지원 링크가 이 공고에 연결됩니다.
          </Step>
          <Note>
            지원 링크는 <b>저장해야 동작</b>합니다. 이 방법은 새 공고 탭을 닫지 않고
            한 번에 진행하는 방식이라, 중간에 탭을 닫으면 발급된 링크가 사라집니다 —
            그럴 땐 아래 <b>방법 2</b>(임시공고)를 쓰세요.
          </Note>
        </Method>

        <Method
          n={2}
          category="지원 링크 · 임시공고로 안전하게"
          title="지원 링크부터 만들어 두고 공고는 나중에 완성하기"
          whenIcon={PencilLine}
          when="지원 링크부터 먼저 확보해 두고, 공고 내용은 나중에 채우고 싶을 때. 링크를 잃어버릴 걱정이 없습니다."
          flow={FLOW_2}
        >
          <Step n={1}>
            <UI>새 공고 등록</UI>에서 <UI>지원링크 생성</UI>으로 링크를 발급합니다.
          </Step>
          <Step n={2}>
            곧바로 <UI>임시공고</UI> 버튼으로 저장합니다. 발급한 링크가 이 임시공고에
            연결되어 사라지지 않습니다.
          </Step>
          <Step n={3}>
            사람인 등 채용사이트에 공고를 올리며 <UI>홈페이지 지원</UI> 링크란에 인터비아
            지원 링크를 붙여넣고 게시합니다.
          </Step>
          <Step n={4}>
            인터비아에서 그 임시공고를 열어 <UI>공고 내용 작성하고 정식 등록 →</UI>으로
            들어간 뒤, <UI>기존 공고 URL로 자동 채우기</UI>에 채용사이트 공고 URL을
            붙여넣고 <UI>가져오기</UI>를 누릅니다.
          </Step>
          <Step n={5}>
            내용을 확인한 뒤 <UI>공고 생성</UI>으로 정식 등록합니다.
          </Step>
          <Note>
            임시공고 상태에서 들어온 이력서는 보관만 되고 평가되지 않습니다. 정식
            등록하면 그동안 쌓인 이력서를 한 번에 평가할 수 있습니다.
          </Note>
        </Method>
      </div>

      {/* 그룹 B — 이력서 파일 직접 업로드 */}
      <GroupHeading
        icon={<Upload className="w-5 h-5" />}
        title="이력서 파일 직접 업로드"
        desc="이미 가지고 있는 이력서 파일(PDF·DOCX·HWP·이미지·ZIP)을 끌어다 놓아 바로 등록합니다."
      />

      <div className="space-y-5">
        <Method
          n={3}
          category="직접 업로드 · AI 서류평가 켜기"
          title="AI 서류평가까지 받으며 업로드하기"
          whenIcon={ClipboardList}
          when="이력서 파일을 이미 보유했고 AI 서류평가까지 받고 싶을 때. 지원자에게 'AI 평가 활용' 안내를 넣을 수 있는 경우입니다."
          flow={FLOW_3}
          shots={[
            {
              src: "/rg-consent-gate.png",
              caption:
                "‘이력서 직접 업로드’의 동의 게이트 — 방법 3은 ‘공고에 안내 문구를 넣었습니다’ 체크, 방법 4는 아래 ‘AI 이력서 평가 없이 진행하기’.",
            },
            {
              src: "/rg-upload.png",
              caption: "안내 확인(또는 평가 끄기) 후 열리는 이력서 업로드 드롭존.",
            },
          ]}
        >
          <Step n={1}>
            이미 게시된 공고의 URL로 인터비아 공고를 만듭니다 — <UI>새 공고 등록</UI> →{" "}
            <UI>기존 공고 URL로 자동 채우기</UI>에 URL 붙여넣기 → <UI>가져오기</UI> →{" "}
            <UI>공고 생성</UI>. (URL이 없으면 내용을 직접 입력해도 됩니다.)
          </Step>
          <Step n={2}>
            만든 공고 상세에서 <UI>이력서 등록</UI> → ‘이력서 직접 업로드’ 영역의{" "}
            <UI>안내 문구 보기 · 공고에 넣는 법 →</UI>을 눌러 안내 문구를 복사한 뒤,
            채용사이트 공고 본문에 붙여넣습니다.
          </Step>
          <Step n={3}>
            다시 인터비아로 돌아와 <UI>공고에 안내 문구를 넣었습니다</UI> 체크박스를
            체크합니다.
          </Step>
          <Step n={4}>
            이력서 파일을 드롭존에 끌어다 놓거나 클릭해 업로드합니다(여러 파일·폴더·ZIP
            가능). AI 서류평가가 자동으로 시작됩니다.
          </Step>
          <Note>
            안내(고지)는 AI 채용 시 <b>법으로 정해진 지원자 안내</b>입니다. 체크는 ‘공고에
            안내 문구를 넣었다’는 확인이니, 실제로 넣은 뒤 체크하세요. 문구는 저희가 다
            준비해 뒀습니다.
          </Note>
        </Method>

        <Method
          n={4}
          category="직접 업로드 · AI 서류평가 끄기"
          title="AI 서류평가 없이 업로드하기 (안내가 어려울 때)"
          whenIcon={ShieldCheck}
          when="이력서 파일은 있지만 지원자에게 AI 평가 안내를 넣기 어려울 때. AI 서류평가를 끄고 사람이 직접 검토합니다."
          flow={FLOW_4}
        >
          <Step n={1}>
            공고를 만듭니다 — <UI>새 공고 등록</UI>에서 URL로 <UI>가져오기</UI> 하거나
            직접 입력해 <UI>공고 생성</UI>.
          </Step>
          <Step n={2}>
            공고 상세 <UI>이력서 등록</UI> → ‘이력서 직접 업로드’ 영역 아래쪽의{" "}
            <UI>안내를 넣기 어렵나요? AI 이력서 평가 없이 진행하기 →</UI>를 눌러
            확인합니다.
          </Step>
          <Step n={3}>
            이력서 파일을 업로드합니다. 서류는 채용 담당자가 직접 검토하고, AI는 면접
            단계(지원자 동의 후)부터 적용됩니다.
          </Step>
          <Note>
            이 경우 공고에 AI 평가 안내를 넣지 않아도 됩니다. 나중에{" "}
            <UI>AI 평가 다시 켜기</UI>로 되돌릴 수 있습니다.
          </Note>
        </Method>
      </div>

      {/* CTA */}
      <div className="mt-12 rounded-2xl border border-border-default bg-surface-alt/50 p-6 text-center">
        <p className="text-sm font-semibold text-ink">준비됐다면 공고를 만들어 보세요</p>
        <p className="text-xs text-ink-soft mt-1">
          공고를 등록하면 위 4가지 방법으로 바로 이력서를 받을 수 있습니다.
        </p>
        <Link
          href="/jobs/new"
          className="mt-4 inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-primary text-surface text-sm font-semibold hover:bg-primary-deep transition-colors"
        >
          새 공고 등록 <ArrowRight className="w-4 h-4" />
        </Link>
        <div className="mt-4 text-xs text-ink-soft">
          <Link href="/how-it-works" className="text-primary hover:underline">
            작동 방식
          </Link>{" "}
          ·{" "}
          <Link href="/features" className="text-primary hover:underline">
            전체 기능
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

/** 빠른 선택 카드 — 상황 → 해당 방법 매핑. */
function PickCard({
  icon,
  heading,
  rows,
}: {
  icon: ReactNode;
  heading: string;
  rows: [string, string][];
}) {
  return (
    <div className="rounded-2xl border border-border-default bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-primary-soft text-primary shrink-0">
          {icon}
        </span>
        <p className="text-sm font-semibold text-ink leading-snug">{heading}</p>
      </div>
      <ul className="mt-3 space-y-1.5">
        {rows.map(([label, method]) => (
          <li
            key={method}
            className="flex items-center justify-between gap-3 text-xs text-ink-soft"
          >
            <span className="leading-relaxed">{label}</span>
            <span className="shrink-0 rounded-md bg-primary px-2 py-0.5 text-[11px] font-semibold text-surface">
              {method}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 그룹 구분 헤딩 (지원 링크 / 직접 업로드). */
function GroupHeading({
  icon,
  title,
  desc,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="mt-10 mb-4 flex items-center gap-3">
      <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary text-surface shrink-0 shadow-sm">
        {icon}
      </span>
      <div className="min-w-0">
        <h2 className="text-lg font-bold text-ink">{title}</h2>
        <p className="text-xs text-ink-soft mt-0.5 leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}

/** 방법 카드 — 번호 + 제목 + '이런 경우에' + 단계 목록. */
function Method({
  n,
  category,
  title,
  when,
  whenIcon: WhenIcon,
  flow,
  shots,
  children,
}: {
  n: number;
  category: string;
  title: string;
  when: string;
  whenIcon: React.ComponentType<{ className?: string }>;
  flow: FlowNode[];
  shots?: Shot[];
  children: ReactNode;
}) {
  const visibleShots = (shots ?? []).filter((s) => assetExists(s.src));
  return (
    <section className="rounded-2xl border border-border-default bg-card p-5 sm:p-6 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-primary text-surface text-base font-bold shadow-sm shrink-0">
          {n}
        </span>
        <div className="min-w-0">
          <div className="text-[11px] font-medium text-primary">{category}</div>
          <h3 className="text-base sm:text-lg font-semibold text-ink leading-tight">
            {title}
          </h3>
        </div>
      </div>

      <div className="mt-3 flex items-start gap-2 rounded-lg border border-border-default bg-surface-alt px-3 py-2">
        <WhenIcon className="w-4 h-4 text-ink-muted shrink-0 mt-0.5" />
        <p className="text-xs text-ink-soft leading-relaxed">
          <span className="font-semibold text-ink">이런 경우에 </span>
          {when}
        </p>
      </div>

      <FlowDiagram nodes={flow} />

      <ol className="mt-4 space-y-2.5">{children}</ol>

      {visibleShots.length > 0 && (
        <div className="mt-4 space-y-3">
          {visibleShots.map((s) => (
            <figure
              key={s.src}
              className="max-w-xl overflow-hidden rounded-xl border border-border-default shadow-sm"
            >
              <img src={s.src} alt={s.caption} loading="lazy" className="block w-full" />
              <figcaption className="border-t border-border-default bg-surface-alt px-3 py-2 text-[11px] text-ink-muted leading-relaxed">
                {s.caption}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * 단계 흐름 도식 — 노드를 좌→우로 이어 붙이고 화살표로 연결한다.
 * actor(iv=인터비아 / ext=채용사이트)에 따라 색을 달리해 '어느 화면에서 하는 일'인지 드러낸다.
 * 좁은 화면에서는 가로 스크롤로 흐름 방향을 유지한다(줄바꿈 시 화살표 의미가 깨지지 않도록).
 */
function FlowDiagram({ nodes }: { nodes: FlowNode[] }) {
  return (
    <div className="mt-3">
      <div className="text-[11px] font-medium text-ink-muted mb-1.5">한눈에 보기</div>
      <div className="-mx-1 overflow-x-auto pb-1">
        <div className="flex items-center gap-1.5 w-max px-1">
          {nodes.map((node, i) => {
            const iv = node.actor === "iv";
            return (
              <div key={i} className="flex items-center gap-1.5">
                <div
                  className={`shrink-0 w-[112px] rounded-xl border px-2 py-2.5 text-center ${
                    iv
                      ? "bg-primary-soft border-primary/30"
                      : "bg-surface-alt border-border-strong"
                  }`}
                >
                  <div
                    className={`text-[9px] font-semibold tracking-wide ${
                      iv ? "text-primary" : "text-ink-muted"
                    }`}
                  >
                    {iv ? "인터비아" : "채용사이트"}
                  </div>
                  <node.Icon
                    className={`w-4 h-4 mx-auto mt-1 ${
                      iv ? "text-primary-deep" : "text-ink-soft"
                    }`}
                  />
                  <div className="text-[11px] font-medium text-ink mt-1 leading-tight break-keep">
                    {node.label}
                  </div>
                </div>
                {i < nodes.length - 1 && (
                  <ArrowRight className="w-4 h-4 text-ink-muted shrink-0" aria-hidden />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** 단계 항목 — 번호 원형 배지 + 설명. */
function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex items-center justify-center w-5 h-5 rounded-full border border-primary/40 bg-primary-soft text-primary text-[11px] font-bold shrink-0 mt-0.5 tabular-nums">
        {n}
      </span>
      <div className="text-sm text-ink-soft leading-relaxed">{children}</div>
    </li>
  );
}

/** 실제 화면의 버튼·라벨을 그대로 인용하는 인라인 칩. */
function UI({ children }: { children: ReactNode }) {
  return (
    <span className="inline rounded-md border border-border-strong bg-surface-alt px-1.5 py-0.5 text-[12px] font-medium text-ink">
      {children}
    </span>
  );
}

/** 방법별 주의/도움말 콜아웃. */
function Note({ children }: { children: ReactNode }) {
  return (
    <div className="mt-4 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2">
      <Info className="w-4 h-4 text-warning shrink-0 mt-0.5" />
      <p className="text-xs text-warning leading-relaxed">{children}</p>
    </div>
  );
}
