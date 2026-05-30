import "./_load-env.mjs";

const sec = process.env.INTERNAL_API_SECRET;
console.log("INTERNAL_API_SECRET set:", !!sec);
if (!sec) {
  console.log("INTERNAL_API_SECRET 없음 — 중단");
  process.exit(1);
}
const base = process.env.APP_BASE_URL || "https://intervia.kr";
const t0 = Date.now();
try {
  const res = await fetch(`${base}/api/internal/process-screenings`, {
    method: "POST",
    headers: { "X-Internal-Secret": sec },
  });
  const txt = await res.text();
  console.log(`HTTP ${res.status} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  console.log(txt.slice(0, 800));
} catch (e) {
  console.log("FETCH ERROR:", e instanceof Error ? e.message : String(e));
}
process.exit(0);
