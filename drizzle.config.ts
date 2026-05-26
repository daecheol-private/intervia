import type { Config } from "drizzle-kit";

const tursoUrl = process.env.TURSO_DATABASE_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN;

const config: Config = tursoUrl
  ? {
      schema: "./lib/schema.ts",
      out: "./drizzle",
      dialect: "turso",
      dbCredentials: { url: tursoUrl, authToken: tursoToken },
    }
  : {
      schema: "./lib/schema.ts",
      out: "./drizzle",
      dialect: "sqlite",
      dbCredentials: { url: "./data.db" },
    };

export default config;
