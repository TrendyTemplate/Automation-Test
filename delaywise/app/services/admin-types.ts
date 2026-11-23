/** The slice of the Shopify Admin API client that Delaywise uses. */
export interface AdminApi {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

export interface GraphqlResult<T> {
  data?: T;
  errors?: unknown;
}

const MAX_ATTEMPTS = 4;
let sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Tests replace the delay so retries run instantly. */
export function setRetrySleepForTests(fn: (ms: number) => Promise<unknown>) {
  sleep = fn as (ms: number) => Promise<void>;
}

function isThrottle(value: unknown): boolean {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return /THROTTLED|throttled|429|Too Many Requests/i.test(text);
}

/**
 * Runs an Admin GraphQL operation. F14: retries with backoff when Shopify
 * throttles the request (rate limit), so large stores don't fail a scan.
 */
export async function gql<T>(
  admin: AdminApi,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await admin.graphql(query, variables ? { variables } : undefined);
      if (res.status === 429) throw new Error("429 Too Many Requests");
      const json = (await res.json()) as GraphqlResult<T>;
      if (json.data && !json.errors) return json.data;
      if (json.data && !isThrottle(json.errors)) return json.data;
      throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors).slice(0, 300)}`);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!isThrottle(message) || attempt === MAX_ATTEMPTS) throw error;
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}
