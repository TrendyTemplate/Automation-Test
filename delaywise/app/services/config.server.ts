/**
 * S8: production configuration checks. The server refuses to start with a
 * missing or weak security setting instead of running in an unsafe state.
 */
export interface ConfigProblem {
  name: string;
  problem: string;
}

export function configProblems(env: Record<string, string | undefined> = process.env): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  const require = (name: string, why: string) => {
    if (!env[name]?.trim()) problems.push({ name, problem: `missing (${why})` });
  };
  require("SHOPIFY_API_KEY", "Shopify app credentials");
  require("SHOPIFY_API_SECRET", "verifies webhooks and sessions");
  require("SHOPIFY_APP_URL", "OAuth redirects");
  require("DATABASE_URL", "database location");
  require("RESEND_API_KEY", "sending customer emails");
  require("EMAIL_FROM_ADDRESS", "verified sender address");

  const key = env.APP_ENCRYPTION_KEY?.trim() ?? "";
  const keyBytes = /^[0-9a-f]{64}$/i.test(key) ? 32 : Buffer.from(key, "base64").length;
  if (!key) problems.push({ name: "APP_ENCRYPTION_KEY", problem: "missing (encrypts Shopify tokens and merchant secrets)" });
  else if (keyBytes !== 32) problems.push({ name: "APP_ENCRYPTION_KEY", problem: "must be 32 bytes (64 hex characters)" });

  const job = env.JOB_SECRET ?? "";
  if (job.length < 24) problems.push({ name: "JOB_SECRET", problem: "must be at least 24 random characters" });

  const url = env.SHOPIFY_APP_URL ?? "";
  if (url && !url.startsWith("https://")) problems.push({ name: "SHOPIFY_APP_URL", problem: "must use https://" });
  return problems;
}

export function assertProductionConfig(env: Record<string, string | undefined> = process.env): void {
  if (env.NODE_ENV !== "production" || env.SKIP_CONFIG_CHECK === "1") return;
  const problems = configProblems(env);
  if (problems.length) {
    const list = problems.map((p) => `  - ${p.name}: ${p.problem}`).join("\n");
    throw new Error(`Delaywise cannot start in production:\n${list}\nSee .env.example and docs/DEPLOY.md.`);
  }
}
