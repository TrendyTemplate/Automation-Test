// Validates the Admin GraphQL operations in app/services/shopify-queries.server.ts
// against an Admin API schema file.
//
// Usage: npm run validate:graphql -- <path-to-admin-schema.json | .json.br>
// A schema can be downloaded with `shopify app` tooling or from the Shopify AI
// Toolkit repository (skills/shopify/assets/admin_2026-10.json.br).
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { buildClientSchema, parse, validate } from "graphql";

const schemaPath = process.argv[2];
if (!schemaPath) {
  console.error("Usage: npm run validate:graphql -- <admin-schema.json[.br]>");
  process.exit(2);
}
const rawBytes = readFileSync(schemaPath);
const raw = JSON.parse((schemaPath.endsWith(".br") ? brotliDecompressSync(rawBytes) : rawBytes).toString());
const schema = buildClientSchema(raw.data ?? raw);
const source = readFileSync(new URL("../app/services/shopify-queries.server.ts", import.meta.url), "utf8");

let failures = 0;
for (const [, name, body] of source.matchAll(/export const (\w+) = `#graphql([\s\S]*?)`;/g)) {
  const errors = validate(schema, parse(body));
  console.log(errors.length ? `FAIL ${name}: ${errors.map((e) => e.message).join(" | ")}` : `ok   ${name}`);
  failures += errors.length;
}
process.exit(failures ? 1 : 0);
