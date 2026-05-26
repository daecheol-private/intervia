import { searchDartCorps } from "@/lib/dart-corps";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const results = searchDartCorps(q, 8);
  return Response.json({ results });
}
