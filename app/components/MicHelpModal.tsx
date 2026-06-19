"use client";

/**
 * 마이크 설정 안내 팝업 — AI 면접 음성 입력이 안 될 때 후보자가 직접 따라 할 수 있는
 * Windows / Mac 설정 가이드.
 *
 * 마이크가 안 되는 원인은 대부분 (1) 브라우저 권한 거부, (2) OS 마이크 권한 차단,
 * (3) 장치 미연결/음소거 셋 중 하나라 그 순서대로 안내한다.
 * 접속 OS 를 추정해 해당 탭을 기본 선택하되, 두 OS 모두 볼 수 있게 탭으로 둔다.
 *
 *   <MicHelpModal open={open} onClose={() => setOpen(false)} />
 */
import { useState } from "react";
import { Modal } from "./Modal";

type OS = "windows" | "mac";

function detectOS(): OS {
  if (typeof navigator === "undefined") return "windows";
  return /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent) ? "mac" : "windows";
}

const WINDOWS_STEPS: string[] = [
  "주소창 왼쪽의 자물쇠(또는 ⓘ) 아이콘을 클릭 → '마이크'를 '허용'으로 바꾸고 페이지를 새로고침하세요. (가장 흔한 원인)",
  "그래도 안 되면 작업 표시줄 오른쪽 아래 스피커 아이콘을 우클릭 → '소리 설정'에서 입력 장치에 마이크가 보이는지, 음량이 0이 아닌지 확인하세요.",
  "시작 메뉴 → 설정 → '개인정보 보호 및 보안' → '마이크'로 이동합니다.",
  "'마이크 액세스'와 '앱이 마이크에 액세스하도록 허용'을 모두 켭니다.",
  "아래로 내려 '데스크톱 앱이 마이크에 액세스하도록 허용' 토글이 켜져 있는지 확인합니다. 브라우저(Chrome·Edge 등)는 그 아래 목록에 표시됩니다.",
  "브라우저로 돌아와 면접 페이지를 새로고침한 뒤 마이크 버튼을 다시 눌러 보세요.",
];

const MAC_STEPS: string[] = [
  "주소창 왼쪽의 자물쇠(또는 ⓘ) 아이콘을 클릭 → '마이크'를 '허용'으로 바꾸고 페이지를 새로고침하세요. (가장 흔한 원인)",
  "화면 왼쪽 위 모서리의 애플 메뉴 → '시스템 설정' → '개인정보 보호 및 보안' → '마이크'로 이동합니다. (macOS 12 이하는 '시스템 환경설정' → '보안 및 개인 정보 보호' → '개인 정보 보호' 탭 → '마이크')",
  "목록에서 사용 중인 브라우저(Chrome·Edge 등)의 스위치를 켭니다. (Safari는 이 목록에 없을 수 있으며, 그 경우 1번의 자물쇠 아이콘에서 허용하면 됩니다.)",
  "장치 확인: '시스템 설정' → '사운드' → '입력' 탭에서 마이크를 선택하고, 말할 때 입력 레벨 막대가 움직이는지 확인하세요.",
  "브라우저로 돌아와 면접 페이지를 새로고침한 뒤 마이크 버튼을 다시 눌러 보세요. (Chrome은 권한 변경 후 한 번 재시작이 필요할 수 있습니다.)",
];

export function MicHelpModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [os, setOs] = useState<OS>(detectOS);
  const steps = os === "mac" ? MAC_STEPS : WINDOWS_STEPS;

  return (
    <Modal open={open} onClose={onClose} title="🎙 마이크 설정 안내">
      <p className="text-sm text-ink-soft leading-relaxed mb-4">
        음성 입력이 되지 않을 때 아래 순서대로 확인해 주세요. 설정이 어려우면{" "}
        <strong className="text-ink">
          입력창에 직접 답변을 입력하셔도 평가에는 전혀 영향이 없습니다.
        </strong>
      </p>

      <div className="mb-4 rounded-lg bg-primary-soft/60 border border-primary/20 px-3 py-2 text-xs text-ink-soft leading-relaxed">
        음성 입력은 <strong>Chrome · Edge · Safari</strong>에서 가장 안정적입니다.
        Firefox 등 일부 브라우저는 음성 인식을 지원하지 않으니 다른 브라우저로 접속해
        주세요.
      </div>

      {/* OS 탭 */}
      <div
        className="flex gap-1 p-1 bg-surface-alt rounded-xl mb-4"
        role="tablist"
        aria-label="운영체제 선택"
      >
        {(
          [
            ["windows", "Windows"],
            ["mac", "Mac"],
          ] as [OS, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={os === key}
            onClick={() => setOs(key)}
            className={
              "flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors " +
              (os === key
                ? "bg-card text-primary-deep shadow-sm"
                : "text-ink-muted hover:text-ink-soft")
            }
          >
            {label}
          </button>
        ))}
      </div>

      <ol className="space-y-2.5">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-2.5 text-sm text-ink-soft">
            <span className="shrink-0 w-5 h-5 rounded-full bg-primary text-surface text-[11px] font-bold flex items-center justify-center mt-0.5">
              {i + 1}
            </span>
            <span className="leading-relaxed">{step}</span>
          </li>
        ))}
      </ol>

      <div className="mt-5 pt-4 border-t border-border-default">
        <button
          onClick={onClose}
          className="w-full px-4 py-2.5 rounded-lg bg-primary hover:bg-primary-deep text-surface text-sm font-medium"
        >
          확인했어요
        </button>
      </div>
    </Modal>
  );
}
