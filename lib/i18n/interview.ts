/**
 * 지원자 면접 경로 전용 경량 i18n 사전 (ko / en).
 *
 * next-intl 등 라이브러리 미도입 — 다국어가 필요한 곳은 "지원자 면접 경로" 하나뿐이고
 * 언어도 2개라 자체 사전으로 충분하다. 관리자 UI·이메일(한/영 병기)·동의 항목 '본문'에는
 * 이 사전을 쓰지 않는다. (동의 항목 title/summary/description 은 lib/consent.ts getConsentItems.)
 *
 * 규칙: en 키가 없으면 ko 로 폴백한다 → 영어 화면에 한국어가 비치면 en 키 누락 신호이므로
 *       ko / en 키 집합을 항상 동일하게 유지할 것. 보간은 {name} {minutes} 형식.
 */
export type Lang = "ko" | "en";

/** 임의 입력값을 안전한 Lang 으로 정규화 (알 수 없으면 기본 ko). */
export function normalizeLang(v: unknown): Lang {
  return v === "en" ? "en" : "ko";
}

type Dict = Record<string, string>;

// 키 그룹: gate.*(상태 카드) · step.*(단계 라벨)
//          · personality.* · mcq.* · interview.*(헤더·입력·타이머·종료카드) · consent.*(동의 UI 칩)
//          · common.*(공용 버튼·문구)
const ko: Dict = {
  // ── 공용 ─────────────────────────────────────────────
  "common.start": "시작하기",
  "common.submitting": "응답 제출 중...",
  "common.submittingHint": "잠시 후 면접이 시작됩니다.",
  "common.prev": "← 이전",
  "common.prevQuestion": "← 이전 문항",
  "common.resubmit": "다시 제출",
  "common.required": "필수",
  "common.optional": "선택",

  // ── 상태 카드 (gate) ─────────────────────────────────
  "gate.error.title": "접속 불가",
  "gate.loading": "불러오는 중...",
  "gate.withdrawn.title": "지원이 취소되었습니다",
  "gate.withdrawn.body":
    "이 지원은 지원자 요청으로 취소되어 면접을 진행할 수 없습니다.",
  "gate.withdrawn.thanks": "관심 가져주셔서 감사합니다.",
  "gate.terminated.title": "종료된 전형입니다",
  "gate.terminated.body": "이 전형은 이미 종결되어 면접을 진행할 수 없습니다.",
  "gate.superseded.title": "다음 전형으로 진행되었습니다",
  "gate.superseded.body":
    "이 AI 면접은 더 이상 진행하지 않습니다. 다음 절차는 채용 담당자가 별도로 안내해 드립니다.",
  "gate.expired.title": "만료된 링크입니다",
  "gate.expired.body": "담당자에게 새 링크를 요청하세요.",

  // ── 단계 라벨 (step) ─────────────────────────────────
  "step.personality": "인성검사",
  "step.mcq": "직무 역량",
  "step.interview": "면접",
  "step.progressAria": "면접 진행 단계",

  // ── 면접 본 화면 (interview) ─────────────────────────
  "interview.approxMinutes": "약 {minutes}분",
  "interview.end": "면접 종료",
  "interview.chatLogAria": "면접 대화",
  "interview.generating": "응답 생성 중",
  "interview.listening": "듣는 중",
  "interview.settingsHow": "설정 방법",
  "interview.inputPlaceholderListening":
    "말씀하세요 — 인식된 내용이 여기에 채워집니다",
  "interview.inputPlaceholder": "답변을 입력하거나 마이크 버튼을 누르세요",
  "interview.answerAria": "답변 입력",
  "interview.voiceStart": "음성 입력 시작",
  "interview.voiceStop": "음성 입력 정지",
  "interview.voiceStartTitle": "음성으로 답변하기",
  "interview.voiceStopTitle": "정지",
  "interview.send": "전송",
  "interview.enterHint": "Enter = 전송, Shift+Enter = 줄바꿈",
  "interview.micHint": " · 🎙 마이크로 음성 입력 가능 (Chrome·Edge·Safari)",
  "interview.micTrouble": "마이크가 안 되나요?",
  "interview.report": "문제가 있나요? 신고 / 문의",
  // 채용 담당자 문의처 (공고 recruitingContactEmail) — 지원자 메일 하단 안내와 동일
  "interview.contactRecruiter":
    "면접 진행에 대한 문의는 채용 담당자에게 연락해 주세요.",
  "interview.confirmEnd": "면접을 종료하시겠습니까?",
  "interview.tooShort": "대화가 너무 짧습니다. 답변을 더 진행해 주세요.",
  // 종료 카드
  "interview.ended.title": "면접이 종료되었습니다",
  "interview.ended.thanks": "소중한 시간 내어 면접에 응해 주셔서 감사합니다.",
  "interview.ended.resultNote":
    "평가 결과는 채용 담당자에게만 전달되며, 별도로 안내드릴 예정입니다.",
  "interview.ended.closeWindow": "이 창은 안전하게 닫으셔도 됩니다.",
  "interview.ended.myInfo": "내 정보 열람·삭제 (PIPA §35·36)",
  "interview.ended.appeal": "자동화 의사결정 이의제기 (PIPA §37의2)",
  // 채팅 버블 / 타이머 aria
  "interview.bubble.mine": "내 답변",
  "interview.bubble.interviewer": "면접관 질문",
  "interview.timer.total": "전체",
  "interview.timer.thisQuestion": "이번 질문",
  "interview.timer.elapsedAria": "면접 경과 {time}",
  // 공통 맥락 라벨 (게이트 헤더)
  "interview.aiInterview": "AI 면접",

  // ── 인성검사 (personality) ───────────────────────────
  "personality.start.title": "면접 전 사전 문항",
  // 도입 문단 — {jobTitle} 와 일부 어구를 굵게 표시하는 JSX 조각으로 구성(원문 강조 보존).
  "personality.start.intro1": " AI 면접을 시작하기 전, ",
  "personality.start.intro2": "개의 간단한 문항", // 앞에 {total} 굵게 + 뒤 intro3
  "personality.start.intro3": "에 답해 주세요. 각 문항에서 ",
  "personality.start.intro4": "두 문장 중 나에게 더 가까운 쪽",
  "personality.start.intro5": "을 고르면 됩니다. 약 2~3분 소요됩니다.",
  "personality.start.bullet1":
    "· 정답은 없습니다 — 두 문장 모두 좋은 모습이며, 평소의 나에 더 가까운 쪽을 고르면 됩니다.",
  // bullet2 는 JSX 에서 "· " + <strong>{2a}</strong> + " " + {2b} 로 조립(원문 강조 보존).
  "personality.start.bullet2a":
    "응답하신 내용은 이어지는 면접에서 실제 경험 사례로 확인됩니다.",
  "personality.start.bullet2b": "솔직한 응답이 가장 유리합니다.",
  "personality.start.bullet3":
    "· 응답은 면접 참고 자료로만 활용되며 합격·불합격을 결정하지 않습니다.",
  "personality.start.bullet4": "· 모든 문항에 응답하면 면접이 자동으로 시작됩니다.",
  "personality.sectionLabel": "사전 문항",
  "personality.progressAria": "{total}문항 중 {idx}번째",
  // 선택 안내 — JSX 에서 {promptA} + <strong>{promptB}</strong> + {promptC} 로 조립(원문 강조 보존).
  "personality.choicePromptA": "둘 중 ",
  "personality.choicePromptB": "나에게 더 가까운 쪽",
  "personality.choicePromptC": "을 골라 주세요",
  "personality.choiceAria": "응답 선택",
  "personality.footerHint": "둘 다 좋은 모습입니다 — 더 가까운 쪽이면 됩니다",

  // ── 객관식 직무 역량 (mcq) ───────────────────────────
  "mcq.start.title": "면접 전 직무 역량 평가",
  // 도입 문단 — JSX 조각 구성(원문 강조 보존). {total} 굵게 끼움.
  "mcq.start.intro1": " AI 면접을 시작하기 전, ",
  "mcq.start.intro2": "개의 4지선다 문제", // 앞에 {total} 굵게
  "mcq.start.intro3": "를 풀어 주세요. 직무 기본기를 확인하는 문제이며, 각 문항에서 ",
  "mcq.start.intro4": "보기 4개 중 하나",
  "mcq.start.intro5": "를 고르면 자동으로 다음 문제로 넘어갑니다.",
  "mcq.start.bullet1": "· 부담 없이 풀어 주세요 — 직무의 기본기를 확인하는 수준입니다.",
  "mcq.start.bullet2":
    "· 점수는 면접 참고 자료로만 활용되며 합격·불합격을 결정하지 않습니다.",
  "mcq.start.bullet3": "· 모든 문항에 응답하면 면접이 자동으로 시작됩니다.",
  "mcq.sectionLabel": "직무 역량",
  "mcq.progressAria": "{total}문항 중 {idx}번째",
  "mcq.optionsAria": "보기 선택",
  "mcq.footerLast": "선택하면 면접이 시작됩니다",
  "mcq.footerNext": "선택하면 다음 문제로 넘어갑니다",
  "mcq.preparing.title": "문항 준비 중",
  "mcq.preparing.hint": "잠시만 기다려 주세요. 곧 시작됩니다.",

  // ── 동의 화면 (consent) ──────────────────────────────
  "consent.candidateHonorific": "안녕하세요, {name} 님",
  "consent.title": "{job} AI 면접 — 개인정보 처리 동의",
  "consent.flowTitle": "동의를 완료하면 아래 순서로 진행됩니다",
  "consent.flowSteps": " · 총 {n}단계",
  "consent.expand": "자세히 보기",
  "consent.collapse": "접기",
  "consent.noticeSection": "안내 사항 (확인)",
  "consent.noticeBadge": "고지",
  "consent.identityLabel": "본인 확인 — 지원 시 등록한 이메일",
  "consent.identityHint":
    "면접 링크 유출 방지를 위해 지원 시 등록한 이메일과 일치해야 면접이 시작됩니다.",
  "consent.legalIntro1":
    "동의하지 않거나 지원을 취소하면 면접 절차에 참여할 수 없습니다. 자동화 의사결정 결과에 대해서는 본인 식별 후 설명 요청 및 이의제기 권리가 있습니다 (PIPA §37의2). 자세한 사항은 채용 담당자 또는 ",
  "consent.privacyPolicy": "개인정보 처리방침",
  "consent.legalIntro2": "을 확인하세요.",
  "consent.busy": "처리 중...",
  "consent.needRequired": "필수 항목에 동의해 주세요",
  "consent.needEmail": "본인 확인 이메일을 입력해 주세요",
  "consent.submit": "동의하고 면접 시작",
  "consent.withdraw": "지원취소",
  "consent.withdrawConfirm":
    "지원을 취소하시면 면접에 참여할 수 없으며, 제출하신 이력서 정보는 즉시 폐기됩니다. 계속하시겠습니까?",
  "consent.withdrawn.title": "지원 취소 완료",
  "consent.withdrawn.body":
    "지원이 취소되었으며, 제출하신 이력서 정보는 폐기되었습니다.",
  "consent.withdrawn.thanks": "관심 가져주셔서 감사합니다.",
  "consent.governingNotice": "",
};

