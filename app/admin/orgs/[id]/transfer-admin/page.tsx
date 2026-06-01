import { db } from "@/lib/db";
import { organizations, users } from "@/lib/schema";
import { and, eq, ne } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import TransferAdminForm from "./form";

export const dynamic = "force-dynamic";

export default async function TransferAdminPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await getCurrentUser();
  if (!me || me.role !== "system_admin") redirect("/");

  const { id } = await params;
  const orgId = Number(id);

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, orgId));
  if (!org) redirect("/admin/orgs");

  const members = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      status: users.status,
    })
    .from(users)
    .where(and(eq(users.orgId, orgId), ne(users.role, "system_admin")))
    .orderBy(users.role);

  return (
    <main className="max-w-3xl mx-auto w-full px-4 sm:px-6 py-6 sm:py-8">
      <div className="mb-6">
        <Link href="/admin/orgs" className="text-xs text-slate-500 hover:underline">
          ← 법인 관리
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 mt-2">
          법인 관리자 이전
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          <strong>{org.name}</strong> 법인의 org_admin 권한을 다른 멤버에게 이전합니다.
        </p>
      </div>

      {members.length === 0 ? (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-sm text-amber-700">
          이 법인에는 system_admin 외 멤버가 없습니다. 이전 불가.
        </div>
      ) : (
        <TransferAdminForm orgId={orgId} members={members} />
      )}
    </main>
  );
}
