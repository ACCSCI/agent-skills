/**
 * GraphQL assertion runner.
 *
 * Issues a GraphQL query/mutation via the `query` field of the assertion
 * (or, if absent, uses a name-based lookup against the introspected schema
 * which is already cached in the client).
 */

import type { ApiAssertion } from "../schemas/api-assertion.js";
import type { AnyClient } from "./client-cache.js";
import type { ApiAssertionResult } from "./contracts.js";

export async function runGraphqlAssertion(
  client: AnyClient,
  assertion: ApiAssertion,
  baseUrl: string,
): Promise<ApiAssertionResult> {
  const startedAt = performance.now();
  const query = resolveQuery(client, assertion);
  if (!query) {
    return {
      assertion_id: assertion.id,
      status: "error",
      duration_ms: 0,
      expected: assertion.expect,
      message: `GraphQL: no query provided and no schema lookup for "${assertion.operation ?? "?"}"`,
    };
  }
  const variables = assertion.variables ?? {};
  const timeoutMs = assertion.timeout_ms ?? 5000;

  try {
    const res = await fetchWithTimeout(new URL("/graphql", baseUrl).toString(), {
      method: "POST",
      headers: { "content-type": "application/json", ...client.headers },
      body: JSON.stringify({ query, variables }),
    }, timeoutMs);
    const duration = Math.round(performance.now() - startedAt);
    const body = (await res.json().catch(() => ({}))) as { data?: unknown; errors?: Array<{ message: string }> };

    if (Array.isArray(body.errors) && body.errors.length > 0) {
      return {
        assertion_id: assertion.id,
        status: "fail",
        duration_ms: duration,
        expected: assertion.expect,
        actual: body.errors,
        message: `GraphQL errors: ${body.errors.map((e) => e.message).join("; ")}`,
      };
    }

    const status = res.status;
    if (assertion.expect.status !== undefined && status !== assertion.expect.status) {
      return {
        assertion_id: assertion.id,
        status: "fail",
        duration_ms: duration,
        expected: assertion.expect,
        actual: { status, body: body.data },
        message: `expected HTTP ${assertion.expect.status} got ${status}`,
      };
    }
    if (assertion.expect.latencyMs !== undefined && duration > assertion.expect.latencyMs) {
      return {
        assertion_id: assertion.id,
        status: "fail",
        duration_ms: duration,
        expected: assertion.expect,
        message: `latency ${duration}ms exceeds budget ${assertion.expect.latencyMs}ms`,
      };
    }
    return {
      assertion_id: assertion.id,
      status: "pass",
      duration_ms: duration,
      expected: assertion.expect,
      actual: body.data,
      message: `GraphQL response in ${duration}ms`,
    };
  } catch (err) {
    return {
      assertion_id: assertion.id,
      status: "error",
      duration_ms: Math.round(performance.now() - startedAt),
      expected: assertion.expect,
      message: `GraphQL request failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function resolveQuery(client: AnyClient, assertion: ApiAssertion): string | null {
  if (assertion.query) return assertion.query;
  // Without a query, we cannot reliably look up by operationId in the
  // introspected schema (it would require resolving root fields). v1 keeps
  // this conservative — caller should provide `query` explicitly.
  return null;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}