import { notFound } from "next/navigation";
import {
  Sparkles,
  ShieldCheck,
  ArrowRight,
  Check,
  Workflow,
} from "lucide-react";
import {
  Button,
  buttonClass,
  Badge,
  Card,
  Container,
  SectionHeading,
  Eyebrow,
  Input,
  Textarea,
  Field,
  Checkbox,
  Alert,
  type ButtonVariant,
  type ButtonSize,
  type BadgeTone,
  type BadgeVariant,
  type AlertTone,
} from "@/app/components/ui";
import Link from "next/link";

export const metadata = { title: "Design System · Intervia" };

const COLOR_TOKENS: { name: string; var: string; ink?: boolean }[] = [
  { name: "primary", var: "--primary" },
  { name: "primary-deep", var: "--primary-deep" },
  { name: "primary-soft", var: "--primary-soft", ink: true },
  { name: "accent", var: "--accent", ink: true },
  { name: "accent-deep", var: "--accent-deep" },
  { name: "surface", var: "--surface", ink: true },
  { name: "surface-alt", var: "--surface-alt", ink: true },
  { name: "card", var: "--card", ink: true },
  { name: "ink", var: "--ink" },
  { name: "ink-soft", var: "--ink-soft" },
  { name: "ink-muted", var: "--ink-muted" },
  { name: "border", var: "--border", ink: true },
  { name: "success", var: "--success" },
  { name: "warning", var: "--warning" },
  { name: "danger", var: "--danger" },
  { name: "info", var: "--info" },
];

const BUTTON_VARIANTS: ButtonVariant[] = [
  "primary",
  "secondary",
  "accent",
  "ghost",
  "danger",
];
const BUTTON_SIZES: ButtonSize[] = ["sm", "md", "lg"];
const BADGE_TONES: BadgeTone[] = [
  "neutral",
  "brand",
  "accent",
  "success",
  "warning",
  "danger",
  "info",
];
const BADGE_VARIANTS: BadgeVariant[] = ["soft", "solid", "outline"];
const ALERT_TONES: AlertTone[] = [
  "info",
  "brand",
  "success",
  "warning",
  "danger",
];

function Block({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-border-default pt-10">
      <h3 className="mb-5 text-xs font-semibold uppercase tracking-widest text-ink-muted">
        {title}
      </h3>
      {children}
    </section>
  );
}

