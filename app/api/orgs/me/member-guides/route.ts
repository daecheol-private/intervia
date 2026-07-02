/**
 * 페이지 진입 가이드 — 끈(다시 보지 않기) 가이드 키 조회/기록. org_admin·member 공통.
 *
 * users.seenMemberGuides(JSON 배열 문자열)에 누적한다. 공고/후보 페이지 진입 시 자동
 * 노출되는 가이드를 사용자가 '다시 보지 않기'로 끄면 그 키를 기록해 이후로 안 띄운다
 * (계정별). system_admin 은 가이드 자체가 마운트되지 않아 빈 배열로 동작한다.
 */
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { requireUser } from "@/lib/tenant";

export const runtime = "nodejs";

// 화이트리스트 — 임의 키 누적 방지. 가이드 추가 시 여기에 키를 더한다.
const VALID_KEYS = ["job_new", "job_page", "candidate_page", "org_settings"];

function parseSeen(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

export async function GET() {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const [row] = await db
    .select({ seen: users.seenMemberGuides })
    .from(users)
    .where(eq(users.id, me!.id));
  return Response.json({ seen: parseSeen(row?.seen ?? null) });
}

export async function POST(req: Request) {
  const me = await getCurrentUser();
  const guard = requireUser(me);
  if (guard) return guard;

  const body = (await req.json().catch(() => null)) as { key?: string } | null;
  const key = body?.key?.trim();
  if (!key || !VALID_KEYS.includes(key))
    return new Response("알 수 없는 가이드 키", { status: 400 });

  const [row] = await db
    .select({ seen: users.seenMemberGuides })
    .from(users)
    .where(eq(users.id, me!.id));
  const seen = parseSeen(row?.seen ?? null);
  if (!seen.includes(key)) {
    seen.push(key);
    await db
      .update(users)
      .set({ seenMemberGuides: JSON.stringify(seen) })
      .where(eq(users.id, me!.id));
  }
  return Response.json({ ok: true, seen });
}
