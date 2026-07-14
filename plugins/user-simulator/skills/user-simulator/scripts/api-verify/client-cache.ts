/**
 * Client cache — builds API clients (OpenAPI / GraphQL / REST) lazily and
 * reuses them across multiple assertions within a run.
 *
 * The cache is per-run: each Story run constructs one ClientCache and shares
 * it across all api_assertions. After the run completes, the cache is GC'd.
 */

import type { ProjectProfile } from "../project-adapter/types.js";

export type AnyClient = {
  surface: "openapi" | "graphql" | "trpc-openapi" | "rest";
  baseUrl: string;
  headers: Record<string, string>;
  // Pre-fetched OpenAPI doc or GraphQL schema, if applicable.
  schema?: unknown;
};

export class ApiClientCache {
  private client: AnyClient | null = null;

  constructor(private readonly profile: Pick<ProjectProfile, "api">) {}

  async get(opts: { headers?: Record<string, string> } = {}): Promise<AnyClient> {
    if (this.client) {
      if (opts.headers) Object.assign(this.client.headers, opts.headers);
      return this.client;
    }
    this.client = await this.build(opts.headers ?? {});
    return this.client;
  }

  private async build(headers: Record<string, string>): Promise<AnyClient> {
    const surface = this.profile.api.surface;
    const baseUrl = this.profile.api.endpoint ?? `http://localhost:${guessPort(this.profile)}`;
    // AnyClient.surface is a subset of ApiSurface (excludes "none"). For
    // "none" the runner is never invoked — caller guards on api.surface.
    const client: AnyClient = { surface: surface as AnyClient["surface"], baseUrl, headers };

    if (surface === "openapi" || surface === "trpc-openapi") {
      client.schema = await fetchOpenApiSchema(baseUrl, this.profile.api.specUrl ?? "/openapi.json");
    } else if (surface === "graphql") {
      client.schema = await introspectGraphQL(baseUrl, headers);
    }
    return client;
  }
}

function guessPort(profile: Pick<ProjectProfile, "api">): number {
  return 3000;
}

async function fetchOpenApiSchema(baseUrl: string, specPath: string): Promise<unknown> {
  const url = new URL(specPath, baseUrl).toString();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OpenAPI fetch failed: ${res.status} ${res.statusText} (${url})`);
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("json")) return res.json();
  // YAML — return raw text; consumers can decide whether to parse
  return res.text();
}

async function introspectGraphQL(baseUrl: string, headers: Record<string, string>): Promise<unknown> {
  const query = `query IntrospectionQuery { __schema { types { name } } }`;
  const res = await fetch(new URL("/graphql", baseUrl).toString(), {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`GraphQL introspection failed: ${res.status} ${res.statusText}`);
  return res.json();
}