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

export async function gql<T>(
  admin: AdminApi,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await admin.graphql(query, variables ? { variables } : undefined);
  const json = (await res.json()) as GraphqlResult<T>;
  if (!json.data) {
    throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors).slice(0, 300)}`);
  }
  return json.data;
}
