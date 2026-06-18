// @ts-check
// 최소 ESLint 가드 — 목적은 단 하나: React Hook 규칙 위반(react-hooks/rules-of-hooks)을
// 빌드에서 차단하는 것. 조건부 early-return 아래 useMemo/useEffect 등을 두면 런타임에
// "Rendered more hooks than during the previous render" 로 페이지가 통째로 깨지는데
// (2026-06-18 /jobs/[id] 운영 사고), Next 16 next build 는 기본 린트를 안 돌려 못 잡는다.
// vercel-build 에서 `eslint .` 로 실행 → rules-of-hooks 위반 시 빌드 실패 → 운영 미배포.
//
// 스타일/그 외 규칙은 일부러 켜지 않음(error 는 rules-of-hooks 하나뿐) — 가드만 좁고 확실하게.
import reactHooks from "eslint-plugin-react-hooks";
import tsParser from "@typescript-eslint/parser";

export default [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "drizzle/**",
      "public/**",
      ".vercel/**",
      "next-env.d.ts",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    // 최소 ruleset 이라, 풀 Next/React eslint 설정을 전제로 단 기존 disable 주석
    // (no-constant-condition 등)이 "unused directive" 로 잡힌다 — 노이즈라 끈다.
    linterOptions: { reportUnusedDisableDirectives: "off" },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      // 의존성 배열 누락은 경고만 — 빌드를 막지 않음(기존 코드에 다수 존재 가능, 가드 핵심 아님).
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];
