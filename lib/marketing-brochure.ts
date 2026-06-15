// 마케팅 브로셔 메일 — 디자인 원본: D:\intervia\marketing\brochure-email.html (동기화 유지)
// 발송 전 footer 의 [회사명/주소/사업자등록번호]·[담당자 이메일] 을 실제 값으로 교체할 것.

export const MARKETING_MAIL_SUBJECT =
  "(광고) Intervia — 채용 사이클의 80%를 자동화하는 AI 면접 플랫폼";

export function renderBrochureHtml(unsubscribeUrl: string): string {
  return BROCHURE_HTML.replaceAll("{{UNSUBSCRIBE_URL}}", unsubscribeUrl);
}

const BROCHURE_HTML = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css">
<title>Intervia — AI 채용 면접 플랫폼</title>
</head>
<body style="margin:0;padding:0;background-color:#efeae0;">

<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">
AI 이력서 평가·AI 면접·일정 조율·질문 생성 — 채용 사이클의 80%를 자동화하세요.
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#efeae0">
<tr><td align="center" style="padding:36px 12px;">

<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

  <tr><td bgcolor="#073529" style="border-radius:24px 24px 0 0;padding:44px 44px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td style="font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic','Segoe UI',sans-serif;font-size:19px;font-weight:bold;color:#ffffff;letter-spacing:-0.3px;">
        Intervia
      </td>
      <td align="right" style="font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:3px;color:#7da394;">
        AI INTERVIEW PLATFORM
      </td>
    </tr>
    <tr><td colspan="2" style="padding-top:52px;font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic','Segoe UI',sans-serif;font-size:37px;line-height:1.25;font-weight:bold;color:#ffffff;letter-spacing:-1.2px;">
      지원자와의 첫 대화를,<br>
      <span style="color:#e8a87c;">AI 면접관</span>에게 맡기세요.
    </td></tr>
    <tr><td colspan="2" style="padding-top:18px;font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic','Segoe UI',sans-serif;font-size:15px;line-height:1.7;color:#9db8ad;">
      AI 이력서 평가, AI 면접, 일정 조율, 질문 생성 —<br>채용 사이클의 80%를 자동화합니다.
    </td></tr>
    <tr><td colspan="2" style="padding-top:30px;">
      <a href="https://intervia.kr/signup" target="_blank" style="display:inline-block;font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic','Segoe UI',sans-serif;font-size:14px;font-weight:bold;color:#073529;text-decoration:none;background-color:#e8a87c;padding:15px 34px;border-radius:999px;">
        무료로 시작하기&nbsp;&nbsp;→
      </a>
    </td></tr>

    <tr><td colspan="2" style="padding-top:42px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0d4f3c" style="border-radius:18px 18px 0 0;">
      <tr><td style="padding:14px 20px;border-bottom:1px solid rgba(255,255,255,0.08);">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td width="60">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
              <td style="width:10px;height:10px;border-radius:99px;background-color:#ff5f57;font-size:1px;line-height:10px;">&nbsp;</td>
              <td width="6"></td>
              <td style="width:10px;height:10px;border-radius:99px;background-color:#febc2e;font-size:1px;line-height:10px;">&nbsp;</td>
              <td width="6"></td>
              <td style="width:10px;height:10px;border-radius:99px;background-color:#28c840;font-size:1px;line-height:10px;">&nbsp;</td>
            </tr></table>
          </td>
          <td align="center" style="font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic','Segoe UI',sans-serif;font-size:11px;color:#9db8ad;">
            AI 면접 — 백엔드 개발자
          </td>
          <td width="60" align="right" style="font-family:Helvetica,Arial,sans-serif;font-size:11px;color:#7da394;">08:42</td>
        </tr>
        </table>
      </td></tr>
      <tr><td style="padding:20px 20px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td width="38" valign="top">
            <div style="width:28px;height:28px;line-height:28px;border-radius:99px;background-color:#e3ece8;text-align:center;font-size:14px;">🤖</div>
          </td>
          <td style="background-color:#ffffff;border-radius:3px 14px 14px 14px;padding:13px 16px;font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic','Segoe UI',sans-serif;font-size:13px;line-height:1.65;color:#0f1a14;max-width:400px;">
            이력서에 적어주신 <span style="font-weight:bold;color:#0d4f3c;">주문 시스템 지연 개선</span> 경험이 인상적이에요. 당시 병목은 어디였고, 어떤 접근으로 풀어내셨나요?
          </td>
        </tr>
        </table>
      </td></tr>
      <tr><td align="right" style="padding:12px 20px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="right">
        <tr>
          <td style="background-color:#e8a87c;border-radius:14px 3px 14px 14px;padding:13px 16px;font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic','Segoe UI',sans-serif;font-size:13px;line-height:1.65;color:#3d2412;max-width:360px;">
            DB 락 경합이 원인이어서 큐 기반 비동기 처리로 전환했고, 피크 시간 응답이 4초에서 0.3초로 줄었습니다.
          </td>
          <td width="38" valign="top" align="right">
            <div style="width:28px;height:28px;line-height:28px;border-radius:99px;background-color:#c98a5b;text-align:center;font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:12px;font-weight:bold;color:#ffffff;margin-left:10px;">김</div>
          </td>
        </tr>
        </table>
      </td></tr>
      <tr><td style="padding:12px 20px 22px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td width="38"></td>
          <td style="background-color:rgba(255,255,255,0.10);border-radius:99px;padding:8px 14px;font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:2px;color:#9db8ad;">
            ● ● ●
          </td>
        </tr>
        </table>
      </td></tr>
      </table>
    </td></tr>
    </table>
  </td></tr>

  <tr><td bgcolor="#fbf9f5" style="padding:40px 44px 36px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td width="33%" align="center" style="padding:4px 8px;">
        <div style="font-family:Helvetica,Arial,sans-serif;font-size:34px;font-weight:bold;color:#0d4f3c;letter-spacing:-1px;">75%</div>
        <div style="font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic','Segoe UI',sans-serif;font-size:11px;color:#8a9690;padding-top:6px;line-height:1.5;">채용 사이클 단축<br>2주 → 4일</div>
      </td>
      <td width="33%" align="center" style="padding:4px 8px;border-left:1px solid #e3ddd0;border-right:1px solid #e3ddd0;">
        <div style="font-family:Helvetica,Arial,sans-serif;font-size:34px;font-weight:bold;color:#0d4f3c;letter-spacing:-1px;">89%</div>
        <div style="font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic','Segoe UI',sans-serif;font-size:11px;color:#8a9690;padding-top:6px;line-height:1.5;">후보자 응답률<br>채팅 면접 완료 기준</div>
      </td>
      <td width="33%" align="center" style="padding:4px 8px;">
        <div style="font-family:Helvetica,Arial,sans-serif;font-size:34px;font-weight:bold;color:#0d4f3c;letter-spacing:-1px;">4.6<span style="font-size:18px;font-weight:normal;color:#b4ae9f;">/5</span></div>
        <div style="font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic','Segoe UI',sans-serif;font-size:11px;color:#8a9690;padding-top:6px;line-height:1.5;">AI 평가 정확도<br>인사담당자 만족도</div>
      </td>
    </tr>
    <tr><td colspan="3" align="center" style="padding-top:18px;font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic','Segoe UI',sans-serif;font-size:10px;color:#b4ae9f;">
      * 베타 사용자 내부 측정값
    </td></tr>
    </table>
  </td></tr>

  <!-- 사람인·잡코리아와 다른 점 (랜딩 WhyNotJobBoard 동기화) -->
  <tr><td bgcolor="#fbf9f5" style="padding:52px 44px;border-top:1px solid #e3ddd0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center" style="font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:3px;color:#c98a5b;padding-bottom:14px;">
      ✦&nbsp;&nbsp;WHY NOT A JOB BOARD
    </td></tr>
    <tr><td align="center" style="font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic','Segoe UI',sans-serif;font-size:25px;line-height:1.35;font-weight:bold;color:#0f1a14;letter-spacing:-0.7px;padding-bottom:14px;">
      공고를 올리는 곳이 아니라,<br><span style="color:#0d4f3c;">지원자를 만나보는 곳</span>입니다.
    </td></tr>
    <tr><td align="center" style="font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic','Segoe UI',sans-serif;font-size:13px;line-height:1.75;color:#4a5a52;padding-bottom:30px;">
      구인 사이트는 이력서를 <span style="font-weight:bold;color:#0f1a14;">모아주고</span> 끝납니다.<br>
      Intervia 는 그 다음 — 한 명 한 명 <span style="font-weight:bold;color:#0f1a14;">면접하고 평가</span>해 드립니다.
    </td></tr>

    <tr><td>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f0e8" style="border-radius:16px;border:1px solid #e3ddd0;">
      <tr><td style="padding:20px 22px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:10px;letter-spacing:1px;color:#b4ae9f;font-weight:bold;">구인 사이트가 주는 것</td>
          <td align="right" style="font-family:Helvetica,Arial,sans-serif;font-size:11px;color:#b4ae9f;">247명</td>
        </tr>
        <tr><td colspan="2" style="font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:17px;font-weight:bold;color:#8a9690;padding-top:3px;padding-bottom:14px;">이력서 더미</td></tr>
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="border:1px solid #ece7da;border-radius:9px;margin-bottom:8px;">
        <tr><td style="padding:11px 13px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td width="32" valign="middle"><div style="width:24px;height:24px;border-radius:99px;background-color:#e3ddd0;font-size:1px;line-height:24px;">&nbsp;</div></td>
            <td valign="middle"><div style="height:7px;width:60%;background-color:#d8d2c4;border-radius:99px;font-size:1px;line-height:7px;">&nbsp;</div></td>
          </tr></table>
        </td></tr>
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="border:1px solid #ece7da;border-radius:9px;margin-bottom:8px;">
        <tr><td style="padding:11px 13px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td width="32" valign="middle"><div style="width:24px;height:24px;border-radius:99px;background-color:#e8e3d8;font-size:1px;line-height:24px;">&nbsp;</div></td>
            <td valign="middle"><div style="height:7px;width:48%;background-color:#e0dacc;border-radius:99px;font-size:1px;line-height:7px;">&nbsp;</div></td>
          </tr></table>
        </td></tr>
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="border:1px solid #ece7da;border-radius:9px;">
        <tr><td style="padding:11px 13px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td width="32" valign="middle"><div style="width:24px;height:24px;border-radius:99px;background-color:#eee9df;font-size:1px;line-height:24px;">&nbsp;</div></td>
            <td valign="middle"><div style="height:7px;width:54%;background-color:#e6e0d3;border-radius:99px;font-size:1px;line-height:7px;">&nbsp;</div></td>
          </tr></table>
        </td></tr>
        </table>
        <div style="font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:11px;font-style:italic;color:#b4ae9f;text-align:center;padding-top:14px;">…이력서는 쌓이는데, 누가 좋은지는 직접 봐야 합니다</div>
      </td></tr>
      </table>
    </td></tr>

    <tr><td align="center" style="padding:14px 0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>
        <td style="font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:10px;letter-spacing:2px;font-weight:bold;color:#8a9690;">그 다음</td>
        <td width="9"></td>
        <td style="font-family:Helvetica,Arial,sans-serif;font-size:17px;font-weight:bold;color:#0d4f3c;">↓</td>
      </tr></table>
    </td></tr>

    <tr><td>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="border-radius:16px;border:2px solid #cfe0d8;">
      <tr><td style="padding:22px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td valign="top" style="font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;">
            <div style="font-size:10px;letter-spacing:1px;color:#0d4f3c;font-weight:bold;">Intervia 가 주는 것</div>
            <div style="font-size:17px;font-weight:bold;color:#0f1a14;padding-top:3px;">후보 ▦▦▦ <span style="font-weight:normal;font-size:12px;color:#8a9690;">· 백엔드 5년</span></div>
            <div style="font-size:11px;color:#8a9690;padding-top:2px;">AI 면접 완료 · 20분</div>
          </td>
          <td align="right" valign="top">
            <span style="display:inline-block;font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:15px;font-weight:bold;color:#0d4f3c;background-color:#e3ece8;padding:6px 13px;border-radius:999px;">4.6<span style="font-size:10px;font-weight:normal;color:#7da394;">/5</span></span>
          </td>
        </tr>
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="padding-top:18px;">
        <tr>
          <td style="font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:12px;font-weight:bold;color:#0f1a14;padding-bottom:5px;">문제해결</td>
          <td align="right" style="font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:bold;color:#0d4f3c;padding-bottom:5px;">92</td>
        </tr>
        <tr><td colspan="2" style="padding-bottom:11px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td width="92%" bgcolor="#0d4f3c" style="height:7px;border-radius:99px 0 0 99px;font-size:1px;line-height:7px;">&nbsp;</td>
            <td width="8%" bgcolor="#ece7da" style="height:7px;border-radius:0 99px 99px 0;font-size:1px;line-height:7px;">&nbsp;</td>
          </tr></table>
        </td></tr>
        <tr>
          <td style="font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:12px;font-weight:bold;color:#0f1a14;padding-bottom:5px;">커뮤니케이션</td>
          <td align="right" style="font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:bold;color:#0d4f3c;padding-bottom:5px;">100</td>
        </tr>
        <tr><td colspan="2" style="padding-bottom:11px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td bgcolor="#0d4f3c" style="height:7px;border-radius:99px;font-size:1px;line-height:7px;">&nbsp;</td>
          </tr></table>
        </td></tr>
        <tr>
          <td style="font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:12px;font-weight:bold;color:#0f1a14;padding-bottom:5px;">컬처핏</td>
          <td align="right" style="font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:bold;color:#0d4f3c;padding-bottom:5px;">84</td>
        </tr>
        <tr><td colspan="2">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td width="84%" bgcolor="#0d4f3c" style="height:7px;border-radius:99px 0 0 99px;font-size:1px;line-height:7px;">&nbsp;</td>
            <td width="16%" bgcolor="#ece7da" style="height:7px;border-radius:0 99px 99px 0;font-size:1px;line-height:7px;">&nbsp;</td>
          </tr></table>
        </td></tr>
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#fbf9f5" style="border-left:3px solid #0d4f3c;margin-top:16px;">
        <tr><td style="padding:11px 14px;font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:11px;line-height:1.6;color:#4a5a52;">
          <span style="color:#0d4f3c;font-weight:bold;">AI 요약 · </span>결제 시스템 무중단 마이그레이션 경험이 직무와 정확히 부합.
        </td></tr>
        </table>
        <div style="font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:13px;font-weight:bold;color:#0d4f3c;padding-top:14px;">✓&nbsp; 1차 면접 진행 권장</div>
      </td></tr>
      </table>
    </td></tr>

    <tr><td align="center" style="padding-top:28px;font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic','Segoe UI',sans-serif;font-size:13px;line-height:1.7;color:#8a9690;">
      사람인 · 잡코리아 · 자체 채용페이지 —<br><span style="font-weight:bold;color:#0f1a14;">어디서 지원자를 받든, 면접은 Intervia 로.</span>
    </td></tr>
    </table>
  </td></tr>

  <tr><td bgcolor="#ffffff" style="padding:52px 44px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td style="font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:3px;color:#c98a5b;padding-bottom:14px;">
      ✦&nbsp;&nbsp;4 CORE FEATURES
    </td></tr>
    <tr><td style="font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic','Segoe UI',sans-serif;font-size:25px;line-height:1.35;font-weight:bold;color:#0f1a14;letter-spacing:-0.7px;padding-bottom:34px;">
      채용에서 가장 손이 많이 가는<br>네 가지를 대신합니다.
    </td></tr>

    <tr><td style="border-top:1px solid #e3ddd0;padding:24px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td width="64" valign="top">
          <div style="width:44px;height:44px;line-height:44px;border-radius:13px;background-color:#e3ece8;text-align:center;font-size:21px;">📄</div>
        </td>
        <td style="font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic','Segoe UI',sans-serif;">
          <div style="font-size:11px;font-weight:bold;color:#c98a5b;font-family:Helvetica,Arial,sans-serif;letter-spacing:1px;padding-bottom:4px;">01</div>
          <div style="font-size:16px;font-weight:bold;color:#0f1a14;">AI 이력서 평가</div>
          <div style="font-size:13px;line-height:1.7;color:#4a5a52;padding-top:6px;">이력서 PDF를 올리면 개인정보 자동 마스킹 후, 6축 공고 적합도와 JD 요건별 충족을 근거와 함께 평가합니다.</div>
        </td>
      </tr>
      </table>
    </td></tr>

    <tr><td style="border-top:1px solid #e3ddd0;padding:24px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td width="64" valign="top">
          <div style="width:44px;height:44px;line-height:44px;border-radius:13px;background-color:#faead9;text-align:center;font-size:21px;">💬</div>
        </td>
        <td style="font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic','Segoe UI',sans-serif;">
          <div style="font-size:11px;font-weight:bold;color:#c98a5b;font-family:Helvetica,Arial,sans-serif;letter-spacing:1px;padding-bottom:4px;">02</div>
          <div style="font-size:16px;font-weight:bold;color:#0f1a14;">AI 채팅 면접</div>
          <div style="font-size:13px;line-height:1.7;color:#4a5a52;padding-top:6px;">지원자는 링크 하나로 24시간 언제든 응시하고, 종료 즉시 역량별 점수와 대화 원문 근거가 담긴 평가가 도착합니다.</div>
        </td>
      </tr>
      </table>
    </td></tr>

    <tr><td style="border-top:1px solid #e3ddd0;padding:24px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td width="64" valign="top">
          <div style="width:44px;height:44px;line-height:44px;border-radius:13px;background-color:#e2eaf2;text-align:center;font-size:21px;">📅</div>
        </td>
        <td style="font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic','Segoe UI',sans-serif;">
          <div style="font-size:11px;font-weight:bold;color:#c98a5b;font-family:Helvetica,Arial,sans-serif;letter-spacing:1px;padding-bottom:4px;">03</div>
          <div style="font-size:16px;font-weight:bold;color:#0f1a14;">면접 일정 조율</div>
          <div style="font-size:13px;line-height:1.7;color:#4a5a52;padding-top:6px;">대면 면접 일정을 제시하면 지원자가 수락하거나 시간을 역제시 — 메일 핑퐁 없이 시스템 안에서 확정됩니다.</div>
        </td>
      </tr>
      </table>
    </td></tr>

    <tr><td style="border-top:1px solid #e3ddd0;border-bottom:1px solid #e3ddd0;padding:24px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td width="64" valign="top">
          <div style="width:44px;height:44px;line-height:44px;border-radius:13px;background-color:#e3ece8;text-align:center;font-size:21px;">✏️</div>
        </td>
        <td style="font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic','Segoe UI',sans-serif;">
          <div style="font-size:11px;font-weight:bold;color:#c98a5b;font-family:Helvetica,Arial,sans-serif;letter-spacing:1px;padding-bottom:4px;">04</div>
          <div style="font-size:16px;font-weight:bold;color:#0f1a14;">면접 질문 생성</div>
          <div style="font-size:13px;line-height:1.7;color:#4a5a52;padding-top:6px;">공고와 지원자 정보를 반영한 대면 면접용 맞춤 질문지를 AI가 만들어 드립니다.</div>
        </td>
      </tr>
      </table>
    </td></tr>
    </table>
  </td></tr>

  <tr><td bgcolor="#fbf9f5" style="padding:48px 44px;border-top:1px solid #e3ddd0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center" style="font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:3px;color:#c98a5b;padding-bottom:14px;">
      ✦&nbsp;&nbsp;AI RESUME SCREENING
    </td></tr>
    <tr><td align="center" style="font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic','Segoe UI',sans-serif;font-size:25px;line-height:1.35;font-weight:bold;color:#0f1a14;letter-spacing:-0.7px;padding-bottom:28px;">
      이력서 한 장에서,<br>이만큼 깊이 읽어냅니다.
    </td></tr>
    <tr><td>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="border-radius:18px;border:1px solid #e3ddd0;">
      <tr><td style="padding:24px 26px 18px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic','Segoe UI',sans-serif;">
            <div style="font-size:11px;color:#8a9690;">AI 이력서 평가 — 공고 적합도 6축</div>
            <div style="font-size:16px;font-weight:bold;color:#0f1a14;padding-top:3px;">김◯◯ <span style="font-weight:normal;font-size:12px;color:#8a9690;">· 백엔드 개발자 지원</span></div>
          </td>
          <td align="right" valign="top">
            <span style="display:inline-block;font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:12px;font-weight:bold;color:#ffffff;background-color:#0d4f3c;padding:7px 14px;border-radius:999px;">서류 통과 권장</span>
          </td>
        </tr>
        </table>
      </td></tr>
      <tr><td style="padding:0 26px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;">
        <tr>
          <td style="font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:13px;font-weight:bold;color:#0f1a14;padding-bottom:6px;">기술 적합도 <span style="font-size:11px;font-weight:normal;color:#b4ae9f;">20%</span></td>
          <td align="right" style="font-family:Helvetica,Arial,sans-serif;font-size:16px;font-weight:bold;color:#0d4f3c;padding-bottom:6px;">78</td>
        </tr>
        <tr><td colspan="2" style="padding-bottom:7px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="78%" bgcolor="#0d4f3c" style="height:8px;border-radius:99px 0 0 99px;font-size:1px;line-height:8px;">&nbsp;</td>
            <td width="22%" bgcolor="#ece7da" style="height:8px;border-radius:0 99px 99px 0;font-size:1px;line-height:8px;">&nbsp;</td>
          </tr>
          </table>
        </td></tr>
        <tr>
          <td style="font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:11px;line-height:1.6;color:#8a9690;">요구 스택(Node·MySQL) 실무 경험이 명확함</td>
          <td align="right" valign="top"><span style="display:inline-block;font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:10px;font-weight:bold;color:#0d4f3c;background-color:#e3ece8;padding:3px 9px;border-radius:6px;">근거 충분</span></td>
        </tr>
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;">
        <tr>
          <td style="font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:13px;font-weight:bold;color:#0f1a14;padding-bottom:6px;">직무 매칭도 <span style="font-size:11px;font-weight:normal;color:#b4ae9f;">25%</span></td>
          <td align="right" style="font-family:Helvetica,Arial,sans-serif;font-size:16px;font-weight:bold;color:#c98a5b;padding-bottom:6px;">64</td>
        </tr>
        <tr><td colspan="2" style="padding-bottom:7px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="64%" bgcolor="#e8a87c" style="height:8px;border-radius:99px 0 0 99px;font-size:1px;line-height:8px;">&nbsp;</td>
            <td width="36%" bgcolor="#ece7da" style="height:8px;border-radius:0 99px 99px 0;font-size:1px;line-height:8px;">&nbsp;</td>
          </tr>
          </table>
        </td></tr>
        <tr>
          <td style="font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:11px;line-height:1.6;color:#8a9690;">대규모 트래픽 처리 경험은 면접에서 확인 권장</td>
          <td align="right" valign="top"><span style="display:inline-block;font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:10px;font-weight:bold;color:#c98a5b;background-color:#faead9;padding:3px 9px;border-radius:6px;">근거 보통</span></td>
        </tr>
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:13px;font-weight:bold;color:#0f1a14;padding-bottom:6px;">성장·태도 <span style="font-size:11px;font-weight:normal;color:#b4ae9f;">10%</span></td>
          <td align="right" style="font-family:Helvetica,Arial,sans-serif;font-size:16px;font-weight:bold;color:#0d4f3c;padding-bottom:6px;">85</td>
        </tr>
        <tr><td colspan="2" style="padding-bottom:7px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="85%" bgcolor="#0d4f3c" style="height:8px;border-radius:99px 0 0 99px;font-size:1px;line-height:8px;">&nbsp;</td>
            <td width="15%" bgcolor="#ece7da" style="height:8px;border-radius:0 99px 99px 0;font-size:1px;line-height:8px;">&nbsp;</td>
          </tr>
          </table>
        </td></tr>
        <tr>
          <td style="font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:11px;line-height:1.6;color:#8a9690;">지속적인 학습과 기술 블로그 운영이 돋보임</td>
          <td align="right" valign="top"><span style="display:inline-block;font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:10px;font-weight:bold;color:#0d4f3c;background-color:#e3ece8;padding:3px 9px;border-radius:6px;">근거 충분</span></td>
        </tr>
        </table>
        <div style="font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:11px;color:#b4ae9f;padding-top:14px;">+ 경험 깊이 · 성과 임팩트 · 재직 안정성 3개 축 추가 평가</div>
      </td></tr>
      <tr><td style="padding:18px 26px 22px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #ece7da;">
        <tr><td style="padding-top:18px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="62" valign="middle">
              <div style="width:48px;height:48px;line-height:44px;border:3px solid #0d4f3c;border-radius:99px;text-align:center;font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:bold;color:#0d4f3c;">50%</div>
            </td>
            <td valign="middle" style="font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;">
              <div style="font-size:13px;font-weight:bold;color:#0f1a14;">JD 요건별 충족</div>
              <div style="font-size:11px;color:#8a9690;padding-top:3px;"><span style="color:#0d4f3c;">●</span> 직접 부합 2 &nbsp;·&nbsp; <span style="color:#e8a87c;">●</span> 간접 부합 3 &nbsp;·&nbsp; <span style="color:#cfc7b5;">●</span> 근거 없음 2</div>
            </td>
          </tr>
          </table>
        </td></tr>
        <tr><td style="padding-top:14px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#fbf9f5" style="border-left:3px solid #0d4f3c;">
          <tr><td style="padding:10px 14px;font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;">
            <span style="font-size:12px;font-weight:bold;color:#0f1a14;">✓ Python 개발</span>
            <span style="font-size:11px;color:#8a9690;">&nbsp;— 배치 스크립트 작성·스케줄러 운영 경험</span>
          </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding-top:8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#fbf9f5" style="border-left:3px solid #cfc7b5;">
          <tr><td style="padding:10px 14px;font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;">
            <span style="font-size:12px;font-weight:bold;color:#8a9690;">− Playbook 개발 및 커스터마이징</span>
            <span style="font-size:11px;color:#b4ae9f;">&nbsp;— 이력서에서 근거를 찾지 못함, 면접 확인 권장</span>
          </td></tr>
          </table>
        </td></tr>
        </table>
      </td></tr>
      </table>
      <div style="text-align:center;font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:11px;color:#b4ae9f;padding-top:12px;">
        AI 이력서 평가 화면 예시 — 모든 점수에 근거 문장이 함께 제공됩니다
      </div>
    </td></tr>
    </table>
  </td></tr>

  <tr><td bgcolor="#073529" style="padding:52px 44px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center" style="font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:3px;color:#e8a87c;padding-bottom:18px;">
      ✦&nbsp;&nbsp;GET STARTED
    </td></tr>
    <tr><td align="center" style="font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic','Segoe UI',sans-serif;font-size:44px;font-weight:bold;color:#ffffff;letter-spacing:-1.2px;line-height:1;">
      500토큰 <span style="color:#e8a87c;">무료</span>
    </td></tr>
    <tr><td align="center" style="padding-top:16px;font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic','Segoe UI',sans-serif;font-size:13px;line-height:2;color:#9db8ad;">
      법인 첫 등록 시 5만원 상당 제공 · 쓴 만큼만, 이력서 평가 1건 5토큰<br>
      <span style="color:#e8a87c;">✓</span> 구독료 없음 &nbsp;&nbsp;<span style="color:#e8a87c;">✓</span> 신용카드 불필요 &nbsp;&nbsp;<span style="color:#e8a87c;">✓</span> 실패 시 자동 환불
    </td></tr>
    <tr><td align="center" style="padding-top:28px;">
      <a href="https://intervia.kr/signup" target="_blank" style="display:inline-block;font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic','Segoe UI',sans-serif;font-size:14px;font-weight:bold;color:#073529;text-decoration:none;background-color:#e8a87c;padding:15px 38px;border-radius:999px;">
        무료로 시작하기&nbsp;&nbsp;→
      </a>
    </td></tr>
    <tr><td align="center" style="padding-top:16px;font-family:Helvetica,Arial,sans-serif;font-size:12px;">
      <a href="https://intervia.kr" target="_blank" style="color:#7da394;text-decoration:underline;">intervia.kr</a>
    </td></tr>
    </table>
  </td></tr>

  <tr><td bgcolor="#fbf9f5" style="padding:24px 44px;border-radius:0 0 24px 24px;border-top:1px solid #e3ddd0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center" style="font-family:'Pretendard Variable',Pretendard,'Apple SD Gothic Neo','Malgun Gothic','Segoe UI',sans-serif;font-size:11px;line-height:1.8;color:#8a9690;">
      Intervia · [회사명 / 주소 / 사업자등록번호] · 문의: [담당자 이메일]<br>
      본 메일은 채용 담당자분들께 서비스를 소개해 드리기 위해 발송되었습니다.<br>
      수신을 원치 않으시면 <a href="{{UNSUBSCRIBE_URL}}" style="color:#4a5a52;font-weight:bold;">수신거부</a>를 눌러 주세요.
    </td></tr>
    </table>
  </td></tr>

</table>

</td></tr>
</table>

</body>
</html>
`;
