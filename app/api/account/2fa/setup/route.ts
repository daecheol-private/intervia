import { getCurrentUser } from "@/lib/auth";
import { generateSecret, provisioningUrl } from "@/lib/totp";
import QRCode from "qrcode";

export const runtime = "nodejs";

// 새 시크릿 생성 후 클라이언트에 임시 반환. DB 저장은 /enable 에서.
// 클라이언트가 시크릿을 보관하다가 enable 호출 시 검증 코드와 함께 다시 보냄.
export async function POST() {
  const me = await getCurrentUser();
  if (!me) return new Response("로그인 필요", { status: 401 });
  const secret = generateSecret();
  const url = provisioningUrl({
    secret,
    accountName: me.email,
    issuer: "Intervia",
  });
  // otpauth URL 을 QR data URL 로 인코딩. Google Authenticator 가 스캔.
  const qrDataUrl = await QRCode.toDataURL(url, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 240,
    color: { dark: "#4f46e5", light: "#ffffff" },
  });
  return Response.json({ secret, otpauthUrl: url, qrDataUrl });
}
