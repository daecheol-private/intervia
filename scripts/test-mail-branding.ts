/**
 * 지원자 메일 법인 브랜딩(로고 CID + 브랜드컬러 밴드) sanity 테스트 — 로컬 전용.
 *
 * 실제 발송 경로(getOrgEmailBranding → build*Email → sendMail)를 그대로 호출한다.
 * 로컬 dev 는 mailer 의 리다이렉트 정책으로 모든 메일이 admin.intervia@gmail.com 으로 간다.
 *
 * 사용 (PowerShell):
 *   # ① 로컬 org 브랜딩 현황
 *   $env:LOCAL_DB="1"; npx tsx scripts/test-mail-branding.ts
 *
 *   # ② org 에 테스트 브랜딩 주입 (public/email-logo.png 를 로고로 저장 + 컬러 지정)
 *   $env:LOCAL_DB="1"; npx tsx scripts/test-mail-branding.ts --setup <orgId> "#1e3a5f"
 *
 *   # ③ 미리보기 HTML 생성 (cid → data URI 치환, 브라우저로 열어 확인)
 *   $env:LOCAL_DB="1"; npx tsx scripts/test-mail-branding.ts <orgId>
 *
 *   # ④ 실발송 (로컬 → admin.intervia@gmail.com 수신)
 *   $env:LOCAL_DB="1"; npx tsx scripts/test-mail-branding.ts <orgId> --send
 */
import "./_load-env.mjs";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

async function main() {
  if (process.env.LOCAL_DB !== "1") {
    console.error('로컬 전용 스크립트입니다 — $env:LOCAL_DB="1" 로 실행하세요.');
    process.exit(1);
  }
  const { db } = await import("../lib/db");
  const { organizations } = await import("../lib/schema");
  const { eq } = await import("drizzle-orm");

  const args = process.argv.slice(2);

  // ② --setup <orgId> <#rrggbb>
  if (args[0] === "--setup") {
    const orgId = Number(args[1]);
    const color = args[2] ?? "#1e3a5f";
    if (!orgId) {
      console.error("사용: --setup <orgId> [#rrggbb]");
      process.exit(1);
    }
    const { saveFile } = await import("../lib/storage");
    const logoBuf = await fs.readFile(
      path.join(process.cwd(), "public", "email-logo.png")
    );
    const key = await saveFile("test-brand-logo.png", logoBuf);
    await db
      .update(organizations)
      .set({ logoFileKey: key, brandColor: color })
      .where(eq(organizations.id, orgId));
    console.log(`org ${orgId} 브랜딩 설정 완료 — logo=${key}, color=${color}`);
    return;
  }

  const orgs = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      logoFileKey: organizations.logoFileKey,
      brandColor: organizations.brandColor,
    })
    .from(organizations);
  console.log("── 로컬 org 브랜딩 현황 ──");
  for (const o of orgs)
    console.log(
      `  #${o.id} ${o.name} — 로고 ${o.logoFileKey ? "O" : "X"}, 컬러 ${o.brandColor ?? "X"}`
    );

  const targetId = Number(args.find((a) => /^\d+$/.test(a)));
  const target = targetId
    ? orgs.find((o) => o.id === targetId)
    : orgs.find((o) => o.logoFileKey || o.brandColor);
  if (!target) {
    console.log("\n브랜딩 설정된 org 없음 — --setup <orgId> 로 주입 후 재실행.");
    return;
  }

  const { getOrgEmailBranding, brandingAttachments } = await import(
    "../lib/mailer"
  );
  const branding = await getOrgEmailBranding(target.id);
  console.log(`\n── getOrgEmailBranding(#${target.id} ${target.name}) ──`);
  if (!branding) {
    console.log("  null (브랜딩 미설정 → Intervia 기본 헤더로 발송됨)");
    return;
  }
  console.log(`  orgName   : ${branding.orgName}`);
  console.log(`  brandColor: ${branding.brandColor ?? "(없음 → 기본 네이비 밴드)"}`);
  console.log(
    `  logo      : ${branding.logo ? `${branding.logo.filename} ${branding.logo.contentType} ${branding.logo.content.length.toLocaleString()}B cid=${branding.logo.cid}` : "(없음 → 법인명 텍스트 밴드)"}`
  );

  // ③ 대표 메일 2종 미리보기 — cid 를 data URI 로 치환해 브라우저에서 확인 가능하게.
  const { buildInterviewEmail } = await import("../lib/mailer");
  const { buildDecisionEmail } = await import("../lib/candidate-stage");
  const invite = buildInterviewEmail({
    candidateName: "강대철",
    jobTitle: "부설연구소 솔루션 관련 개발 신입/경력직 채용",
    url: "https://intervia.kr/interview/tk_test",
    expiresAt: "2026-07-20 23:59",
    orgName: branding.orgName,
    branding,
  });
  const decision = buildDecisionEmail({
    candidateName: "강대철",
    jobTitle: "부설연구소 솔루션 관련 개발 신입/경력직 채용",
    decision: "hired",
    companyName: branding.orgName,
    branding,
  });
  // cid: 참조를 data URI 로 치환해 브라우저에서 이미지가 보이게 (메일 클라이언트는 CID 그대로 뜸).
  const { EMAIL_LOGO_PNG_BASE64 } = await import("../lib/email-logo-data");
  const toPreview = (html: string) => {
    let h = html;
    if (branding.logo)
      h = h.replaceAll(
        `cid:${branding.logo.cid}`,
        `data:${branding.logo.contentType};base64,${branding.logo.content.toString("base64")}`
      );
    // Intervia 로고(헤더/푸터, 항상)
    h = h.replaceAll(
      "cid:intervia-logo",
      `data:image/png;base64,${EMAIL_LOGO_PNG_BASE64}`
    );
    return h;
  };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mail-branding-"));
  const invitePath = path.join(dir, "invite.html");
  const decisionPath = path.join(dir, "decision.html");
  await fs.writeFile(invitePath, toPreview(invite.html));
  await fs.writeFile(decisionPath, toPreview(decision.html));
  console.log(`\n── 미리보기 HTML ──\n  ${invitePath}\n  ${decisionPath}`);

  // ④ --send: 실발송 (로컬 리다이렉트 정책으로 admin.intervia@gmail.com 수신)
  if (args.includes("--send")) {
    const { sendMail } = await import("../lib/mailer");
    await sendMail({
      to: "candidate-test@example.com",
      ...invite,
      orgId: target.id,
      audience: "candidate",
      attachments: brandingAttachments(branding),
    });
    console.log("\n실발송 완료 — 로컬 리다이렉트 수신함(admin.intervia@gmail.com) 확인.");
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
