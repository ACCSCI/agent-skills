/**
 * REST assertion runner.
 *
 * Issues a plain HTTP request using `assertion.request.{method,path,payload}`
 * (or, if absent, falls back to a GET against baseUrl + path).
 */
export async function runRestAssertion(client, assertion, baseUrl) {
    const startedAt = performance.now();
    const method = assertion.request?.method ?? "GET";
    const path = assertion.request?.path ?? "/";
    const url = new URL(path, baseUrl).toString();
    const timeoutMs = assertion.timeout_ms ?? 5000;
    const init = { method, headers: { ...client.headers } };
    if (assertion.request?.payload !== undefined && method !== "GET") {
        init.headers["content-type"] = "application/json";
        init.body = JSON.stringify(assertion.request.payload);
    }
    try {
        const res = await fetchWithTimeout(url, init, timeoutMs);
        const duration = Math.round(performance.now() - startedAt);
        const body = await safeJson(res);
        if (assertion.expect.status !== undefined && res.status !== assertion.expect.status) {
            return {
                assertion_id: assertion.id,
                status: "fail",
                duration_ms: duration,
                expected: assertion.expect,
                actual: { status: res.status, body },
                message: `expected HTTP ${assertion.expect.status} got ${res.status}`,
            };
        }
        // Body exact match
        if (assertion.expect.body !== undefined && !deepEqual(body, assertion.expect.body)) {
            return {
                assertion_id: assertion.id,
                status: "fail",
                duration_ms: duration,
                expected: assertion.expect,
                actual: { status: res.status, body },
                message: `body did not match expected`,
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
            actual: body,
            message: `${method} ${path} → ${res.status} in ${duration}ms`,
        };
    }
    catch (err) {
        return {
            assertion_id: assertion.id,
            status: "error",
            duration_ms: Math.round(performance.now() - startedAt),
            expected: assertion.expect,
            message: `REST request failed: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
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
//# sourceMappingURL=rest.js.map