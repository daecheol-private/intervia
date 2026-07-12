/**
 * 쿠키 자(jar) 를 가진 최소 HTTP 클라이언트 — 역할별(관리자/멤버/지원자) 독립 세션.
 * 모든 요청에 Origin 헤더를 실어 proxy.ts 의 CSRF Origin 검증을 통과한다.
 */
import { BASE } from "./env";

export type Res = {
  status: number;
  headers: Headers;
  /** JSON 응답이면 파싱된 객체, 아니면 원문 텍스트 */
  body: unknown;
  text: string;
};

export class Client {
  private jar = new Map<string, string>();

  constructor(private base: string = BASE) {}

  private cookieHeader(): string {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  private absorbCookies(res: Response) {
    for (const sc of res.headers.getSetCookie()) {
      const [pair, ...attrs] = sc.split(";").map((s) => s.trim());
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      const expired =
        attrs.some((a) => /^max-age=0$/i.test(a)) ||
        attrs.some((a) => {
          const m = a.match(/^expires=(.+)$/i);
          return m ? new Date(m[1]).getTime() < Date.now() : false;
        });
      if (expired || value === "") this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }

  async req(
    method: string,
    path: string,
    opts: { json?: unknown; form?: FormData; headers?: Record<string, string> } = {}
  ): Promise<Res> {
    const headers: Record<string, string> = {
      Origin: this.base,
      ...(opts.headers ?? {}),
    };
    const cookie = this.cookieHeader();
    if (cookie) headers.Cookie = cookie;
    let body: BodyInit | undefined;
    if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.json);
    } else if (opts.form) {
      body = opts.form; // fetch 가 multipart boundary 포함 Content-Type 자동 세팅
    }
    const res = await fetch(this.base + path, { method, headers, body, redirect: "manual" });
    this.absorbCookies(res);
    const text = await res.text();
    let parsed: unknown = text;
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      try {
        parsed = JSON.parse(text);
      } catch {
        /* keep text */
      }
    }
    return { status: res.status, headers: res.headers, body: parsed, text };
  }

  get(path: string, headers?: Record<string, string>) {
    return this.req("GET", path, { headers });
  }
  post(path: string, json?: unknown, headers?: Record<string, string>) {
    return this.req("POST", path, { json, headers });
  }
  postForm(path: string, form: FormData, headers?: Record<string, string>) {
    return this.req("POST", path, { form, headers });
  }
  put(path: string, json?: unknown) {
    return this.req("PUT", path, { json });
  }
  patch(path: string, json?: unknown) {
    return this.req("PATCH", path, { json });
  }
  del(path: string, json?: unknown) {
    return this.req("DELETE", path, { json });
  }

  hasCookie(name: string) {
    return this.jar.has(name);
  }

  getCookie(name: string) {
    return this.jar.get(name);
  }

  async login(email: string, password: string) {
    return this.post("/api/auth/login", { email, password });
  }
}

/** 본문 객체 필드 접근 헬퍼 (unknown → 안전 접근) */
export function field<T = unknown>(body: unknown, key: string): T | undefined {
  if (body && typeof body === "object" && key in (body as Record<string, unknown>)) {
    return (body as Record<string, T>)[key];
  }
  return undefined;
}
