# 카카오 알림톡 병행 발송 (알리고)

지원자 **핵심 5종** 알림을 이메일과 **병행**해 카카오 알림톡으로도 발송한다.
구현: [lib/alimtalk.ts](../lib/alimtalk.ts) + 각 발송 지점. SMTP처럼 **게이트 방식** —
env 미설정이면 조용히 skip(이메일만 발송), 전화번호 없으면 skip, 절대 throw 안 함.

## 병행 대상 5종 (사용자 확정)

| type | 알림 | 발송 지점 | 링크 버튼 |
|---|---|---|---|
| `interview_invite` | AI 면접 초대 | `interview-sessions/send-email`, `jobs/interview-links` | ✅ 면접 시작 |
| `interview_reminder` | AI 면접 미응답(24h/48h) | `lib/interview-reminders.ts` | ✅ 면접 진행 |
| `schedule_propose` | 대면 면접 일정 제안 | `jobs/schedule-propose` | ✅ 일정 선택 |
| `interview_day_reminder` | 대면 면접 D-1 | `lib/interview-reminders.ts` | — |
| `decision_pass` | **합격** 통보(불합격 제외) | `candidates/stage`, `candidates/decision-mail` | — |

불합격·이의제기 결과는 정중한 긴 문구/법정 통지라 **이메일만** 유지.

## 활성화 절차 (사용자 작업)

알림톡은 코드만으로 발송되지 않는다. 아래를 완료해야 켜진다.

1. **알리고 가입** ([smartsms.aligo.in](https://smartsms.aligo.in)) → API Key 발급
   - `ALIGO_API_KEY`, `ALIGO_USER_ID`
2. **카카오 비즈니스 채널 개설 + 발신프로필 등록** (사업자등록 필요 — 보유)
   - `ALIGO_SENDER_KEY` (발신프로필키 senderkey)
   - `ALIGO_SENDER` (발신번호, 예: `0212345678`)
3. **템플릿 5종 사전 승인** (카카오 심사 ~1영업일) → 각 코드를 env 에 등록
   - `ALIGO_TPL_INTERVIEW_INVITE` / `ALIGO_TPL_INTERVIEW_REMINDER` /
     `ALIGO_TPL_SCHEDULE_PROPOSE` / `ALIGO_TPL_INTERVIEW_DAY` / `ALIGO_TPL_DECISION_PASS`
   - 승인 템플릿 본문은 `lib/alimtalk.ts` `buildMessage()` 텍스트와 **글자까지 일치**해야 한다(카카오 패턴 매칭). 승인본을 수정하면 코드도 동일하게 맞출 것.
4. (선택) `ALIGO_TEST_MODE=1` — 실제 발송 없이 테스트(과금 X).

> Vercel 환경변수에 위를 등록하면 다음 발송부터 자동으로 알림톡이 병행된다.
> 일부만 채워도 안전: 채워진 종류만 발송, 나머지는 이메일만.

## 로컬 발송 스위치 (`ALIMTALK_LOCAL_ENABLED`)

로컬 dev(`NODE_ENV != production`)에서는 위 env 가 다 채워져 있어도 **기본적으로 알림톡을 보내지 않는다**(skip, reason=`local_disabled`).
이메일과 달리 알림톡은 카카오 과금이 붙고, 매 트리거마다 본인 폰으로 카톡이 쌓이기 때문 — "필요할 때만" 보내려는 것.

- **켜기**: `.env.local` 에 `ALIMTALK_LOCAL_ENABLED=1` (주석 해제) 후 **dev 재시작**.
- 켜져 있어도 수신번호는 항상 `01074962696`(`LOCAL_DEV_MOBILE`)으로 리다이렉트 — 실제 지원자에게 안 나간다.
- **운영(production)은 이 스위치와 무관하게 항상 발송** — Vercel 에는 이 변수를 두지 않아도 된다.
- `scripts/test-alimtalk.ts` 는 "지금 발송"하는 명시적 도구라 스스로 이 플래그를 켜므로, `.env.local` 설정과 무관하게 항상 동작한다.

## 템플릿 승인 신청 본문 (변수는 `#{}` 로 등록)

승인 신청 시 아래를 사용. 변수 자리에 실제 값이 채워져 발송된다.

**1) AI 면접 초대 (interview_invite)** — 버튼: 웹링크 "면접 시작하기" → `#{링크}`
```
[#{회사명}] AI 면접 안내

#{이름}님, #{공고} 포지션 AI 면접을 안내드립니다.
아래 버튼으로 면접을 진행해 주세요. (약 10~30분, 채팅 방식)

링크 만료: #{만료}

※ 본 면접은 비밀번호·결제·금융정보를 절대 요구하지 않습니다.
```

**2) AI 면접 미응답 (interview_reminder)** — 버튼: 웹링크 "면접 진행하기" → `#{링크}`
> ⚠️ 구 본문("AI 면접 미완료 안내" + "이어서 진행해 주세요")은 카카오 검수에서 **광고·공지성(요청 없는 리마인드)으로 반려**(2026-06-30, UJ_0795). 아래는 "링크 유효기간 안내"로 프레이밍을 바꾼 재심사용 본문.
```
[#{회사명}] AI 면접 링크 유효기간 안내

#{이름}님, 지원하신 #{공고} 포지션 AI 면접 링크의 유효기간을 안내드립니다.
면접을 아직 완료하지 않으신 경우, 만료 전 아래 버튼에서 진행하실 수 있습니다.

링크 만료: #{만료}
```

**3) 대면 일정 제안 (schedule_propose)** — 버튼: 웹링크 "면접 일정 선택하기" → `#{링크}`
```
[#{회사명}] 면접 일정 선택 안내

#{이름}님, #{공고} 면접 일정을 선택해 주세요.
아래 버튼에서 가능한 시간을 골라 회신해 주시면 일정이 확정됩니다.
```

**4) 대면 D-1 (interview_day_reminder)** — 버튼 없음
```
[#{회사명}] 내일 면접 안내

#{이름}님, #{공고} 면접이 내일 예정되어 있습니다.

일시: #{일시}

부득이하게 참석이 어려우시면 채용 담당자에게 미리 연락 부탁드립니다.
```

**5) 합격 통보 (decision_pass)** — 버튼 없음
```
[#{회사명}] 합격 안내

#{이름}님, 축하드립니다. #{공고} 전형에 합격하셨습니다.
자세한 다음 절차는 채용 담당자가 별도로 안내드릴 예정입니다.
```

## 비용 (참고)

알림톡 약 6.5~8원/건. 지원자 전화번호는 이력서에서 자동 추출(`lib/pii-extract.ts`) — 없으면 이메일만.
알림톡 실패 시 `failover=Y` 로 SMS 대체발송(추가 단가). 비용은 면접 토큰 단가에 흡수 가능.
