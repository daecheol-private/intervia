/**
 * 전체 발송 메일 미리보기 — 로컬 전용.
 *
 * 모든 메일 빌더를 대표 케이스로 렌더해 admin.intervia@gmail.com 으로 실제 발송한다
 * (로컬 리다이렉트 정책). 지원자 메일에는 채용 담당자 연락처(contactEmail) 안내 박스가,
 * 모든 메일에는 우측 정렬 하단 로고가 적용된 상태를 눈으로 확인하는 용도.
 *
 * 사용 (PowerShell):
 *   $env:LOCAL_DB="1"; npx tsx scripts/preview-all-mails.ts
 */
import "./_load-env.mjs";

async function main() {
  if (process.env.LOCAL_DB !== "1") {
    console.error('로컬 전용 스크립트입니다 — $env:LOCAL_DB="1" 로 실행하세요.');
    process.exit(1);
  }
  const { db } = await import("../lib/db");
  const { organizations } = await import("../lib/schema");
  const { sendMail } = await import("../lib/mailer");
  const {
    buildScheduleProposalEmail,
    buildScheduleConfirmedEmail,
    buildMeetingLinkEmail,
    buildMeetingLinkRequestEmail,
  } = await import("../lib/schedules");
  const { buildInterviewEmail, buildInterviewReminderEmail, buildAppealResponseEmail } =
    await import("../lib/mailer");
  const { buildDecisionEmail } = await import("../lib/candidate-stage");
  const { buildDailyDigestEmail } = await import("../lib/daily-digest");
  const { buildInterviewerAssignedEmail, buildInviteEmail } = await import(
    "../lib/invites"
  );
  const { buildVerificationEmail } = await import("../lib/email-verify");
  const { buildPasswordResetEmail } = await import("../lib/password-reset");

  const [org] = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .limit(1);
  const orgId = org?.id ?? null;
  const orgName = org?.name ?? "테스트법인";

  const jobTitle = "부설연구소 솔루션 관련 개발 신입/경력직";
  const candidateName = "소채연";
  const slot = { start: "2026-07-30T01:30:00.000Z", end: "2026-07-30T02:30:00.000Z" };
  const address = "서울 구로구 디지털로31길 38-21 이앤씨벤처드림타워3차";
  const contactEmail = "recruiter@expernet.co.kr";
  const detailUrl = "http://localhost:3003/candidates/180";
  const meetingUrl = "https://zoom.us/j/1234567890";
  const note = "회의 비밀번호: 1234";
  const url = "https://intervia.kr/interview/tk_preview";
  const expiresIso = "2026-08-05T00:00:00.000Z";
  const expiresLabel = "2026. 08. 05. (화) 23:59";
  const round = "round1" as const;
  const schedCommon = { candidateName, jobTitle, orgName, slot, round };

  type Mail = { subject: string; html: string; text: string };
  const mails: Array<{ tag: string; audience: "org" | "candidate"; mail: Mail }> = [
    // ── 지원자 메일 (담당자 안내 박스 O) ──
    {
      tag: "지원자·AI면접초대",
      audience: "candidate",
      mail: buildInterviewEmail({
        candidateName,
        jobTitle,
        url,
        expiresAt: expiresLabel,
        orgName,
        contactEmail,
      }),
    },
    {
      tag: "지원자·면접미완료넛지",
      audience: "candidate",
      mail: buildInterviewReminderEmail({
        candidateName,
        jobTitle,
        url,
        expiresAt: expiresLabel,
        orgName,
        contactEmail,
      }),
    },
    {
      tag: "지원자·일정제시",
      audience: "candidate",
      mail: buildScheduleProposalEmail({
        candidateName,
        jobTitle,
        orgName,
        url: "http://localhost:3003/schedule/sch_preview",
        expiresAt: expiresIso,
        slots: [slot, { start: "2026-07-31T02:00:00.000Z", end: "2026-07-31T03:00:00.000Z" }],
        modeOnline: false,
        address,
        round,
        contactEmail,
      }),
    },
    {
      tag: "지원자·오프라인확정",
      audience: "candidate",
      mail: buildScheduleConfirmedEmail({
        ...schedCommon,
        modeOnline: false,
        address,
        forInterviewer: false,
        contactEmail,
      }),
    },
    {
      tag: "지원자·온라인미연동확정",
      audience: "candidate",
      mail: buildScheduleConfirmedEmail({
        ...schedCommon,
        modeOnline: true,
        forInterviewer: false,
        pendingMeetingLink: true,
        contactEmail,
      }),
    },
    {
      tag: "지원자·미팅링크",
      audience: "candidate",
      mail: buildMeetingLinkEmail({
        ...schedCommon,
        meetingUrl,
        note,
        forInterviewer: false,
        contactEmail,
      }),
    },
    {
      tag: "지원자·합격",
      audience: "candidate",
      mail: buildDecisionEmail({
        candidateName,
        jobTitle,
        decision: "hired",
        companyName: orgName,
        contactEmail,
      }),
    },
    {
      tag: "지원자·불합격",
      audience: "candidate",
      mail: buildDecisionEmail({
        candidateName,
        jobTitle,
        decision: "rejected",
        companyName: orgName,
        contactEmail,
      }),
    },
    {
      tag: "지원자·이의제기결과",
      audience: "candidate",
      mail: buildAppealResponseEmail({
        candidateName,
        jobTitle,
        status: "resolved",
        response: "제출해 주신 의견을 반영해 평가를 재검토하였습니다.",
        orgName,
      }),
    },
    // ── 면접관·제안자 메일 (담당자 박스 X) ──
    {
      tag: "면접관·오프라인확정",
      audience: "org",
      mail: buildScheduleConfirmedEmail({
        ...schedCommon,
        modeOnline: false,
        address,
        forInterviewer: true,
        detailUrl,
      }),
    },
    {
      tag: "면접관·미팅링크",
      audience: "org",
      mail: buildMeetingLinkEmail({
        ...schedCommon,
        meetingUrl,
        note,
        forInterviewer: true,
      }),
    },
    {
      tag: "제안자·링크등록요청",
      audience: "org",
      mail: buildMeetingLinkRequestEmail({ ...schedCommon, detailUrl }),
    },
    {
      tag: "면접관·일일요약",
      audience: "org",
      mail: buildDailyDigestEmail({
        name: "박상준",
        dashboardUrl: "http://localhost:3003/jobs",
        todayInterviews: [
          {
            primary: "소채연 · 부설연구소 개발",
            secondary: "1차 면접 · 2026. 07. 30. (목) 10:30 ~ 11:30 · 오프라인",
          },
        ],
        tomorrowInterviews: [
          {
            primary: "한도윤 · 부설연구소 개발",
            secondary: "2차 면접 · 2026. 07. 31. (금) 14:00 ~ 15:00 · 온라인",
          },
        ],
        decisionPending: [
          { primary: "김지원 · 부설연구소 개발", secondary: "1차 결과 대기", isNew: true },
        ],
        reviewPending: [
          { primary: "이서연 · 부설연구소 개발", secondary: "신규 지원", isNew: true },
        ],
        autoClosed: [],
      }),
    },
    {
      tag: "면접관·공고배정",
      audience: "org",
      mail: buildInterviewerAssignedEmail({
        inviterName: "강대철",
        orgName,
        jobTitle,
        url: "http://localhost:3003/jobs/118",
      }),
    },
    // ── 내부·계정 메일 ──
    {
      tag: "내부·공고공유초대",
      audience: "org",
      mail: buildInviteEmail({
        inviterName: "강대철",
        orgName,
        jobTitle,
        url: "http://localhost:3003/invite/inv_preview",
        expiresAt: expiresIso,
      }),
    },
    {
      tag: "계정·이메일인증",
      audience: "org",
      mail: buildVerificationEmail({
        userName: "강대철",
        verifyUrl: "http://localhost:3003/verify/v_preview",
      }),
    },
    {
      tag: "계정·비밀번호재설정",
      audience: "org",
      mail: buildPasswordResetEmail({
        userName: "강대철",
        resetUrl: "http://localhost:3003/reset/p_preview",
      }),
    },
  ];

  for (const { tag, audience, mail } of mails) {
    await sendMail({
      to:
        audience === "candidate"
          ? "candidate-test@example.com"
          : "interviewer-test@example.com",
      subject: `[미리보기 ${tag}] ${mail.subject}`,
      html: mail.html,
      text: mail.text,
      orgId,
      audience,
    });
    console.log(`발송: ${tag}`);
  }
  console.log(`\n총 ${mails.length}종 — admin.intervia@gmail.com 수신함에서 확인하세요.`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
