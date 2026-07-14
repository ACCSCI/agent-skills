import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectProject } from "../project-adapter/detect.js";
import { runOpenApiAssertion } from "../api-verify/openapi.js";
import { runGraphqlAssertion } from "../api-verify/graphql.js";
import { runRestAssertion } from "../api-verify/rest.js";
import type { AnyClient } from "../api-verify/client-cache.js";
import type { ApiAssertion } from "../../schemas/api-assertion.js";

let serverUrl: string;
let server: { url: string; close: () => void };

beforeEach(async () => {
  server = await startMockServer();
  serverUrl = server.url;
});
afterEach(() => {
  server.close();
});

function makeClient(surface: "openapi" | "graphql" | "rest", schema?: unknown): AnyClient {
  return {
    surface,
    baseUrl: serverUrl,
    headers: {},
    schema,
  };
}

describe("REST assertion", () => {
  it("passes when status matches and body matches", async () => {
    const result = await runRestAssertion(
      makeClient("rest"),
      {
        id: "get-hello",
        kind: "rest",
        request: { method: "GET", path: "/api/hello" },
        expect: { status: 200, body: { message: "hi" } },
        severity_on_fail: "S2",
      } as ApiAssertion,
      serverUrl,
    );
    expect(result.status).toBe("pass");
  });

  it("fails when status does not match", async () => {
    const result = await runRestAssertion(
      makeClient("rest"),
      {
        id: "get-404",
        kind: "rest",
        request: { method: "GET", path: "/api/missing" },
        expect: { status: 200 },
        severity_on_fail: "S2",
      } as ApiAssertion,
      serverUrl,
    );
    expect(result.status).toBe("fail");
    expect(result.message).toContain("expected HTTP 200");
  });

  it("fails when body does not match", async () => {
    const result = await runRestAssertion(
      makeClient("rest"),
      {
        id: "get-wrong-body",
        kind: "rest",
        request: { method: "GET", path: "/api/hello" },
        expect: { status: 200, body: { message: "WRONG" } },
        severity_on_fail: "S2",
      } as ApiAssertion,
      serverUrl,
    );
    expect(result.status).toBe("fail");
  });

  it("fails when latency exceeds budget", async () => {
    const result = await runRestAssertion(
      makeClient("rest"),
      {
        id: "slow",
        kind: "rest",
        request: { method: "GET", path: "/api/slow" },
        expect: { status: 200, latencyMs: 1 },
        severity_on_fail: "S2",
      } as ApiAssertion,
      serverUrl,
    );
    expect(result.status).toBe("fail");
    expect(result.message).toContain("latency");
  });
});

describe("OpenAPI assertion", () => {
  it("resolves operation by operationId", async () => {
    const schema = {
      openapi: "3.0.0",
      paths: {
        "/api/hello": { get: { operationId: "getHello" } },
      },
    };
    const result = await runOpenApiAssertion(
      makeClient("openapi", schema),
      {
        id: "openapi-hello",
        kind: "openapi",
        operation: "getHello",
        expect: { status: 200 },
        severity_on_fail: "S2",
      } as ApiAssertion,
      serverUrl,
    );
    expect(result.status).toBe("pass");
  });

  it("returns error when operation is missing", async () => {
    const result = await runOpenApiAssertion(
      makeClient("openapi", { openapi: "3.0.0", paths: {} }),
      {
        id: "missing-op",
        kind: "openapi",
        operation: "nope",
        expect: { status: 200 },
        severity_on_fail: "S2",
      } as ApiAssertion,
      serverUrl,
    );
    expect(result.status).toBe("error");
  });
});

describe("GraphQL assertion", () => {
  it("issues a query and checks for errors", async () => {
    const result = await runGraphqlAssertion(
      makeClient("graphql"),
      {
        id: "gql-hello",
        kind: "graphql",
        query: "{ hello }",
        expect: { status: 200 },
        severity_on_fail: "S2",
      } as ApiAssertion,
      serverUrl,
    );
    expect(result.status).toBe("pass");
  });

  it("returns error when no query is provided and no schema lookup", async () => {
    const result = await runGraphqlAssertion(
      makeClient("graphql"),
      {
        id: "gql-missing-query",
        kind: "graphql",
        expect: { status: 200 },
        severity_on_fail: "S2",
      } as ApiAssertion,
      serverUrl,
    );
    expect(result.status).toBe("error");
  });

  it("fails when the server returns errors", async () => {
    const result = await runGraphqlAssertion(
      makeClient("graphql"),
      {
        id: "gql-error",
        kind: "graphql",
        query: "{ fail }",
        expect: { status: 200 },
        severity_on_fail: "S2",
      } as ApiAssertion,
      serverUrl,
    );
    expect(result.status).toBe("fail");
    expect(result.message).toContain("GraphQL errors");
  });
});

// Tiny in-process HTTP server with a few canned routes used by the tests.
async function startMockServer(): Promise<{ url: string; close: () => void }> {
  const { createServer } = await import("node:http");
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/api/hello" && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "hi" }));
      return;
    }
    if (url.pathname === "/api/slow" && req.method === "GET") {
      setTimeout(() => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      }, 50);
      return;
    }
    if (url.pathname === "/graphql" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const parsed = JSON.parse(body) as { query: string };
        if (parsed.query.includes("fail")) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ errors: [{ message: "intentional test error" }] }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: { hello: "world" } }));
      });
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  if (typeof addr !== "object" || !addr) throw new Error("mock server did not bind");
  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: () => server.close(),
  };
}