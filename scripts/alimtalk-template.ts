/**
 * 알리고 카카오 알림톡 승인 템플릿 목록/본문 조회.
 * "메시지가 템플릿과 일치하지않음"(rslt=U) 디버깅용 —
 * 알리고에 실제 승인된 본문·버튼을 가져와 lib/alimtalk.ts buildMessage 출력과 글자 단위로 대조한다.
 *
 * 사용 (Set-Location D:\intervia\interviewer 선행):
 *   npx tsx scripts/alimtalk-template.ts          # 전체 템플릿
 *   npx tsx scripts/alimtalk-template.ts UJ_0779   # 특정 tpl_code
 */
import "./_load-env.mjs";

const TOKEN_URL = "https://kakaoapi.aligo.in/akv10/token/create/600/s";
const TPL_URL = "https://kakaoapi.aligo.in/akv10/template/list/";
const H = { "Content-Type": "application/x-www-form-urlencoded" };

async function main() {
  const apikey = process.env.ALIGO_API_KEY;
  const userid = process.env.ALIGO_USER_ID;
  const senderkey = process.env.ALIGO_SENDER_KEY;
  if (!apikey || !userid || !senderkey) {
    console.error("❌ ALIGO_API_KEY / ALIGO_USER_ID / ALIGO_SENDER_KEY 가 필요합니다.");
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

  const body = new URLSearchParams({ apikey, userid, token: tjson.token, senderkey });
  const tplCode = process.argv[2];
  if (tplCode) body.set("tpl_code", tplCode);

  const res = await fetch(TPL_URL, { method: "POST", headers: H, body });
  const raw = await res.text();
  console.log("─".repeat(64));
  console.log(tplCode ? `승인 템플릿 조회 (tpl_code=${tplCode})` : "승인 템플릿 전체 조회");
  console.log("─".repeat(64));
  try {
    console.log(JSON.stringify(JSON.parse(raw), null, 2));
  } catch {
    console.log(raw);
  }
}
main();
