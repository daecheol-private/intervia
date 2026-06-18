"use client";

import { useEffect, useState } from "react";
import { Calendar, X } from "lucide-react";
import { formatLocalDate } from "@/lib/utils";

type Blocker = {
  candidateId: number;
  candidateName: string;
  reason: "ai_interview_pending" | "schedule_pending";
  expiresAt: string;
};

type CloseCheck = {
  ok: boolean;
  blockers: Blocker[];
  pendingDecisionCount: number;
  expired: boolean;
  closesAt: string | null;
};

type ExtendInfo = {
  candidateCount: number;
  totalCandidateCount: number;
  perResume: number;
  totalCost: number;
  extensionDays: number;
};

const REASON_LABEL: Record<Blocker["reason"], string> = {
  ai_interview_pending: "AI 면접 응시 대기",
  schedule_pending: "1차 면접 일정 응답 대기",
};

/**
 * 만료된 공고(closesAt 지났고 status='active') 진입 시 강제 노출.
 * HR 이 "연장" 또는 "종결" 중 하나를 선택해야 추가 작업 가능.
 */
export function JobExpiredDecisionModal({
  jobId,
  closesAt,
  onResolved,
  onDismiss,
}: {
  jobId: number;
  closesAt: string;
  onResolved: () => void;
  /** 모달을 닫되 공고는 만료 상태 유지 — 페이지에서 HR 액션은 disabled. */
  onDismiss?: () => void;
}) {
  const [check, setCheck] = useState<CloseCheck | null>(null);
  const [extInfo, setExtInfo] = useState<ExtendInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [sendNotification, setSendNotification] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    void (async () => {
      const [c, e] = await Promise.all([
        fetch(`/api/jobs/${jobId}/close`).then((r) => r.json()),
        fetch(`/api/jobs/${jobId}/extend`).then((r) => r.json()),
      ]);
      setCheck(c);
      setExtInfo(e);
    })();
  }, [jobId]);

  const doExtend = async () => {
    setBusy(true);
    setErr("");
    const r = await fetch(`/api/jobs/${jobId}/extend`, { method: "POST" });
    const data = await r.json().catch(() => null);
    setBusy(false);
    if (!r.ok) {
      setErr(data?.message ?? "연장 실패");
      return;
    }
    onResolved();
  };

  const doClose = async () => {
    setBusy(true);
    setErr("");
    const r = await fetch(`/api/jobs/${jobId}/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sendNotification }),
    });
    const data = await r.json().catch(() => null);
    setBusy(false);
    if (!r.ok) {
      setErr(data?.message ?? "종결 실패");
      return;
    }
    onResolved();
  };

  const closesDate = formatLocalDate(closesAt);
  // 만료 +14일 자동 삭제까지 잔여일 (음수면 곧 삭제 대상)
  const autoDeleteAt = new Date(closesAt).getTime() + 14 * 86_400_000;
  const daysUntilAutoDelete = Math.max(
    0,
    Math.ceil((autoDeleteAt - Date.now()) / 86_400_000)
  );

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onDismiss}
    >
      <div
        className="bg-card rounded-2xl shadow-2xl max-w-lg w-full p-6 relative"
        onClick={(e) => e.stopPropagation()}
      >
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="닫기"
            title="닫기 (공고는 만료 상태로 유지됩니다)"
            className="absolute top-3 right-3 p-1.5 rounded-md text-ink-muted hover:text-ink hover:bg-surface-alt transition-colors"
          >
            <X className="w-4 h-4" strokeWidth={2.25} />
          </button>
        )}
        <div className="flex items-start gap-3 mb-4 pr-6">
          <div className="w-10 h-10 rounded-full bg-warning-soft flex items-center justify-center shrink-0">
            <Calendar className="w-5 h-5 text-warning" strokeWidth={2.25} />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-bold text-ink">
              공고 종결 예정일이 지났습니다
            </h2>
            <p className="text-xs text-ink-soft mt-1 leading-relaxed">
              종결 예정일: <span className="font-medium">{closesDate}</span> ·
              지원자의 진행은 계속되지만 새 후보자 등록·면접 발송 등 HR 추가
              작업은 잠시 중단된 상태입니다.
            </p>
            <p className="text-xs text-danger mt-2 font-medium">
              ⚠ 결정하지 않으면 {daysUntilAutoDelete}일 후 공고가 자동
              삭제됩니다 (후보자 데이터 포함).
            </p>
          </div>
        </div>

        {confirmClose ? (
          <ConfirmCloseBody
            check={check}
            err={err}
            busy={busy}
            sendNotification={sendNotification}
            onToggleNotification={setSendNotification}
            onCancel={() => {
              setConfirmClose(false);
              setErr("");
            }}
            onConfirm={doClose}
          />
        ) : (
          <ChoiceBody
            check={check}
            extInfo={extInfo}
            err={err}
            busy={busy}
            onExtend={doExtend}
            onWantClose={() => setConfirmClose(true)}
          />
        )}
      </div>
    </div>
  );
}

function ChoiceBody({
  check,
  extInfo,
  err,
  busy,
  onExtend,
  onWantClose,
}: {
  check: CloseCheck | null;
  extInfo: ExtendInfo | null;
  err: string;
  busy: boolean;
  onExtend: () => void;
  onWantClose: () => void;
}) {
  const closeBlocked = check ? !check.ok : false;
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
        {/* 연장 옵션 */}
        <button
          type="button"
          onClick={onExtend}
          disabled={busy}
          className="text-left rounded-xl border-2 border-primary/30 bg-primary-soft/40 hover:bg-primary-soft hover:border-primary/50 p-4 transition-colors disabled:opacity-50"
        >
          <div className="text-sm font-bold text-primary-deep mb-1">
            공고 연장 (30일)
          </div>
          <div className="text-[11px] text-ink-soft leading-relaxed">
            {extInfo ? (
              <>
                보관 중 이력서 <strong>{extInfo.candidateCount}명</strong> ×{" "}
                {extInfo.perResume} 토큰
                <br />→ <strong className="text-primary-deep">
                  {extInfo.totalCost} 토큰
                </strong>{" "}
                차감
                {extInfo.totalCandidateCount > extInfo.candidateCount && (
                  <>
                    <br />
                    <span className="text-ink-muted">
                      (불합격·지원취소{" "}
                      {extInfo.totalCandidateCount - extInfo.candidateCount}명
                      제외)
                    </span>
                  </>
                )}
              </>
            ) : (
              "정보 불러오는 중..."
            )}
          </div>
        </button>

        {/* 종결 옵션 */}
        <button
          type="button"
          onClick={onWantClose}
          disabled={busy}
          className="text-left rounded-xl border-2 border-border-strong bg-card hover:bg-surface-alt p-4 transition-colors disabled:opacity-50"
        >
          <div className="text-sm font-bold text-ink mb-1">공고 종결</div>
          <div className="text-[11px] text-ink-soft leading-relaxed">
            {check == null ? (
              "정보 불러오는 중..."
            ) : closeBlocked ? (
              <span className="text-warning">
                ⚠ 응답 대기 중인 후보 {check.blockers.length}명 — 종결 불가
              </span>
            ) : check.pendingDecisionCount > 0 ? (
              <>
                진행 중 후보 <strong>{check.pendingDecisionCount}명</strong>{" "}
                일괄 불합격 처리됩니다
              </>
            ) : (
              "바로 종결 가능합니다"
            )}
          </div>
        </button>
      </div>

      {err && (
        <div className="mt-3 text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2">
          {err}
        </div>
      )}

      <p className="text-[11px] text-ink-muted mt-4">
        ※ 결정 전까지는 새 이력서 등록·면접 링크 발송 등 HR 작업이 차단됩니다.
        지원자의 면접 응시는 정상 진행됩니다.
      </p>
    </>
  );
}

function ConfirmCloseBody({
  check,
  err,
  busy,
  sendNotification,
  onToggleNotification,
  onCancel,
  onConfirm,
}: {
  check: CloseCheck | null;
  err: string;
  busy: boolean;
  sendNotification: boolean;
  onToggleNotification: (v: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!check) {
    return (
      <div className="text-xs text-ink-soft py-6 text-center">
        불러오는 중...
      </div>
    );
  }

  // 종결 차단됨 — 안내만 표시
  if (!check.ok) {
    return (
      <>
        <div className="rounded-xl border border-warning/30 bg-warning-soft/40 p-4">
          <div className="text-sm font-semibold text-warning mb-2">
            🚫 아직 종결할 수 없습니다
          </div>
          <p className="text-xs text-ink-soft mb-3 leading-relaxed">
            아래 후보자가 응답 대기 중이며 링크가 아직 유효합니다. 링크 만료 후
            다시 시도해 주세요.
          </p>
          <ul className="space-y-1.5 max-h-40 overflow-y-auto">
            {check.blockers.map((b, i) => (
              <li
                key={`${b.candidateId}-${b.reason}-${i}`}
                className="flex items-center gap-2 text-xs bg-card border border-border-default rounded-lg px-3 py-2"
              >
                <span className="font-medium text-ink">{b.candidateName}</span>
                <span className="text-ink-soft">·</span>
                <span className="text-ink-soft">{REASON_LABEL[b.reason]}</span>
                <span className="ml-auto text-[10px] text-ink-muted">
                  만료 {formatLocalDate(b.expiresAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex justify-end mt-4">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg border border-border-strong text-ink-soft hover:bg-surface-alt text-sm transition-colors"
          >
            돌아가기
          </button>
        </div>
      </>
    );
  }

  // 종결 가능 — 일괄 불합격 처리 안내 + 최종 확인
  return (
    <>
      <div className="rounded-xl border border-danger/30 bg-danger-soft/40 p-4">
        <div className="text-sm font-semibold text-danger mb-2">
          공고를 종결합니다
        </div>
        <ul className="text-xs text-ink-soft space-y-1 list-disc list-inside leading-relaxed">
          <li>
            진행 중인 후보자{" "}
            <strong className="text-ink">
              {check.pendingDecisionCount}명
            </strong>
            을 일괄 <strong className="text-danger">불합격</strong> 처리합니다.
          </li>
          <li>종결 +7일 후 불합격자 이력서 PDF 가 자동 폐기됩니다.</li>
          <li>종결 +14일 후 불합격자 PII 가 자동 폐기됩니다.</li>
          <li>
            <strong className="text-primary-deep">합격자</strong>의 이력서·평가
            데이터는 자동 폐기 대상에서 제외되어 보존됩니다.
          </li>
          <li>이 작업은 되돌릴 수 없습니다.</li>
        </ul>
      </div>

      {/* 결과 통보 메일 발송 옵션 */}
      <label
        htmlFor="close-send-notif"
        className="mt-3 flex items-start gap-3 rounded-xl border border-border-default bg-card hover:bg-surface-alt px-4 py-3 cursor-pointer transition-colors"
      >
        <input
          id="close-send-notif"
          type="checkbox"
          checked={sendNotification}
          onChange={(e) => onToggleNotification(e.target.checked)}
          className="mt-0.5 rounded border-border-strong"
        />
        <span className="flex-1">
          <span className="text-sm font-medium text-ink block">
            불합격 결과 통보 메일 자동 발송
          </span>
          <span className="text-[11px] text-ink-soft mt-0.5 block leading-relaxed">
            체크 해제하면 메일은 보내지 않고 종결만 진행됩니다.
            <br />
            (후보자 상세에서 개별 발송도 가능합니다)
          </span>
        </span>
      </label>

      {err && (
        <div className="mt-3 text-xs text-danger bg-danger-soft border border-danger/30 rounded-lg px-3 py-2">
          {err}
        </div>
      )}
      <div className="flex justify-end gap-2 mt-4">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="px-4 py-2 rounded-lg border border-border-strong text-ink-soft hover:bg-surface-alt text-sm transition-colors disabled:opacity-50"
        >
          취소
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-danger hover:bg-danger/85 text-surface text-sm font-medium transition-colors disabled:opacity-50"
        >
          <X className="w-3.5 h-3.5" strokeWidth={2.25} />
          {busy ? "종결 중..." : "공고 종결"}
        </button>
      </div>
    </>
  );
}
