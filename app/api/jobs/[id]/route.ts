import { db } from "@/lib/db";
import { after } from "next/server";
import { jobPostings, candidates, organizations, tokenLedger } from "@/lib/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { getCurrentUser, hashPassword } from "@/lib/auth";
import { getEmailDomain } from "@/lib/email-domain";
import { validateRecruitingContactEmail } from "@/lib/job-contact";
import { ownsOrg, requireUser } from "@/lib/tenant";
import { isJobUnlocked, isValidPin } from "@/lib/job-lock";
import { deleteCandidateFiles } from "@/lib/candidate-files";
import { logAudit } from "@/lib/audit";
import { chargeFeature, refundFeature } from "@/lib/tokens";
import { stripBiasedLines } from "@/lib/job-bias-filter";
import { parseDbTimestamp } from "@/lib/utils";
import { traitProfileInputToJson } from "@/lib/personality";
import {
  generateRequirementChecklist,
  serializeChecklist,
} from "@/lib/job-checklist";

const REFUND_WINDOW_MS = 5 * 60 * 1000;
// 생성(선차감+LLM 호출)→5분 내 삭제→환불 무한 반복으로 LLM 비용만 소모시키는 abuse 차단.
const JOB_REFUND_DAILY_LIMIT = 3;

export const runtime = "nodejs";

