import "./_load-env.mjs";
import { createClient } from "@libsql/client";
import { createCipheriv, randomBytes } from "node:crypto";

const url = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || "file:./data.db";
const authToken = process.env.TURSO_AUTH_TOKEN;
const db = createClient({ url, authToken });

const KEY_HEX = process.env.MASTER_ENCRYPTION_KEY;
if (!KEY_HEX || KEY_HEX.length !== 64) {
  console.error("MASTER_ENCRYPTION_KEY 가 32 byte hex 가 아닙니다.");
  process.exit(1);
}
const KEY = Buffer.from(KEY_HEX, "hex");
const PREFIX = "enc:v1:";

function encrypt(plain) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString("base64");
}

async function main() {
  console.log(`DB: ${url}`);
  const rows = await db.execute(
    `SELECT org_id, auth_pass FROM org_smtp_configs`
  );
  let migrated = 0;
  let skipped = 0;
  for (const r of rows.rows) {
    const pass = String(r.auth_pass ?? "");
    if (!pass) {
      skipped++;
      continue;
    }
    if (pass.startsWith(PREFIX)) {
      skipped++;
      continue;
    }
    const enc = encrypt(pass);
    await db.execute({
      sql: "UPDATE org_smtp_configs SET auth_pass = ? WHERE org_id = ?",
      args: [enc, r.org_id],
    });
    console.log(`  ✓ org ${r.org_id} 암호화 적용`);
    migrated++;
  }
  console.log(`✅ 완료 — 암호화 ${migrated}건, skip ${skipped}건`);
}

main().catch((e) => {
  console.error("❌ failed:", e);
  process.exit(1);
});
