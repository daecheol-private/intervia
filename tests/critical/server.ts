/**
 * 테스트 전용 next dev 서버 spawn/kill — 포트 3103 (개발 서버 3003 과 완전 분리).
 * env 는 SERVER_ENV 로 명시 주입되어 .env.local 의 위험 값(TURSO/SMTP/Blob/LLM)을 무시한다.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BASE, ROOT, SERVER_ENV, TESTDB_DIR, TEST_PORT } from "./env";

let child: ChildProcess | null = null;
const PID_FILE = path.join(TESTDB_DIR, "server.pid");
const LOG_FILE = path.join(TESTDB_DIR, "server.log");

async function healthOk(timeoutMs = 2000): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.status === 200 || res.status === 503;
  } catch {
    return false;
  }
}

function killPidTree(pid: number) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already dead */
    }
  }
}

/** 이전 실행이 비정상 종료로 남긴 서버 정리 + .testdb 초기화 */
export async function resetWorkspace() {
  if (existsSync(PID_FILE)) {
    const stale = Number(readFileSync(PID_FILE, "utf8").trim());
    if (Number.isFinite(stale)) killPidTree(stale);
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (await healthOk()) {
    throw new Error(
      `포트 ${TEST_PORT} 에 알 수 없는 서버가 살아 있습니다. 수동 종료 후 재실행하세요.`
    );
  }
  // Windows 파일 락 대비 재시도 삭제
  for (let i = 0; i < 5; i++) {
    try {
      rmSync(TESTDB_DIR, { recursive: true, force: true });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  mkdirSync(TESTDB_DIR, { recursive: true });
}

export async function startServer(): Promise<void> {
  const nextBin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
  const log = createWriteStream(LOG_FILE, { flags: "a" });
  child = spawn(process.execPath, [nextBin, "dev", "-p", String(TEST_PORT)], {
    cwd: ROOT,
    env: SERVER_ENV,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  writeFileSync(PID_FILE, String(child.pid ?? ""));

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `테스트 서버가 조기 종료됨 (exit ${child.exitCode}) — ${LOG_FILE} 확인`
      );
    }
    if (await healthOk()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`테스트 서버 기동 타임아웃(180s) — ${LOG_FILE} 확인`);
}

export async function stopServer() {
  if (child?.pid) killPidTree(child.pid);
  child = null;
  try {
    rmSync(PID_FILE, { force: true });
  } catch {
    /* best-effort */
  }
}

export { LOG_FILE };
