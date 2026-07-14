/**
 * Re-export of the api-assertion JSON Schema as a TypeScript module so
 * downstream code can `import type { ApiAssertion } from "../schemas/api-assertion.js"`.
 *
 * The runtime contract lives in `api-assertion.schema.json`; this file is
 * the TS side of the same contract.
 */

export type ApiAssertionKind = "openapi" | "graphql" | "rest";

export type ApiAssertionOperator = "equals" | "matches" | "lte" | "gte" | "contains" | "exists" | "not_exists" | "changed";

export interface ApiAssertionRequest {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  payload?: unknown;
}

export interface ApiAssertionExpect {
  status?: number;
  body?: unknown;
  matches?: string;
  latencyMs?: number;
}

export interface ApiAssertion {
  id: string;
  kind: ApiAssertionKind;
  operation?: string;
  query?: string;
  variables?: Record<string, unknown>;
  request?: ApiAssertionRequest;
  expect: ApiAssertionExpect;
  on_step?: string;
  timeout_ms?: number;
  severity_on_fail?: "S0" | "S1" | "S2" | "S3";
}