/**
 * 감사 로그 액션 → 한글 라벨. 화면 표시 + 검색(라벨로도 찾히게) 공용이라 lib 에 둔다.
 *
 * 감사 화면의 검색어가 라벨과 부분일치하면 서버가 해당 action 키들을 조건에 포함한다
 * ("공고 종결" 로 검색 → action='job.close'). 라벨이 없는 액션은 원문 그대로 표시·검색.
 */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "login.success": "로그인",
  logout: "로그아웃",
  "session.revoke": "세션 만료 처리",
  "session.revoke_others": "다른 기기 로그아웃",
  "session.force_logout": "강제 로그아웃",
  "candidate.view": "후보자 조회",
  "candidate.self_view": "후보자 본인 조회",
  "candidate.download_resume": "이력서 다운로드",
  "candidate.delete": "후보자 삭제",
  "candidate.bulk_delete": "후보자 일괄 삭제",
  "candidate.self_delete": "후보자 본인 삭제",
  "candidate.admin_delete": "후보자 강제 삭제 (cross-org)",
  "candidate.stage_change": "후보자 단계 변경",
  "candidate.upload_with_consent": "이력서 업로드 (동의 확인)",
  "candidate.scan_ocr": "스캔 이력서 OCR",
  "screen.trigger": "AI 평가 시작",
  "screen.retry_now": "AI 평가 재시도",
  "screen.bulk_trigger": "AI 평가 일괄 시작",
  "interview.create": "면접 링크/녹음 생성",
  "interview.send_email": "면접 메일 발송",
  "interview.start": "AI 면접 시작 (지원자)",
  "interview.complete": "AI 면접 완료 (지원자)",
  "interview.reevaluate": "AI 면접 재평가",
  "interview_questions.generate": "면접 질문지 생성",
  "consent.submit": "동의 제출 (지원자)",
  "appeal.submit": "이의제기 접수",
  "appeal.status_change": "이의제기 상태 변경",
  "appeal.response_sent": "이의제기 답변 발송",
  "appeal.response_send_failed": "이의제기 답변 발송 실패",
  "inquiry.submit": "문의 접수",
  "inquiry.status_change": "문의 상태 변경",
  "user.role_change": "권한 변경",
  "user.status_change": "계정 상태 변경",
  "user.email_verify": "이메일 인증",
  "user.delete": "사용자 삭제",
  "user.password_reset_email": "비밀번호 리셋 메일 발송",
  "password_reset.confirm": "비밀번호 재설정 완료",
  "account.self_delete": "본인 계정 탈퇴",
  "org.smtp_update": "SMTP 설정 변경",
  "org.smtp_delete": "SMTP 설정 삭제",
  "org.update": "법인 정보 수정",
  "org.suspend": "법인 정지",
  "org.resume": "법인 재개",
  "org.delete": "법인 삭제",
  "org.admin_transfer": "법인 관리자 이전",
  "tokens.refund": "토큰 환불",
  "tokens.adjust": "토큰 수동 조정",
  "coupon.create": "쿠폰 생성",
  "coupon.redeem": "쿠폰 사용",
  "coupon.disable": "쿠폰 비활성화",
  "job.create": "공고 등록",
  "job.draft_create": "공고 임시저장",
  "job.finalize_draft": "임시저장 공고 게시",
  "job.update": "공고 수정",
  "job.close": "공고 종결",
  "job.reopen": "공고 재개",
  "job.extend": "공고 연장",
  "job.delete": "공고 삭제",
  "job.interviewer_add": "면접관 등록",
  "job.interviewer_remove": "면접관 제외",
  "schedule.select": "면접 시간 확정 (지원자)",
  "schedule.counter": "면접 시간 역제안 (지원자)",
  "schedule.withdraw": "지원 취소 (지원자)",
  "schedule.hr_confirm": "면접 일정 확정 (HR)",
  "schedule.manual_confirm": "면접 일정 수동 등록",
  "shared_report.create": "평가 공유 링크 발급",
  "shared_report.view": "평가 공유 링크 열람",
  "shared_report.revoke": "평가 공유 링크 폐기",
};

/** 검색어와 부분일치하는 라벨의 action 키 목록 — 한글 라벨 검색용. */
export function actionsMatchingLabel(q: string): string[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  return Object.entries(AUDIT_ACTION_LABELS)
    .filter(([, label]) => label.toLowerCase().includes(needle))
    .map(([key]) => key);
}
