import * as React from "react";
import { cn } from "./cn";

type LucideIcon = React.ComponentType<{
  className?: string;
  strokeWidth?: number;
}>;

export type EyebrowTone = "brand" | "accent" | "neutral";

const EYEBROW_TONE: Record<EyebrowTone, string> = {
  brand: "bg-card border-border-default text-primary",
  accent: "bg-accent-soft border-accent/30 text-accent-deep",
  neutral: "bg-surface-alt border-border-default text-ink-soft",
};

/** 섹션 상단의 작은 알약형 라벨 (아이콘 + 대문자 캡션). 랜딩 전반에서 반복되던 패턴. */
export function Eyebrow({
  icon: Icon,
  tone = "brand",
  className,
  children,
}: {
  icon?: LucideIcon;
  tone?: EyebrowTone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-widest",
        EYEBROW_TONE[tone],
        className,
      )}
    >
      {Icon && <Icon className="h-3 w-3" strokeWidth={2.5} />}
      {children}
    </span>
  );
}

/** 섹션 제목 블록 — eyebrow + 제목 + 부제. 정렬(center/left)과 톤만 바꿔 재사용. */
export function SectionHeading({
  eyebrow,
  eyebrowIcon,
  eyebrowTone,
  title,
  subtitle,
  align = "center",
  className,
}: {
  eyebrow?: React.ReactNode;
  eyebrowIcon?: LucideIcon;
  eyebrowTone?: EyebrowTone;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  align?: "center" | "left";
  className?: string;
}) {
  const centered = align === "center";
  return (
    <div
      className={cn(
        centered ? "text-center mx-auto max-w-2xl" : "text-left",
        className,
      )}
    >
      {eyebrow && (
        <div className="mb-4">
          <Eyebrow icon={eyebrowIcon} tone={eyebrowTone}>
            {eyebrow}
          </Eyebrow>
        </div>
      )}
      <h2 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">
        {title}
      </h2>
      {subtitle && (
        <p
          className={cn(
            "mt-3 text-sm leading-relaxed text-ink-soft sm:text-base",
            centered && "mx-auto max-w-xl",
          )}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}