async function loadJob(jobId: number) {
  const [row] = await db
    .select()
    .from(jobPostings)
    .where(eq(jobPostings.id, jobId));
  return row;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { id } = await params;
  const jobId = Number(id);
  const row = await loadJob(jobId);
  if (!row) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, row.orgId))
    return new Response("Not found", { status: 404 });

  const hasPassword = row.passwordHash != null;
  if (hasPassword && me!.role !== "system_admin" && !(await isJobUnlocked(jobId))) {
    return Response.json(
      { id: row.id, title: row.title, locked: true, hasPassword: true },
      { status: 403 }
    );
  }

  const { passwordHash, ...rest } = row;
  void passwordHash;

  // 법인명 — 합·불 통보 메일 미리보기 본문에 사용.
  let companyName: string | null = null;
  if (row.orgId) {
    const [org] = await db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, row.orgId));
    companyName = org?.name ?? null;
  }

  return Response.json({
    ...rest,
    companyName,
    hasPassword,
    locked: false,
  });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { id } = await params;
  const jobId = Number(id);
  const existing = await loadJob(jobId);
  if (!existing) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, existing.orgId))
    return new Response("Not found", { status: 404 });

  if (me!.role !== "system_admin" && existing.passwordHash && !(await isJobUnlocked(jobId))) {
    return new Response("잠긴 공고입니다. 먼저 잠금을 해제하세요.", {
      status: 403,
    });
  }

  const body = await req.json();

  // 임시 공고(isDraft) 정식 전환 — 필수 항목이 모두 채워지면 isDraft=false 로 바꾸고 job_post 과금.
  // 일부만 채워 저장하면 임시 상태 유지(미과금). chargeFeature 는 멱등이라 재전환해도 이중과금 없음.
  const wasDraft = existing.isDraft;
  const requiredKeys = [
    "title",
    "position",
    "level",
    "employmentType",
    "responsibilities",
    "requirements",
  ];
  const hasAllRequired = requiredKeys.every(
    (k) => typeof body[k] === "string" && body[k].trim().length > 0
  );
  // keepDraft=true 면 필수항목이 다 차 있어도 정식 전환하지 않고 임시 상태 유지(과금 X).
  const finalizing = wasDraft && hasAllRequired && body.keepDraft !== true;

  const update: Record<string, unknown> = {
    title: body.title,
    position: body.position,
    level: body.level,
    employmentType: body.employmentType,
    responsibilities: body.responsibilities,
    requirements: body.requirements,
    idealProfile: typeof body.idealProfile === "string" ? body.idealProfile.slice(0, 3000) : "",
    // 차별 금지 항목(성별·나이·결혼 등) 포함 라인은 저장 전 제거 (채용절차법 §4의3)
    evaluationFocus: stripBiasedLines(
      typeof body.evaluationFocus === "string" ? body.evaluationFocus.slice(0, 3000) : ""
    ).cleaned,
    tone: body.tone,
    interviewDurationMinutes: body.interviewDurationMinutes ?? 20,
  };

  // 채용 담당자 이메일 — 미입력 시 기존 값 또는 작성자 이메일로 폴백(빈칸 방지).
  // 회사 도메인 외 이메일은 거부. 구버전(null) 공고도 이 경로로 첫 저장 시 채워진다.
  const expectedDomain =
    me!.role === "system_admin" ? null : getEmailDomain(me!.email);
  const contact = validateRecruitingContactEmail(
    body.recruitingContactEmail || existing.recruitingContactEmail || me!.email,
    expectedDomain
  );
  if (!contact.ok) return new Response(contact.message, { status: 400 });
  update.recruitingContactEmail = contact.email;

  // 키가 없으면 기존 값 유지 (부분 업데이트 클라이언트 호환)
  if ("traitProfile" in body) {
    const trait = traitProfileInputToJson(body.traitProfile);
    if (trait.error) return new Response(trait.error, { status: 400 });
    update.traitProfile = trait.json;
  }

  // 주요업무/자격요건이 바뀐 경우에만 JD 요건 체크리스트 재생성 (그 외 수정은 LLM 호출 생략).
  // LLM 호출이 느리므로 응답을 막지 않는다 — 기존 체크리스트는 그대로 두고(빈 구간 없이 잠깐 stale),
  // 응답 후 after() 백그라운드에서 재생성해 교체.
  const jdChanged =
    body.responsibilities !== existing.responsibilities ||
    body.requirements !== existing.requirements;

  if (body.password === "") {
    update.passwordHash = null;
  } else if (typeof body.password === "string" && body.password.length > 0) {
    if (!isValidPin(body.password))
      return new Response("비밀번호는 4자리 숫자여야 합니다.", { status: 400 });
    update.passwordHash = await hashPassword(body.password);
  }

  if (finalizing) update.isDraft = false;

  const [row] = await db
    .update(jobPostings)
    .set(update)
    .where(eq(jobPostings.id, jobId))
    .returning();
  if (!row) return new Response("Not found", { status: 404 });

  // 임시 → 정식 전환 성공 시 job_post 과금 (멱등 — refType=job/refId=jobId).
  if (finalizing && row.orgId) {
    await chargeFeature({
      orgId: row.orgId,
      feature: "job_post",
      refType: "job",
      refId: jobId,
      userId: me!.id,
      memo: row.title,
    });
    logAudit(req, {
      actor: me!,
      action: "job.finalize_draft",
      resourceType: "job",
      resourceId: jobId,
      orgId: row.orgId,
    });
  }

  if (jdChanged) {
    after(async () => {
      try {
        const checklist = serializeChecklist(
          await generateRequirementChecklist({
            responsibilities: body.responsibilities,
            requirements: body.requirements,
          })
        );
        if (checklist) {
          await db
            .update(jobPostings)
            .set({ requirementChecklist: checklist })
            .where(eq(jobPostings.id, jobId));
        }
      } catch {
        // 체크리스트는 보조 데이터 — 실패 시 기존/즉석 분해 폴백으로 충분.
      }
    });
  }

  const { passwordHash, ...rest } = row;
  return Response.json({ ...rest, hasPassword: passwordHash != null });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { id } = await params;
  const jobId = Number(id);
  const existing = await loadJob(jobId);
  if (!existing) return new Response("Not found", { status: 404 });
  if (!ownsOrg(me!, existing.orgId))
    return new Response("Not found", { status: 404 });

  if (me!.role !== "system_admin" && existing.passwordHash && !(await isJobUnlocked(jobId))) {
    return new Response("잠긴 공고입니다. 먼저 잠금을 해제하세요.", {
      status: 403,
    });
  }

  // 1. 이 공고의 모든 후보자 ID 수집
  const candidateRows = await db
    .select({ id: candidates.id })
    .from(candidates)
    .where(eq(candidates.jobId, jobId));
  const candidateIds = candidateRows.map((r) => r.id);

  // 2. 후보자별 모든 파일(메인 이력서 + 첨부) 삭제
  //    DB 삭제는 cascade 로 candidates / attachments / sessions / notes 등 모두 사라짐.
  const fileResult = await deleteCandidateFiles(candidateIds);

  // 3. 공고 DB row 삭제 (cascade 발동)
  await db.delete(jobPostings).where(eq(jobPostings.id, jobId));

  // 5분 내 삭제 시 자동 환불 — 법인당 하루 3회까지만 (생성→삭제→환불 반복 차단)
  let refundLimited = false;
  if (existing.orgId) {
    // createdAt 은 SQLite CURRENT_TIMESTAMP(UTC, "YYYY-MM-DD HH:MM:SS", Z 없음).
    // new Date() 기본 파싱은 이를 로컬(KST+9)로 해석해 ageMs 가 항상 ~9h 과대 → 5분 내 환불이
    // 영영 미발동(로컬/비UTC 서버). parseDbTimestamp 로 UTC 파싱해 바로잡는다.
    const ageMs = Date.now() - parseDbTimestamp(existing.createdAt).getTime();
    if (ageMs <= REFUND_WINDOW_MS) {
      const since = new Date(Date.now() - 86_400_000)
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d+Z$/, "");
      const [recent] = await db
        .select({ c: sql<number>`COUNT(*)` })
        .from(tokenLedger)
        .where(
          and(
            eq(tokenLedger.orgId, existing.orgId),
            eq(tokenLedger.reason, "refund"),
            eq(tokenLedger.refType, "job"),
            gte(tokenLedger.createdAt, since)
          )
        );
      if (Number(recent?.c ?? 0) < JOB_REFUND_DAILY_LIMIT) {
        await refundFeature({
          orgId: existing.orgId,
          feature: "job_post",
          refType: "job",
          refId: jobId,
          userId: me!.id,
          memo: "공고 등록 직후 삭제",
        });
      } else {
        refundLimited = true;
      }
    }
  }

  logAudit(req, {
    actor: me!,
    action: "job.delete",
    resourceType: "job",
    resourceId: jobId,
    orgId: existing.orgId,
    metadata: {
      title: existing.title,
      candidatesDeleted: candidateIds.length,
      filesDeleted: fileResult.deletedFiles,
      fileErrors: fileResult.errors,
      refundLimited: refundLimited || undefined,
    },
  });

  return new Response(null, { status: 204 });
}
