import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./drizzle/schema.ts",
  out: "./drizzle/migrations",
  dbCredentials: {
    // Require an explicit Supabase migration connection.
    // Never fall back to the historical Lovable Cloud database.
    url: process.env.SUPABASE_DB_MIGRATION_URL ?? "",
  },
});
