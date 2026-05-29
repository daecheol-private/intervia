/**
 * 인앱 알림 헬퍼.
 *
 * 한 알림 = 한 사용자에 대한 한 이벤트 통지.
 * 같은 이벤트로 여러 명에게 알릴 경우 각각 insert (fanout).
 *
 * 알림 생성은 idempotent 하지 않음 — 호출 측에서 중복 호출 방지 필요.
 * 트리거 측 패턴: 비즈니스 이벤트 직후 1회만 호출.
 */
import { db } from "./db";
import { notifications, users, jobInterviewers, jobPostings } from "./schema";
import { and, desc, eq, isNull, isNotNull, inArray, sql } from "drizzle-orm";
import { sendMail, isSmtpAvailable, wrapEmailCard } from "./mailer";

export type NotificationType =
  | "ai_interview_done"
  | "round1_decision"
  | "join_request"
  | "low_balance"
  | "new_org"
  | "candidate_appeal"
  | "schedule_confirmed"
  | "schedule_counter_proposed"
  | "schedule_withdrawn";

export type CreateNotificationInput = {
  userId: number;
  type: NotificationType;
  title: string;
  href: string;
  payload?: Record<string, unknown>;
};

/** 단일 사용자 알림 생성. payload 는 JSON 직렬화. */
export async function createNotification(input: CreateNotificationInput): Promise<void> {
  await db.insert(notifications).values({
    userId: input.userId,
    type: input.type,
    title: input.title,
    href: input.href,
    payload: input.payload ? JSON.stringify(input.payload) : null,
  });
}

/** 여러 사용자에게 한 번에 동일 알림 fanout. */
export async function createNotificationFanout(
  userIds: number[],
  input: Omit<CreateNotificationInput, "userId">
): Promise<void> {
  if (userIds.length === 0) return;
  const rows = userIds.map((userId) => ({
    userId,
    type: input.type,
    title: input.title,
    href: input.href,
    payload: input.payload ? JSON.stringify(input.payload) : null,
  }));
  await db.insert(notifications).values(rows);
}

/**
 * 공고 면접관 전원에게 fanout.
 * 인앱 알림 + 이메일 동시 발송. SMTP 미설정이거나 면접관 이메일 없으면 이메일만 자동 skip.
 * 메일은 면접관이 서비스에 접속하지 않아도 후보자 액션을 인지할 수 있도록 함.
 *
 * @param options.skipEmail true 면 이메일 생략.
 * @param options.excludeEmailUserIds 이 userId 들은 이메일에서만 제외 (인앱 알림은 발송).
 *   호출자가 별도의 풍부한 메일을 보내는 경우 중복 차단용.
 */
export async function notifyJobInterviewers(
  jobId: number,
  input: Omit<CreateNotificationInput, "userId">,
  options?: { skipEmail?: boolean; excludeEmailUserIds?: number[] }
): Promise<void> {
  const recipients = await db
    .select({
      userId: jobInterviewers.userId,
      email: users.email,
      name: users.name,
    })
    .from(jobInterviewers)
    .innerJoin(users, eq(users.id, jobInterviewers.userId))
    .where(eq(jobInterviewers.jobId, jobId));

  // 1) 인앱 알림
  await createNotificationFanout(
    recipients.map((r) => r.userId),
    input
  );

  // 2) 이메일 발송 — SMTP 사용 가능할 때만. 실패해도 인앱 알림은 유지.
  if (options?.skipEmail) return;
  if (recipients.length === 0) return;

  // 공고 정보 (orgId, title) 조회 — SMTP 라우팅 + 메일 본문용
  const [job] = await db
    .select({ orgId: jobPostings.orgId, title: jobPostings.title })
    .from(jobPostings)
    .where(eq(jobPostings.id, jobId));
  const orgId = job?.orgId ?? null;
  if (!(await isSmtpAvailable(orgId))) return;

  // APP_BASE_URL 미설정 시 fallback:
  //   - dev: localhost:3003 (npm run dev 기본 포트)
  //   - prod: 경고 로그 — 운영에서는 반드시 등록 필요 (메일 링크가 깨짐)
  const envBase = process.env.APP_BASE_URL?.trim().replace(/\/$/, "");
  let base = envBase ?? "";
  if (!envBase) {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[notifications] APP_BASE_URL 미설정 — 메일 링크가 상대경로로 나갑니다. Vercel 환경변수에 등록 필요."
      );
    } else {
      base = "http://localhost:3003";
    }
  }
  const fullUrl = input.href.startsWith("http")
    ? input.href
    : `${base}${input.href}`;
  const subject = `[Intervia] ${input.title}`;
  const excludeSet = new Set(options?.excludeEmailUserIds ?? []);
  for (const r of recipients) {
    if (!r.email) continue;
    if (excludeSet.has(r.userId)) continue;
    const html = wrapEmailCard({
      innerHtml: `
        <h1 style="font-size:18px;margin:24px 0 8px;color:#0f172a;">${r.name}님, 안녕하세요.</h1>
        <p style="color:#475569;line-height:1.6;margin:0 0 16px;">
          담당 공고 <strong style="color:#0f172a;">${job?.title ?? ""}</strong> 에서 알림이 도착했습니다.
        </p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;font-size:14px;color:#0f172a;line-height:1.6;margin:0 0 20px;">
          ${input.title}
        </div>
        <p style="text-align:center;margin:0 0 16px;">
          <a href="${fullUrl}" style="display:inline-block;background:#0d4f3c;color:#fff;text-decoration:none;font-weight:600;padding:12px 28px;border-radius:10px;font-size:14px;">자세히 보기</a>
        </p>
        <p style="font-size:12px;color:#64748b;margin:0;text-align:center;">
          <a href="${fullUrl}" style="color:#0d4f3c;word-break:break-all;">${fullUrl}</a>
        </p>
      `,
      footer: "본 메일은 Intervia 시스템에서 자동 발송되었습니다.",
    });
    try {
      await sendMail({ to: r.email, subject, html, orgId, audience: "org" });
    } catch (e) {
      console.error(
        `[notifyJobInterviewers] mail failed (uid=${r.userId}):`,
        e instanceof Error ? e.message : e
      );
    }
  }
}

