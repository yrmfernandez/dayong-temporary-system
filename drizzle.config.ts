import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

loadEnvConfig(process.cwd());

// Migrations use the session pooler (DIRECT_DATABASE_URL, port 5432); the app uses the transaction pooler.
export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dbCredentials: { url: process.env.DIRECT_DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});
