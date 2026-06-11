/**
 * 법인 컬처핏 프로필 조회·저장.
 * org_admin / system_admin 만 PUT 가능.
 */
import { db } from "@/lib/db";
import { organizations } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";
import type { CultureFitProfile } from "@/lib/prompts";

export const runtime = "nodejs";

export async function GET() {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (!me!.orgId) return Response.json({ cultureFitProfile: null });

  const [org] = await db
    .select({ cultureFitProfile: organizations.cultureFitProfile })
    .from(organizations)
    .where(eq(organizations.id, me!.orgId));

  if (!org) return Response.json({ cultureFitProfile: null });

  let parsed: CultureFitProfile | null = null;
  if (org.cultureFitProfile) {
    try { parsed = JSON.parse(org.cultureFitProfile) as CultureFitProfile; } catch { /* ignore */ }
  }
  return Response.json({ cultureFitProfile: parsed });
}

export async function PUT(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role !== "org_admin" && me!.role !== "system_admin") {
    return new Response("Forbidden", { status: 403 });
  }
  if (!me!.orgId) return new Response("No org", { status: 400 });

  const body = (await req.json()) as { cultureFitProfile: CultureFitProfile | null };
  const value = body.cultureFitProfile ? JSON.stringify(body.cultureFitProfile) : null;

  await db
    .update(organizations)
    .set({ cultureFitProfile: value })
    .where(eq(organizations.id, me!.orgId));

  return Response.json({ ok: true });
}
