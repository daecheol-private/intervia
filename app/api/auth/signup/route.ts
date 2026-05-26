export const runtime = "nodejs";

// 신규 가입은 /api/orgs (신규 법인) 또는 /api/orgs/join-requests (기존 법인 합류) 로 이동됨.
export async function POST() {
  return new Response(
    "이 엔드포인트는 더 이상 사용되지 않습니다. /signup 페이지를 이용하세요.",
    { status: 410 }
  );
}