const en: Dict = {
  // ── 공용 ─────────────────────────────────────────────
  "common.start": "Get started",
  "common.submitting": "Submitting your responses...",
  "common.submittingHint": "The interview will begin shortly.",
  "common.prev": "← Previous",
  "common.prevQuestion": "← Previous question",
  "common.resubmit": "Resubmit",
  "common.required": "Required",
  "common.optional": "Optional",

  // ── 상태 카드 (gate) ─────────────────────────────────
  "gate.error.title": "Cannot connect",
  "gate.loading": "Loading...",
  "gate.withdrawn.title": "Your application has been withdrawn",
  "gate.withdrawn.body":
    "This application was withdrawn at the applicant's request, so the interview cannot proceed.",
  "gate.withdrawn.thanks": "Thank you for your interest.",
  "gate.terminated.title": "This process has ended",
  "gate.terminated.body":
    "This hiring process has already concluded, so the interview cannot proceed.",
  "gate.superseded.title": "You have advanced to the next stage",
  "gate.superseded.body":
    "This AI interview is no longer active. The recruiter will contact you separately about the next steps.",
  "gate.expired.title": "This link has expired",
  "gate.expired.body": "Please ask the recruiter for a new link.",

  // ── 단계 라벨 (step) ─────────────────────────────────
  "step.personality": "Personality assessment",
  "step.mcq": "Job competency",
  "step.interview": "Interview",
  "step.progressAria": "Interview steps",

  // ── 면접 본 화면 (interview) ─────────────────────────
  "interview.approxMinutes": "approx. {minutes} min",
  "interview.end": "End interview",
  "interview.chatLogAria": "Interview conversation",
  "interview.generating": "Generating response",
  "interview.listening": "Listening",
  "interview.settingsHow": "How to enable",
  "interview.inputPlaceholderListening":
    "Speak now — what we hear will appear here",
  "interview.inputPlaceholder": "Type your answer or tap the microphone button",
  "interview.answerAria": "Answer input",
  "interview.voiceStart": "Start voice input",
  "interview.voiceStop": "Stop voice input",
  "interview.voiceStartTitle": "Answer by voice",
  "interview.voiceStopTitle": "Stop",
  "interview.send": "Send",
  "interview.enterHint": "Enter = send, Shift+Enter = new line",
  "interview.micHint": " · 🎙 Voice input available (Chrome·Edge·Safari)",
  "interview.micTrouble": "Microphone not working?",
  "interview.report": "Having trouble? Report / Contact",
  "interview.contactRecruiter":
    "For any questions about the interview process, please contact the recruiter.",
  "interview.confirmEnd": "Are you sure you want to end the interview?",
  "interview.tooShort":
    "The conversation is too short. Please answer a few more questions.",
  // 종료 카드
  "interview.ended.title": "The interview has ended",
  "interview.ended.thanks": "Thank you for taking the time to interview with us.",
  "interview.ended.resultNote":
    "The evaluation results are shared only with the recruiter, who will contact you separately.",
  "interview.ended.closeWindow": "You may safely close this window.",
  "interview.ended.myInfo": "View / delete my data (PIPA §35·36)",
  "interview.ended.appeal":
    "Object to an automated decision (PIPA §37-2)",
  // 채팅 버블 / 타이머 aria
  "interview.bubble.mine": "My answer",
  "interview.bubble.interviewer": "Interviewer's question",
  "interview.timer.total": "Total",
  "interview.timer.thisQuestion": "This question",
  "interview.timer.elapsedAria": "Interview elapsed {time}",
  // 공통 맥락 라벨 (게이트 헤더)
  "interview.aiInterview": "AI interview",

  // ── 인성검사 (personality) ───────────────────────────
  "personality.start.title": "Pre-interview questionnaire",
  "personality.start.intro1": " AI interview — before it begins, please answer ",
  "personality.start.intro2": " short questions",
  "personality.start.intro3": ". For each one, choose ",
  "personality.start.intro4": "the statement that better describes you",
  "personality.start.intro5": ". It takes about 2-3 minutes.",
  "personality.start.bullet1":
    "· There are no right answers — both statements reflect good qualities; simply choose the one closer to your usual self.",
  "personality.start.bullet2a":
    "Your responses will be explored through real examples in the interview that follows.",
  "personality.start.bullet2b": "Honest answers work best in your favor.",
  "personality.start.bullet3":
    "· Responses are used only as reference for the interview and do not determine the outcome.",
  "personality.start.bullet4":
    "· The interview starts automatically once you answer every question.",
  "personality.sectionLabel": "Questionnaire",
  "personality.progressAria": "Question {idx} of {total}",
  "personality.choicePromptA": "Choose the statement that is ",
  "personality.choicePromptB": "closer to you",
  "personality.choicePromptC": "",
  "personality.choiceAria": "Choose a response",
  "personality.footerHint":
    "Both reflect good qualities — just pick the closer one",

  // ── 객관식 직무 역량 (mcq) ───────────────────────────
  "mcq.start.title": "Pre-interview job competency check",
  "mcq.start.intro1": " AI interview — before it begins, please solve ",
  "mcq.start.intro2": " multiple-choice questions",
  "mcq.start.intro3":
    ". They check core job fundamentals; for each one, choosing ",
  "mcq.start.intro4": "one of the four options",
  "mcq.start.intro5": " moves you to the next question automatically.",
  "mcq.start.bullet1":
    "· No pressure — these check the basics of the role.",
  "mcq.start.bullet2":
    "· Scores are used only as reference for the interview and do not determine the outcome.",
  "mcq.start.bullet3":
    "· The interview starts automatically once you answer every question.",
  "mcq.sectionLabel": "Job competency",
  "mcq.progressAria": "Question {idx} of {total}",
  "mcq.optionsAria": "Choose an option",
  "mcq.footerLast": "Selecting an answer starts the interview",
  "mcq.footerNext": "Selecting an answer moves to the next question",
  "mcq.preparing.title": "Preparing questions",
  "mcq.preparing.hint": "Just a moment — this will start shortly.",

  // ── 동의 화면 (consent) ──────────────────────────────
  "consent.candidateHonorific": "Hello, {name}",
  "consent.title": "{job} AI interview — Consent to personal data processing",
  "consent.flowTitle": "Once you consent, the process proceeds in this order",
  "consent.flowSteps": " · {n} steps in total",
  "consent.expand": "View details",
  "consent.collapse": "Collapse",
  "consent.noticeSection": "Notices (please review)",
  "consent.noticeBadge": "Notice",
  "consent.identityLabel": "Identity check — the email you applied with",
  "consent.identityHint":
    "To prevent misuse of the interview link, the interview starts only when this matches the email you applied with.",
  "consent.legalIntro1":
    "If you do not consent or you withdraw your application, you cannot take part in the interview. Regarding automated decisions, you have the right — after identity verification — to request an explanation and to raise an objection (PIPA §37-2). For details, contact the recruiter or see the ",
  "consent.privacyPolicy": "Privacy Policy",
  "consent.legalIntro2": ".",
  "consent.busy": "Processing...",
  "consent.needRequired": "Please agree to the required items",
  "consent.needEmail": "Please enter your verification email",
  "consent.submit": "Agree and start interview",
  "consent.withdraw": "Withdraw",
  "consent.withdrawConfirm":
    "If you withdraw, you cannot take part in the interview and the resume information you submitted will be deleted immediately. Do you want to continue?",
  "consent.withdrawn.title": "Application withdrawn",
  "consent.withdrawn.body":
    "Your application has been withdrawn and the resume information you submitted has been deleted.",
  "consent.withdrawn.thanks": "Thank you for your interest.",
  "consent.governingNotice":
    "This English version is provided for your convenience; the Korean version is legally binding.",
};

const DICT: Record<Lang, Dict> = { ko, en };

/** 사전 조회 + {var} 보간. en 누락 키는 ko 로 폴백, 그래도 없으면 key 자체 반환. */
export function t(
  lang: Lang,
  key: string,
  vars?: Record<string, string | number>
): string {
  const raw = DICT[lang]?.[key] ?? DICT.ko[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k) =>
    vars[k] === undefined || vars[k] === null ? `{${k}}` : String(vars[k])
  );
}