export default function DesignSystemPage() {
  // 디자인 레퍼런스 — 운영에는 노출하지 않는다.
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main className="flex-1 bg-surface py-16">
      <Container width="lg" className="space-y-12">
        <header>
          <Eyebrow icon={Sparkles}>Design System</Eyebrow>
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-ink">
            Intervia UI 프리미티브
          </h1>
          <p className="mt-3 max-w-xl text-ink-soft">
            Forest + Ivory 토큰 위에 올린 공통 컴포넌트. 모든 페이지가 이걸
            가져다 쓰면 디자인이 자동으로 통일됩니다.{" "}
            <code className="rounded bg-surface-alt px-1.5 py-0.5 text-xs">
              @/app/components/ui
            </code>
          </p>
        </header>

        <Block title="Color Tokens">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            {COLOR_TOKENS.map((t) => (
              <div
                key={t.name}
                className="overflow-hidden rounded-xl border border-border-default"
              >
                <div
                  className="flex h-16 items-end p-2"
                  style={{ background: `var(${t.var})` }}
                >
                  <span
                    className={
                      "text-[10px] font-mono " +
                      (t.ink ? "text-ink-soft" : "text-white/80")
                    }
                  >
                    {t.var}
                  </span>
                </div>
                <div className="bg-card px-2 py-1.5 text-[11px] font-medium text-ink">
                  {t.name}
                </div>
              </div>
            ))}
          </div>
        </Block>

        <Block title="Buttons">
          <div className="space-y-5">
            {BUTTON_SIZES.map((size) => (
              <div key={size} className="flex flex-wrap items-center gap-3">
                <span className="w-8 text-xs font-mono text-ink-muted">
                  {size}
                </span>
                {BUTTON_VARIANTS.map((variant) => (
                  <Button key={variant} variant={variant} size={size}>
                    {variant}
                  </Button>
                ))}
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <span className="w-8 text-xs font-mono text-ink-muted">link</span>
              <Link href="#" className={buttonClass({ size: "lg" })}>
                Link as 버튼
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Button size="lg" variant="secondary">
                <ShieldCheck className="h-4 w-4" />
                아이콘 + 텍스트
              </Button>
              <Button disabled>disabled</Button>
            </div>
          </div>
        </Block>

        <Block title="Badges">
          <div className="space-y-4">
            {BADGE_VARIANTS.map((variant) => (
              <div key={variant} className="flex flex-wrap items-center gap-2">
                <span className="w-14 text-xs font-mono text-ink-muted">
                  {variant}
                </span>
                {BADGE_TONES.map((tone) => (
                  <Badge key={tone} tone={tone} variant={variant}>
                    {tone}
                  </Badge>
                ))}
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="w-14 text-xs font-mono text-ink-muted">opts</span>
              <Badge tone="success" dot>
                진행중
              </Badge>
              <Badge tone="brand" icon={Check}>
                PIPA 준수
              </Badge>
              <Badge tone="warning" variant="solid" icon={Sparkles}>
                BETA
              </Badge>
            </div>
          </div>
        </Block>

        <Block title="Cards">
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <div className="mb-2 text-sm font-semibold text-ink">
                기본 카드
              </div>
              <p className="text-sm text-ink-soft">
                bg-card + border + rounded-2xl. padding md.
              </p>
            </Card>
            <Card tone="alt" hover>
              <div className="mb-2 text-sm font-semibold text-ink">
                surface-alt + hover
              </div>
              <p className="text-sm text-ink-soft">
                마우스를 올리면 살짝 떠오릅니다.
              </p>
            </Card>
            <Card padding="lg" className="ring-1 ring-primary/15 border-primary/25">
              <div className="mb-2 text-sm font-semibold text-primary">
                강조 카드
              </div>
              <p className="text-sm text-ink-soft">
                className 으로 ring/border 추가 확장.
              </p>
            </Card>
          </div>
        </Block>

        <Block title="Section Heading">
          <Card tone="alt" padding="lg">
            <SectionHeading
              eyebrow="How it works"
              eyebrowIcon={Workflow}
              title="채용 사이클의 80%를 자동화합니다"
              subtitle="공고 등록부터 합·불 통보까지, 사람이 매번 할 필요 없는 일을 AI가 처리합니다."
            />
          </Card>
        </Block>

        <Block title="Form — Field · Input · Checkbox">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="이메일" required>
              <Input type="email" placeholder="you@company.com" />
            </Field>
            <Field
              label="사업자번호"
              error="10자리 숫자여야 합니다."
            >
              <Input defaultValue="123-45" error />
            </Field>
            <Field
              label="법인명"
              hint="검색되지 않는 법인은 직접 입력하세요."
              className="sm:col-span-2"
            >
              <Input placeholder="회사명" />
            </Field>
            <Field label="메모" className="sm:col-span-2">
              <Textarea placeholder="여러 줄 입력…" />
            </Field>
          </div>
          <div className="mt-4 flex flex-wrap gap-5">
            <Checkbox defaultChecked>ID 저장</Checkbox>
            <Checkbox align="start">
              <span>
                <span className="font-medium text-ink">전체 동의</span>{" "}
                <span className="text-[11px] text-ink-muted">(선택 포함)</span>
              </span>
            </Checkbox>
          </div>
        </Block>

        <Block title="Alert">
          <div className="space-y-2">
            {ALERT_TONES.map((tone) => (
              <Alert key={tone} tone={tone}>
                <strong>{tone}</strong> — 인라인 메시지 박스. error/info/Banner/경고를
                이 하나로 통일합니다.
              </Alert>
            ))}
          </div>
        </Block>
      </Container>
    </main>
  );
}
