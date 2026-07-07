import { SITE_INFO } from "@/lib/site-info";
import Link from "next/link";
import {
  MapPin,
  EyeOff,
  Trash2,
  UserCheck,
  ShieldCheck,
  KeyRound,
  Lock,
} from "lucide-react";

export const metadata = {
  title: `보안과 데이터 보호 — ${SITE_INFO.serviceName}`,
  description:
    "Intervia 가 지원자의 개인정보와 채용 데이터를 어떻게 보호하는지 — AI 처리 위치, 개인정보 마스킹, 보관·폐기, 계정 보안을 로그인 없이 확인할 수 있습니다.",
};

/**
 * 보안·데이터 보호 안내 (공개 페이지, 비로그인).
 *
 * 개인정보 처리방침(/privacy)·AI 평가 사전공개(/legal/ai-evaluation-disclosure)에
 * 흩어진 보안·데이터 관련 사실을 지원자·고객이 빠르게 확인할 수 있도록 재구성한
 * 안내 페이지. 새로운 약속을 만들지 않고 두 문서의 사실만 요약·강조한다.
 *
 * ⚠️ 여기의 모든 진술은 실제 구현·처리방침과 일치해야 한다(대외 공개 = 약속):
 *   · AI 서울 리전/학습 미사용/마스킹 = lib/gemini.ts, ai-evaluation-disclosure §1·§3
 *   · 위탁·국외이전·보유기간 = lib/site-info.ts PROCESSORS, ai-evaluation-disclosure §7
 *   · 비밀번호 유출검사(HIBP k-anonymity) = PROCESSORS "Have I Been Pwned"
 *   근거가 바뀌면 이 페이지도 함께 갱신.
 */
const HIGHLIGHTS = [
  {
    Icon: MapPin,
    title: "AI 분석은 국내에서",
    desc: "Google Cloud 서울 리전에서 처리 · AI 처리 단계 국외이전 없음",
  },
  {
    Icon: EyeOff,
    title: "평가 전 자동 마스킹",
    desc: "이름·연락처·학교 등 식별정보를 가린 뒤 AI 에 전달",
  },
  {
    Icon: Trash2,
    title: "이력서 원문 즉시 폐기",
    desc: "합·불 결정 시점에 이력서 원본 파일을 삭제",
  },
  {
    Icon: UserCheck,
    title: "AI 는 결정하지 않음",
    desc: "최종 합·불은 반드시 사람이 판단",
  },
];

