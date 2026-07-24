/**
 * OpenAPI assertion runner.
 *
 * Performs the actual HTTP request implied by an api_assertion of kind
 * "openapi", compares the response against the `expect` block, and returns
 * a structured ApiAssertionResult.
 *
 * The runner does NOT do TypeScript codegen (openapi-typescript) at runtime;
 * that would slow down every run. Instead, it issues the request, then
 * validates the response shape by:
 *   - status code match
 *   - latency budget
 *   - JSON-path match (simple dot-path against body)
 *   - body exact match (deep equality)
 */
export async function runOpenApiAssertion(client, assertion, baseUrl) {
    const startedAt = performance.now();
    const url = resolveOperationUrl(client, baseUrl, assertion);
    if (!url) {
        return {
            assertion_id: assertion.id,
            status: "error",
            duration_ms: 0,
            expected: assertion.expect,
            message: `OpenAPI: missing spec or unable to resolve operation "${assertion.operation ?? "?"}"`,
        };
    }
    const timeoutMs = assertion.timeout_ms ?? 5000;
    try {
        const res = await fetchWithTimeout(url, { method: "GET", headers: client.headers }, timeoutMs);
        const duration = Math.round(performance.now() - startedAt);
        const body = await safeJson(res);
        return compareResponse(assertion, res.status, body, duration);
    }
    catch (err) {
        return {
            assertion_id: assertion.id,
            status: "error",
            duration_ms: Math.round(performance.now() - startedAt),
            expected: assertion.expect,
            message: `OpenAPI request failed: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}
function resolveOperationUrl(client, baseUrl, assertion) {
    if (typeof client.schema !== "object" || !client.schema)
        return null;
    const schema = client.schema;
    const paths = schema.paths ?? {};
    for (const [path, methods] of Object.entries(paths)) {
        for (const [method, op] of Object.entries(methods)) {
            if (op?.operationId === assertion.operation) {
                return new URL(path, baseUrl).toString();
            }
            if (assertion.operation === undefined && method === "get") {
                return new URL(path, baseUrl).toString();
            }
        }
    }
    return null;
}
async function fetchWithTimeout(url, init, timeoutMs) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, signal: ac.signal });
    }
    finally {
        clearTimeout(timer);
    }
}
async function safeJson(res) {
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("json"))
        return undefined;
    try {
        return await res.json();
    }
    catch {
        return undefined;
    }
}
function compareResponse(assertion, status, body, durationMs) {
    const base = { assertion_id: assertion.id, duration_ms: durationMs, expected: assertion.expect, actual: summarize(body) };
    // Status check
    if (assertion.expect.status !== undefined && status !== assertion.expect.status) {
        return { ...base, status: "fail", message: `expected HTTP ${assertion.expect.status} got ${status}`, evidence: { status, body: base.actual } };
    }
    // Latency budget
    if (assertion.expect.latencyMs !== undefined && durationMs > assertion.expect.latencyMs) {
        return { ...base, status: "fail", message: `latency ${durationMs}ms exceeds budget ${assertion.expect.latencyMs}ms` };
    }
    // Body match
    if (assertion.expect.body !== undefined) {
        if (!deepEqual(body, assertion.expect.body)) {
            return { ...base, status: "fail", message: `body did not match expected`, evidence: { status, body: base.actual, expectedBody: assertion.expect.body } };
        }
    }
    // JSON-path match (e.g. "$.data.title" or "data.title")
    if (assertion.expect.matches) {
        const path = assertion.expect.matches.replace(/^\$\./, "");
        const value = readPath(body, path);
        if (value === undefined) {
            return { ...base, status: "fail", message: `path "${path}" not found in response body` };
        }
    }
    return { ...base, status: "pass", message: `HTTP ${status} in ${durationMs}ms` };
}
function readPath(obj, path) {
    const parts = path.split(".").filter(Boolean);
    let cur = obj;
    for (const p of parts) {
        if (cur === null || cur === undefined)
            return undefined;
        cur = cur[p];
    }
    return cur;
}
function deepEqual(a, b) {
    if (a === b)
        return true;
    if (a === null || b === null)
        return false;
    if (typeof a !== typeof b)
        return false;
    if (typeof a !== "object")
        return false;
    if (Array.isArray(a) !== Array.isArray(b))
        return false;
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length)
            return false;
        return a.every((v, i) => deepEqual(v, b[i]));
    }
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length)
        return false;
    return aKeys.every((k) => deepEqual(a[k], b[k]));
}
function summarize(obj) {
    if (obj === null || obj === undefined)
        return obj;
    if (typeof obj !== "object")
        return obj;
    if (Array.isArray(obj)) {
        if (obj.length > 10)
            return [...obj.slice(0, 10), `... (${obj.length - 10} more)`];
        return obj;
    }
    // Truncate long values for evidence readability
    const str = JSON.stringify(obj);
    if (str.length > 2000)
        return `${str.slice(0, 2000)}... (truncated)`;
    return obj;
}
//# sourceMappingURL=openapi.js.map