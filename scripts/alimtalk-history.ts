/**
 * 알리고 알림톡 발송 이력/상세 조회.
 * send 의 code=0 은 "접수"까지. 실제 전송상태·수신자·실패사유는 여기서 확인한다.
 *
 * 사용 (Set-Location D:\intervia\interviewer 선행):
 *   npx tsx scripts/alimtalk-history.ts             # 최근 발송 목록
 *   npx tsx scripts/alimtalk-history.ts 1385280892  # 특정 mid 상세(receiver·결과코드)
 */
import "./_load-env.mjs";

const TOKEN_URL = "https://kakaoapi.aligo.in/akv10/token/create/600/s";
const LIST_URL = "https://kakaoapi.aligo.in/akv10/history/list/";
const DETAIL_URL = "https://kakaoapi.aligo.in/akv10/history/detail/";
const H = { "Content-Type": "application/x-www-form-urlencoded" };

async function main() {
  const apikey = process.env.ALIGO_API_KEY;
  const userid = process.env.ALIGO_USER_ID;
  if (!apikey || !userid) {
    console.error("❌ ALIGO_API_KEY / ALIGO_USER_ID 가 env 에 없습니다.");
    process.exit(1);
  }

  const tres = await fetch(TOKEN_URL, {
    method: "POST",
    headers: H,
    body: new URLSearchParams({ apikey, userid }),
  });
  const tjson = (await tres.json()) as { code?: number; token?: string; message?: string };
  if (Number(tjson.code) !== 0 || !tjson.token) {
    console.error("❌ 토큰 발급 실패:", tjson.message ?? tjson.code);
    process.exit(1);
  }
  const token = tjson.token;

  const mid = process.argv[2];
  const url = mid ? DETAIL_URL : LIST_URL;
  const body = mid
    ? new URLSearchParams({ apikey, userid, token, mid })
    : new URLSearchParams({ apikey, userid, token, page: "1", page_size: "10" });

  const res = await fetch(url, { method: "POST", headers: H, body });
  const raw = await res.text();
  console.log("─".repeat(64));
  console.log(mid ? `알리고 발송 상세 (mid=${mid})` : "알리고 발송 이력 목록");
  console.log("─".repeat(64));
  try {
    console.log(JSON.stringify(JSON.parse(raw), null, 2));
  } catch {
    console.log(raw);
  }
}
main();
