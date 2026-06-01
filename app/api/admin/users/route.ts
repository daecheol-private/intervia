import { db } from "@/lib/db";
import { users, organizations } from "@/lib/schema";
import { desc, eq, or, like } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;
  if (me!.role !== "system_admin")
    return new Response("권한 없음", { status: 403 });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const pattern = q ? `%${q}%` : null;

  const base = db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      status: users.status,
      orgId: users.orgId,
      orgName: organizations.name,
      createdAt: users.createdAt,
      emailVerifiedAt: users.emailVerifiedAt,
    })
    .from(users)
    .leftJoin(organizations, eq(organizations.id, users.orgId))
    .orderBy(desc(users.createdAt))
    .limit(200);

  const rows = pattern
    ? await base.where(or(like(users.email, pattern), like(users.name, pattern)))
    : await base;

  return Response.json(rows);
}
