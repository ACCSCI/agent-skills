/**
 * Probe: API surface detection
 *
 * Detects whether the project exposes OpenAPI, GraphQL, tRPC-via-openapi,
 * or plain REST. Returns specUrl / endpoint / routeTable hints that the
 * api-verify modules consume.
 *
 * Strategy:
 *   1. Static: look for known config files (openapi.json/yaml, schema.graphql).
 *   2. Heuristic: grep package.json deps for known libraries.
 *   3. For Electron projects, infer IPC style from preload.ts.
 *
 * No network calls here — actual schema fetch is deferred to api-verify/openapi.ts.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProbeContribution } from "../types.js";

interface PackageJsonLite {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export function probeApi(root: string): ProbeContribution {
  const out: ProbeContribution = {};
  const pkg = readPackageLite(root);

  // OpenAPI / Swagger: explicit spec file at conventional paths
  const openapiCandidates = [
    "openapi.json",
    "openapi.yaml",
    "openapi.yml",
    "swagger.json",
    "swagger.yaml",
    "api/openapi.json",
    "api/openapi.yaml",
    "public/openapi.json",
  ];
  for (const candidate of openapiCandidates) {
    if (existsSync(join(root, candidate))) {
      out.api = { surface: "openapi", specUrl: `/${candidate.replace(/^public\//, "")}` };
      return out;
    }
  }

  // @nestjs/swagger or swagger-ui-express
  if (hasAny(pkg, ["@nestjs/swagger", "swagger-ui-express"])) {
    out.api = { surface: "openapi", specUrl: "/api-json" };
    return out;
  }

  // GraphQL: schema file or known dep
  const graphqlSchemaCandidates = ["schema.graphql", "schema.gql", "src/schema.graphql", "src/schema.ts"];
  for (const candidate of graphqlSchemaCandidates) {
    if (existsSync(join(root, candidate))) {
      out.api = { surface: "graphql", endpoint: "/graphql" };
      return out;
    }
  }
  if (hasAny(pkg, ["@apollo/server", "graphql-yoga", "@graphql-tools/schema"])) {
    out.api = { surface: "graphql", endpoint: "/graphql" };
    return out;
  }

  // tRPC-via-openapi: opt-in by user
  if (hasAny(pkg, ["@trpc/openapi"])) {
    out.api = { surface: "trpc-openapi", specUrl: "/api/openapi.json" };
    return out;
  }

  // tRPC without openapi → can only verify via HTTP fetch (rest fallback)
  if (hasAny(pkg, ["@trpc/server", "@trpc/client"])) {
    out.api = { surface: "rest", endpoint: "/api/trpc" };
    return out;
  }

  // Next.js API routes
  if (existsSync(join(root, "src/app/api")) || existsSync(join(root, "app/api"))) {
    out.api = { surface: "rest", endpoint: "/api" };
    return out;
  }

  // Hono (RPC) — generic REST with known mount prefix
  if (hasAny(pkg, ["hono", "@hono/node-server"])) {
    out.api = { surface: "rest", endpoint: "/api" };
    if (existsSync(join(root, "src/api/index.ts")) || existsSync(join(root, "src/server/index.ts"))) {
      // Hono daemon style: keep api endpoint as is
    }
    return out;
  }

  // Express / Fastify / Koa — generic REST
  if (hasAny(pkg, ["express", "fastify", "koa", "@nestjs/core"])) {
    out.api = { surface: "rest", endpoint: "/api" };
    return out;
  }

  // Electron IPC
  if (hasAny(pkg, ["electron"])) {
    const ipcStyle = detectIpcStyle(root);
    out.api = { surface: "none", ipc_style: ipcStyle };
    return out;
  }

  out.api = { surface: "none" };
  return out;
}

function detectIpcStyle(root: string): "typed" | "generic-bridge" | "hono-daemon" | "none" {
  const preloadCandidates = [
    "electron/preload.ts",
    "electron/preload.js",
    "src/preload/index.ts",
    "src/preload.ts",
  ];
  for (const candidate of preloadCandidates) {
    if (!existsSync(join(root, candidate))) continue;
    const text = readFileSync(join(root, candidate), "utf8");
    if (/Hono<.*>|honoClient|hc<typeof/.test(text)) return "hono-daemon";
    if (/window\.electron\.invoke/.test(text) && !/window\.api\./.test(text)) return "generic-bridge";
    if (/window\.api\b/.test(text)) return "typed";
  }
  return "none";
}

function readPackageLite(root: string): PackageJsonLite {
  try {
    return JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as PackageJsonLite;
  } catch {
    return {};
  }
}

function hasAny(pkg: PackageJsonLite, keys: string[]): boolean {
  return [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})].some((d) => keys.includes(d));
}