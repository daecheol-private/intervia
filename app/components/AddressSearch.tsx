"use client";

import { useState } from "react";
import { MapPin } from "lucide-react";
import { Button } from "@/app/components/ui";

/**
 * 다음(카카오) 우편번호 서비스 기반 주소 찾기 버튼.
 * 가입·API 키가 필요 없고 무료라 별도 설정 없이 동작한다. 스크립트는 첫 클릭 때만
 * 내려받는다(초기 로딩에 영향 없음). 스크립트 로드가 막힌 환경에서는 안내만 띄우고
 * 부모의 직접 입력 필드로 계속 진행할 수 있게 한다.
 *
 * ⚠️ next.config.ts 의 CSP 에 script-src 를 추가하게 되면 t1.daumcdn.net(스크립트) 과
 *    frame-src 의 postcode.map.daum.net(팝업 iframe) 을 허용해야 이 버튼이 계속 동작한다.
 */

const POSTCODE_SRC =
  "https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js";

type PostcodeData = {
  zonecode: string;
  roadAddress: string;
  jibunAddress: string;
  buildingName?: string;
  /** 사용자가 도로명(R)/지번(J) 중 무엇을 골랐는지. 둘 다 제공될 때만 값이 있다. */
  userSelectedType?: "R" | "J";
};

type PostcodeCtor = new (opts: {
  oncomplete: (data: PostcodeData) => void;
}) => { open: () => void };

declare global {
  interface Window {
    daum?: { Postcode: PostcodeCtor };
  }
}

let scriptPromise: Promise<void> | null = null;

function loadPostcodeScript(): Promise<void> {
  if (window.daum?.Postcode) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = POSTCODE_SRC;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
      scriptPromise = null; // 다음 클릭에 다시 시도
      reject(new Error("load failed"));
    };
    document.head.appendChild(el);
  });
  return scriptPromise;
}

/** "(06234) 서울 강남구 테헤란로 123 (인비아빌딩)" 형태로 합친다. */
function formatAddress(d: PostcodeData): string {
  const base = d.userSelectedType === "J" ? d.jibunAddress : d.roadAddress;
  const building = d.buildingName?.trim();
  return `(${d.zonecode}) ${building ? `${base} (${building})` : base}`;
}

export function AddressSearchButton({
  onSelect,
  label = "주소 찾기",
  className,
}: {
  /** 우편번호를 포함한 한 줄 주소. 상세 주소(호수·층)는 부모가 따로 받는다. */
  onSelect: (address: string) => void;
  label?: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const open = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await loadPostcodeScript();
      const Postcode = window.daum?.Postcode;
      if (!Postcode) throw new Error("not loaded");
      new Postcode({
        oncomplete: (data) => onSelect(formatAddress(data)),
      }).open();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={open}
        disabled={busy}
        className={className}
      >
        <MapPin className="w-4 h-4" strokeWidth={2.25} />
        {busy ? "여는 중..." : label}
      </Button>
      {failed && (
        <p className="text-[11px] text-danger mt-1">
          주소 검색 창을 열지 못했습니다. 아래에 직접 입력해 주세요.
        </p>
      )}
    </>
  );
}
