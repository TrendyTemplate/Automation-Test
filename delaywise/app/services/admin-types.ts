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

export class GraphqlError extends Error {
  readonly accessDenied: boolean;
  constructor(readonly errors: unknown) {
    const text = JSON.stringify(errors ?? "").slice(0, 300);
    super(`Shopify GraphQL error: ${text}`);
    this.accessDenied = /ACCESS_DENIED|access denied|not approved to access/i.test(text);
  }
}
/**
 * Shopify answers 403 when a request comes from outside the app's IP
 * allowlist (required for public apps since Nov 2026) or when the token was
 * revoked. Never retried; the message tells the operator where to look.
 */
export class AdminForbiddenError extends Error {
  constructor() {
    super(
      "Shopify refused the Admin API request (403). Check that this server's outgoing IP or ASN is in the app's IP allowlist in the Dev Dashboard.",
    );
  }
}

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
      if (res.status === 403) throw new AdminForbiddenError();
      const json = (await res.json()) as GraphqlResult<T>;
      // M2: any top-level error fails the call (no silent partial data).
      if (json.data && !json.errors) return json.data;
      throw new GraphqlError(json.errors);
    } catch (error) {
      if (error instanceof AdminForbiddenError) throw error;
      // The Shopify library throws its own error object for HTTP failures.
      const code = (error as { response?: { code?: number } } | null)?.response?.code;
      if (code === 403) throw new AdminForbiddenError();
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!isThrottle(message) || attempt === MAX_ATTEMPTS) throw error;
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}