/** 공고 면접관 이메일 주소 목록 — 메일 발송용. */
export async function getJobInterviewerEmails(jobId: number): Promise<
  Array<{ id: number; email: string; name: string }>
> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
    })
    .from(jobInterviewers)
    .innerJoin(users, eq(users.id, jobInterviewers.userId))
    .where(eq(jobInterviewers.jobId, jobId));
  return rows.filter((r) => !!r.email);
}

/** 법인 관리자 전원에게 fanout. */
export async function notifyOrgAdmins(
  orgId: number,
  input: Omit<CreateNotificationInput, "userId">
): Promise<void> {
  const admins = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.orgId, orgId), eq(users.role, "org_admin")));
  await createNotificationFanout(
    admins.map((a) => a.id),
    input
  );
}

/** 시스템 관리자 전원에게 fanout. */
export async function notifySystemAdmins(
  input: Omit<CreateNotificationInput, "userId">
): Promise<void> {
  const admins = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "system_admin"));
  await createNotificationFanout(
    admins.map((a) => a.id),
    input
  );
}

/** 내 알림 목록 — 미읽음 전체(최신순) + 최근 읽음 5건. limit 인자는 호환용. */
export async function listMyNotifications(
  userId: number,
  _limit = 20
): Promise<
  Array<{
    id: number;
    type: NotificationType;
    title: string;
    href: string;
    readAt: string | null;
    createdAt: string;
  }>
> {
  const cols = {
    id: notifications.id,
    type: notifications.type,
    title: notifications.title,
    href: notifications.href,
    readAt: notifications.readAt,
    createdAt: notifications.createdAt,
  };
  const [unread, recentRead] = await Promise.all([
    db
      .select(cols)
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
      .orderBy(desc(notifications.createdAt)),
    db
      .select(cols)
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNotNull(notifications.readAt)))
      .orderBy(desc(notifications.createdAt))
      .limit(5),
  ]);
  return [...unread, ...recentRead] as Array<{
    id: number;
    type: NotificationType;
    title: string;
    href: string;
    readAt: string | null;
    createdAt: string;
  }>;
}

/** 미읽음 카운트. 헤더 뱃지용. */
export async function unreadCount(userId: number): Promise<number> {
  const [r] = await db
    .select({ c: sql<number>`COUNT(*)` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return Number(r?.c ?? 0);
}

/** 단일 알림 읽음 처리. 본인 알림만 가능. */
export async function markRead(userId: number, id: number): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: sql`CURRENT_TIMESTAMP` })
    .where(
      and(
        eq(notifications.id, id),
        eq(notifications.userId, userId),
        isNull(notifications.readAt)
      )
    );
}

/** 본인의 모든 미읽음 알림을 읽음 처리. */
export async function markAllRead(userId: number): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: sql`CURRENT_TIMESTAMP` })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
}

/** 30일 이상된 읽은 알림 자동 정리. cron 호출용. */
export async function purgeOldNotifications(): Promise<number> {
  const result = await db
    .delete(notifications)
    .where(
      and(
        sql`${notifications.readAt} IS NOT NULL`,
        sql`${notifications.createdAt} < datetime('now', '-30 days')`
      )
    );
  return Number((result as { rowsAffected?: number }).rowsAffected ?? 0);
}

void inArray; // (placeholder — keep import stable for future filter helpers)
