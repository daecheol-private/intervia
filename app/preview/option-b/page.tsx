/**
 * 옵션 B — Deep Forest + Ivory (Greenhouse·Patagonia 톤, 산세리프 정석)
 *
 * Primary:  #0D4F3C  forest
 * Accent:   #E8A87C  apricot
 * Surface:  #FBF9F5  ivory
 * Ink:      #0F1A14
 */

const C = {
  primary: "#0D4F3C",
  primaryDeep: "#073529",
  accent: "#E8A87C",
  surface: "#FBF9F5",
  surfaceAlt: "#F1EDE4",
  card: "#FFFFFF",
  ink: "#0F1A14",
  inkSoft: "#4A5A52",
  border: "#E3DDD0",
};

const fontBody = {
  fontFamily:
    "'Pretendard Variable', Pretendard, -apple-system, system-ui, sans-serif",
  color: C.ink,
};

export default function OptionBPage() {
  return (
    <main style={{ background: C.surface, ...fontBody }} className="min-h-screen">
      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-24 pb-20">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border text-xs" style={{ borderColor: C.border, background: C.card, color: C.inkSoft }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: C.primary }} />
          AI 채용 면접 플랫폼
        </div>
        <h1 className="mt-6 text-5xl sm:text-6xl lg:text-7xl tracking-[-0.03em] leading-[1.05] font-bold">
          지원자와의 첫 대화를,
          <br />
          <span style={{ color: C.primary }}>AI 면접관에게</span> 맡기세요.
        </h1>
        <p className="mt-6 text-lg max-w-2xl leading-relaxed" style={{ color: C.inkSoft }}>
          이력서 자동 평가부터 채팅 기반 면접, 결과 리포트까지 한 번에.
          채용 담당자가 진짜 중요한 결정에 집중하도록 돕습니다.
        </p>
        <div className="mt-10 flex gap-3">
          <button
            className="px-6 py-3 rounded-lg text-sm font-semibold transition-colors"
            style={{ background: C.primary, color: C.surface }}
          >
            무료로 시작하기
          </button>
          <button
            className="px-6 py-3 rounded-lg text-sm font-semibold border-2 transition-colors"
            style={{ borderColor: C.ink, color: C.ink, background: "transparent" }}
          >
            데모 보기 →
          </button>
        </div>
        <p className="mt-6 text-xs" style={{ color: C.inkSoft }}>
          가입 즉시 100토큰(약 10,000원) 제공 · 신용카드 등록 불필요
        </p>
      </section>

      {/* Pricing card */}
      <section className="max-w-6xl mx-auto px-6 pb-20">
        <div
          className="rounded-2xl p-10 grid md:grid-cols-[auto_1fr] gap-10 items-center"
          style={{ background: C.primary, color: C.surface }}
        >
          <div>
            <div className="text-xs uppercase tracking-widest" style={{ color: C.accent }}>
              법인 첫 등록 시
            </div>
            <div className="mt-2 text-5xl font-bold tabular-nums">
              100 <span style={{ fontSize: "0.5em", fontWeight: 500 }}>토큰</span>
            </div>
            <div className="text-sm mt-1 opacity-80">
              ≈ 10,000원
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { l: "공고", v: "10건" },
              { l: "이력서 평가", v: "20건" },
              { l: "AI 면접", v: "3건" },
            ].map((x) => (
              <div
                key={x.l}
                className="rounded-xl p-5 text-center"
                style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}
              >
                <div className="text-[11px] uppercase tracking-wider opacity-70">
                  {x.l}
                </div>
                <div className="mt-2 text-2xl font-bold tabular-nums">{x.v}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Table sample */}
      <section className="max-w-6xl mx-auto px-6 pb-20">
        <h2 className="text-2xl font-bold tracking-tight mb-6">
          기능별 단가
        </h2>
        <div className="rounded-2xl overflow-hidden" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: C.surfaceAlt }}>
                <th className="text-left px-6 py-4 font-semibold text-xs uppercase tracking-wider" style={{ color: C.inkSoft }}>
                  기능
                </th>
                <th className="text-right px-6 py-4 font-semibold text-xs uppercase tracking-wider" style={{ color: C.inkSoft }}>
                  토큰
                </th>
                <th className="text-right px-6 py-4 font-semibold text-xs uppercase tracking-wider" style={{ color: C.inkSoft }}>
                  원화 환산
                </th>
                <th className="text-left px-6 py-4 font-semibold text-xs uppercase tracking-wider" style={{ color: C.inkSoft }}>
                  설명
                </th>
              </tr>
            </thead>
            <tbody style={{ borderTop: `1px solid ${C.border}` }}>
              {[
                ["공고 등록", "10", "1,000원", "공고 1건 게시"],
                ["이력서 평가", "5", "500원", "PDF 업로드 + AI 서류 평가"],
                ["AI 면접", "30", "3,000원", "후보자 1명 채팅 면접 1회"],
              ].map((r, i) => (
                <tr key={r[0]} style={{ borderTop: i ? `1px solid ${C.border}` : "none" }}>
                  <td className="px-6 py-4 font-semibold">{r[0]}</td>
                  <td className="px-6 py-4 text-right tabular-nums font-bold" style={{ color: C.primary }}>
                    {r[1]}
                  </td>
                  <td className="px-6 py-4 text-right tabular-nums" style={{ color: C.inkSoft }}>
                    {r[2]}
                  </td>
                  <td className="px-6 py-4 text-sm" style={{ color: C.inkSoft }}>
                    {r[3]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* UI 컴포넌트 샘플 */}
      <section className="max-w-6xl mx-auto px-6 pb-32">
        <h2 className="text-2xl font-bold tracking-tight mb-6">
          UI 컴포넌트
        </h2>
        <div
          className="rounded-2xl p-8 grid sm:grid-cols-2 gap-8"
          style={{ background: C.card, border: `1px solid ${C.border}` }}
        >
          <div>
            <div className="text-xs uppercase tracking-wider mb-3 font-semibold" style={{ color: C.inkSoft }}>
              버튼
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: C.primary, color: C.surface }}>
                Primary
              </button>
              <button className="px-4 py-2 rounded-lg text-sm font-semibold border-2" style={{ borderColor: C.ink, color: C.ink }}>
                Secondary
              </button>
              <button className="px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: C.accent, color: C.ink }}>
                Accent
              </button>
              <button className="px-4 py-2 rounded-lg text-sm font-semibold" style={{ color: C.primary }}>
                Ghost →
              </button>
            </div>

            <div className="text-xs uppercase tracking-wider mb-3 mt-6 font-semibold" style={{ color: C.inkSoft }}>
              뱃지
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md" style={{ background: C.primary + "1A", color: C.primary }}>
                ACTIVE
              </span>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md" style={{ background: C.accent + "30", color: "#7A4A1F" }}>
                새로움
              </span>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md" style={{ background: "#FEE2E2", color: "#991B1B" }}>
                정지
              </span>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md uppercase tracking-wider" style={{ background: C.ink, color: C.surface }}>
                System Admin
              </span>
            </div>
          </div>

          <div>
            <div className="text-xs uppercase tracking-wider mb-3 font-semibold" style={{ color: C.inkSoft }}>
              입력 필드
            </div>
            <input
              className="w-full px-4 py-3 rounded-lg text-sm focus:outline-none transition-colors"
              style={{ background: C.surface, border: `1.5px solid ${C.border}`, color: C.ink }}
              placeholder="회사 이메일"
              defaultValue="kang@sample.co.kr"
            />
            <div className="mt-3 p-4 rounded-lg" style={{ background: C.surfaceAlt, border: `1px solid ${C.border}` }}>
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-semibold" style={{ color: C.inkSoft }}>잔액</span>
                <span className="text-2xl font-bold tabular-nums">1,247</span>
              </div>
              <div className="text-xs mt-1" style={{ color: C.inkSoft }}>
                전월 대비 +312 토큰
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer-ish */}
      <footer className="border-t" style={{ borderColor: C.border, background: C.surfaceAlt }}>
        <div className="max-w-6xl mx-auto px-6 py-12 text-xs" style={{ color: C.inkSoft }}>
          © 2026 Intervia · 대표 강대철 · 옵션 B — Deep Forest + Ivory
        </div>
      </footer>
    </main>
  );
}
