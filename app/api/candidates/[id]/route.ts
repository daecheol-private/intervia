import { db } from "@/lib/db";
import { candidates, interviewSchedules, interviewSessions, organizations, screeningJobs, userCandidateFavorites } from "@/lib/schema";
import { eq, desc, and } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import { guardCandidate } from "@/lib/candidate-guard";
import { parseTraitProfile } from "@/lib/personality";
import { sanitizeCompetencies } from "@/lib/competencies";
import { deleteFilesForCandidate } from "@/lib/candidate-files";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { id } = await params;
  const cid = Number(id);

  const g = await guardCandidate(me!, cid);
  if (!g.ok) return g.res;
  const { candidate, job } = g;

  // guard 이후 보조 조회는 전부 상호 독립 — 병렬 실행 (상세 페이지 + 평가 중 4초 폴링 핫패스).
  const [sessions, schedules, lastJobRows, favRows, orgInfo] =
    await Promise.all([
      db
        .select()
        .from(interviewSessions)
        .where(eq(interviewSessions.candidateId, cid))
        .orderBy(desc(interviewSessions.createdAt)),
      db
        .select()
        .from(interviewSchedules)
        .where(eq(interviewSchedules.candidateId, cid))
        .orderBy(desc(interviewSchedules.createdAt)),
      db
        .select({ status: screeningJobs.status, lastError: screeningJobs.lastError })
        .from(screeningJobs)
        .where(eq(screeningJobs.candidateId, cid))
        .orderBy(desc(screeningJobs.id))
        .limit(1),
      db
        .select({ userId: userCandidateFavorites.userId })
        .from(userCandidateFavorites)
        .where(
          and(
            eq(userCandidateFavorites.userId, me!.id),
            eq(userCandidateFavorites.candidateId, cid)
          )
        ),
      // 법인명(메일 본문) + 컬처핏 프로필(리포트의 핵심 역량 배지).
      candidate.orgId
        ? db
            .select({
              name: organizations.name,
              cultureFitProfile: organizations.cultureFitProfile,
            })
            .from(organizations)
            .where(eq(organizations.id, candidate.orgId))
            .then(([org]) => org ?? null)
        : Promise.resolve<{
            name: string;
            cultureFitProfile: string | null;
          } | null>(null),
    ]);
  const [lastJob] = lastJobRows;
  const [fav] = favRows;
  const companyName = orgInfo?.name ?? null;
  // 면접 리포트의 "후보자 특성 vs 공고 선호" 대조용 — 공고의 선호 특성 프로필
  const jobTraitProfile = parseTraitProfile(job?.traitProfile);
  // 리포트 "회사가 중시하는 역량" 배지 — 법인 컬처핏 JSON 에서 NCS 역량 키만 추출
  let orgCoreCompetencies: string[] = [];
  if (orgInfo?.cultureFitProfile) {
    try {
      const cf = JSON.parse(orgInfo.cultureFitProfile) as {
        coreCompetencies?: unknown;
      };
      orgCoreCompetencies = sanitizeCompetencies(cf.coreCompetencies);
    } catch {
      /* 손상 JSON — 역량 배지 생략 */
    }
  }

  // 시스템관리자가 타 법인 데이터 조회한 경우 특별히 감사 로깅 (A-8)
  if (me!.role === "system_admin" && me!.orgId !== candidate.orgId) {
    logAudit(_req, {
      actor: me!,
      action: "candidate.view",
      resourceType: "candidate",
      resourceId: cid,
      orgId: candidate.orgId,
      metadata: { cross_org: true, name: candidate.name },
    });
  }

  // 서류평가 진행 상태 derive — 기존 status 컬럼 대체.
  //   not_started: 아직 큐에 안 들어갔거나 큐가 끝났는데 리포트도 없음 (=신규/실패 후 재시도 대기)
  //   in_queue:    queued (워커 대기) 또는 processing (워커 점유) — UI polling
  //   done:        screeningReport 가 있음
  //   failed:      마지막 큐가 failed (리포트 없음)
  let screeningPhase:
    | "not_started"
    | "in_queue"
    | "done"
    | "failed"
    | "skipped";
  if (candidate.screeningReport) screeningPhase = "done";
  else if (lastJob?.status === "queued" || lastJob?.status === "processing")
    screeningPhase = "in_queue";
  else if (lastJob?.status === "failed") screeningPhase = "failed";
  // AI 이력서 평가를 끈 공고 — 파싱만 끝나고 평가는 생략된 상태(점수·리포트 없음).
  else if (job?.aiScreeningDisabled) screeningPhase = "skipped";
  else screeningPhase = "not_started";

  // 재평가 진행 중 — 기존 리포트가 있는데 새 평가 job 이 큐/처리중. (done 으로 가려지므로 별도 플래그)
  const rescreening =
    !!candidate.screeningReport &&
    (lastJob?.status === "queued" || lastJob?.status === "processing");
  // 워커가 실제 점유 중(processing) — 이때만 재평가 버튼을 숨긴다(중복 실행 방지).
  // queued(재시도 대기 포함)는 "지금 재시도" 가능하므로 버튼 노출.
  const screeningActive = lastJob?.status === "processing";

  const favorited = !!fav;

  // PIN bcrypt 해시는 응답에서 제거 (4자리라 오프라인 대입에 취약)
  let jobSafe: Record<string, unknown> | null = null;
  if (job) {
    const { passwordHash, ...rest } = job;
    jobSafe = { ...rest, hasPassword: passwordHash != null };
  }

  // 원본 이력서 텍스트(resumeText)는 항상 서버 전용 — 응답에서 명시적으로 제외한다.
  // (HR 검수용 마스킹본 resumeMaskedText 만 노출.) candidates 에 새 PII 컬럼을 추가하면
  //  여기서도 클라이언트 노출 여부를 반드시 검토할 것 — 전체 spread 로 무심코 새지 않도록.
  const candidateSafe: Record<string, unknown> = { ...candidate, favorited };
  delete candidateSafe.resumeText;

  return Response.json({
    candidate: candidateSafe,
    job: jobSafe,
    companyName,
    jobTraitProfile,
    orgCoreCompetencies,
    sessions,
    schedules,
    screeningPhase,
    // 실패 사유 — 후보 상세에서 "OCR 활성화 필요" 등 구체 안내 표시용.
    screeningError: screeningPhase === "failed" ? lastJob?.lastError ?? null : null,
    rescreening,
    screeningActive,
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { id } = await params;
  const cid = Number(id);
  const body = (await req.json().catch(() => null)) as {
    name?: string;
    email?: string | null;
    phone?: string | null;
    educationLevel?: string | null;
    educationSchool?: string | null;
    educationMajor?: string | null;
  } | null;
  if (!body) return new Response("바디 필요", { status: 400 });

  const g = await guardCandidate(me!, cid);
  if (!g.ok) return g.res;
  const { candidate: row } = g;

  const updates: Partial<{
    name: string;
    email: string | null;
    phone: string | null;
    educationLevel: string | null;
    educationSchool: string | null;
    educationMajor: string | null;
  }> = {};

  if (typeof body.name === "string") {
    const v = body.name.trim();
    if (v.length === 0 || v.length > 100)
      return new Response("이름은 1~100자.", { status: 400 });
    updates.name = v;
  }
  if (body.email !== undefined) {
    if (body.email === null || body.email === "") {
      updates.email = null;
    } else {
      const v = body.email.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))
        return new Response("이메일 형식 오류.", { status: 400 });
      updates.email = v;
    }
  }
  if (body.phone !== undefined) {
    if (body.phone === null || body.phone === "") {
      updates.phone = null;
    } else {
      const v = body.phone.trim().slice(0, 40);
      updates.phone = v;
    }
  }
  // 최종학력 — 빈 문자열은 null 로(미상), 그 외 100자 제한.
  const eduFields = [
    ["educationLevel", body.educationLevel],
    ["educationSchool", body.educationSchool],
    ["educationMajor", body.educationMajor],
  ] as const;
  for (const [key, val] of eduFields) {
    if (val === undefined) continue;
    updates[key] = val === null || val.trim() === "" ? null : val.trim().slice(0, 100);
  }

  if (Object.keys(updates).length === 0)
    return new Response("변경 항목 없음", { status: 400 });

  await db.update(candidates).set(updates).where(eq(candidates.id, cid));

  logAudit(req, {
    actor: me!,
    action: "user.status_change" as const,
    resourceType: "candidate" as const,
    resourceId: cid,
    orgId: row.orgId,
    jobId: row.jobId,
    metadata: {
      kind: "candidate_edit",
      fields: Object.keys(updates),
      prevName: row.name,
    },
  });

  return Response.json({ ok: true, updated: updates });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const { id } = await params;
  const cid = Number(id);
  const g = await guardCandidate(me!, cid);
  if (!g.ok) return g.res;
  const { candidate: row } = g;

  // 파일 먼저 — DB row 삭제 후엔 path 정보 못 가져옴 (cascade 로 attachments 도 사라짐)
  const fileResult = await deleteFilesForCandidate(cid);
  await db.delete(candidates).where(eq(candidates.id, cid));

  logAudit(req, {
    actor: me!,
    action: "candidate.delete",
    resourceType: "candidate",
    resourceId: cid,
    orgId: row.orgId,
    jobId: row.jobId,
    metadata: {
      name: row.name,
      deletedFiles: fileResult.deletedFiles,
      fileErrors: fileResult.errors,
    },
  });

  return new Response(null, { status: 204 });
}