export default function SecurityPage() {
  return (
    <main className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      <Link href="/" className="text-xs text-ink-muted hover:underline">
        ← 홈
      </Link>
      <h1 className="text-2xl font-bold text-ink mt-3">보안과 데이터 보호</h1>
      <p className="text-sm text-ink-soft leading-relaxed mt-2">
        <strong>{SITE_INFO.serviceName}</strong> 는 지원자의 개인정보와 채용
        데이터를 최소한으로 수집하고, 처리 전 과정을 투명하게 공개합니다. 아래는
        데이터가 어디서 처리되고 어떻게 보호·폐기되는지에 대한 설명이며, 누구나
        로그인 없이 확인할 수 있습니다.
      </p>

      {/* 한눈 요약 — 핵심 4가지 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-6">
        {HIGHLIGHTS.map(({ Icon, title, desc }) => (
          <div
            key={title}
            className="flex items-start gap-3 rounded-xl border border-border-default bg-surface-alt/50 p-4"
          >
            <span className="w-9 h-9 rounded-lg bg-primary-soft text-primary-deep flex items-center justify-center shrink-0">
              <Icon className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-ink">{title}</div>
              <div className="text-xs text-ink-soft mt-0.5 leading-relaxed">
                {desc}
              </div>
            </div>
          </div>
        ))}
      </div>

      <Section Icon={MapPin} title="AI 처리 위치와 국외이전">
        <ul className="list-disc list-inside space-y-1">
          <li>
            AI 서류·면접 평가는 Google Cloud Vertex AI{" "}
            <strong>서울 리전(asia-northeast3, 대한민국)</strong> 에서
            처리됩니다. AI 처리 단계에서 데이터가 국외로 이전되지 않습니다.
          </li>
          <li>
            <strong>결제 등급 계정</strong>을 사용하므로, AI 에 전달된 데이터가
            모델 학습에 활용되지 않습니다 (Google 정책).
          </li>
          <li>
            데이터 저장·이메일 발송 등 일부 인프라는 해외 클라우드에
            위탁됩니다(예: 데이터베이스는 일본 리전). 관련 위탁·국외이전 현황은{" "}
            <Link href="/privacy" className="text-primary hover:underline">
              개인정보 처리방침
            </Link>{" "}
            에 모두 공개합니다 — 숨기지 않습니다.
          </li>
        </ul>
      </Section>

      <Section Icon={EyeOff} title="평가 전 개인정보 마스킹">
        <ul className="list-disc list-inside space-y-1">
          <li>
            AI 에 텍스트를 전달하기 전에 이름·생년월일·연락처·이메일·주소·학교명·
            지역명 등 <strong>직접 식별자</strong>와 채용절차법 §4의3{" "}
            <strong>평가 금지 항목</strong>(성별·나이·가족관계 등)을 자동으로
            가립니다.
          </li>
          <li>
            마스킹은 정규식·사전 기반 자동 처리라 사전에 없던 표기는 잔존할 수
            있으나, 통과하더라도 평가 모델에{" "}
            <strong>해당 항목을 평가에 반영하지 말라는 지시</strong>가 함께
            적용됩니다 (이중 방어).
          </li>
          <li>
            평가 차원·가중치 등 자세한 기준은{" "}
            <Link
              href="/legal/ai-evaluation-disclosure"
              className="text-primary hover:underline"
            >
              AI 평가 사전공개
            </Link>{" "}
            에서 확인할 수 있습니다.
          </li>
        </ul>
      </Section>

      <Section Icon={Trash2} title="데이터 보관과 폐기">
        <ul className="list-disc list-inside space-y-1">
          <li>
            이력서 원본 파일·마스킹 텍스트:{" "}
            <strong>합·불 결정 시점 즉시 폐기</strong>
          </li>
          <li>
            평가 결과(점수·의견): 채용 공고 종결 후{" "}
            <strong>14일 뒤 자동 삭제</strong>
          </li>
          <li>
            감사 로그(결정 시각·결정자·이의제기 기록): 분쟁 대응 목적{" "}
            <strong>최장 5년</strong> 보관 후 폐기
          </li>
          <li>
            최종 합격자 정보는 입사·인사기록 목적으로 채용기업이 삭제할 때까지
            보유됩니다.
          </li>
        </ul>
      </Section>

      <Section Icon={KeyRound} title="계정과 접근 보안">
        <ul className="list-disc list-inside space-y-1">
          <li>
            <strong>2단계 인증(MFA)</strong> 지원 · 로그인 세션 자동 만료
          </li>
          <li>
            비밀번호는 <strong>복원 불가능한 해시</strong>로 저장하며, 가입·변경
            시 유출 이력이 있는 비밀번호인지 검사합니다. 이때 비밀번호 자체는
            외부로 전송하지 않습니다 (k-익명성 방식 — 해시 앞 5자만 대조).
          </li>
          <li>
            <strong>법인별 데이터 격리</strong> — 각 채용기업의 데이터는
            분리되어, 다른 법인이 접근할 수 없습니다.
          </li>
        </ul>
      </Section>

      <Section Icon={Lock} title="전송·인프라 보안">
        <ul className="list-disc list-inside space-y-1">
          <li>
            서비스 전 구간을 <strong>HTTPS(TLS)</strong> 로 암호화하여
            전송합니다.
          </li>
          <li>
            검증된 상용 클라우드(Google Cloud · Vercel · Turso) 위에서
            운영합니다.
          </li>
        </ul>
      </Section>

      <Section Icon={ShieldCheck} title="투명한 위탁 공개">
        <p>
          데이터를 처리하는 모든 위탁 업체와 국외이전 현황(업체명·목적·처리 항목·
          국가·보유기간)을{" "}
          <Link href="/privacy" className="text-primary hover:underline">
            개인정보 처리방침
          </Link>{" "}
          에 빠짐없이 공개합니다. 지원자는 자신의 정보에 대한 열람·정정·삭제·
          처리정지를 언제든 요청할 수 있습니다.
        </p>
      </Section>

    </main>
  );
}

function Section({
  Icon,
  title,
  children,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-base font-semibold text-ink flex items-center gap-2">
        <Icon className="w-4 h-4 text-primary-deep shrink-0" />
        {title}
      </h2>
      <div className="text-sm text-ink-soft leading-relaxed mt-2 space-y-2">
        {children}
      </div>
    </section>
  );
}
