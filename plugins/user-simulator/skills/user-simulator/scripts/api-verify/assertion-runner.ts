/**
 * Assertion runner — dispatches an ApiAssertion to the right module.
 *
 * The runner is the public surface consumed by persona-loop. It hides the
 * dispatch + client-cache concern from the rest of the skill.
 */

import type { ApiAssertion } from "../schemas/api-assertion.js";
import { ApiClientCache } from "./client-cache.js";
import { runOpenApiAssertion } from "./openapi.js";
import { runGraphqlAssertion } from "./graphql.js";
import { runRestAssertion } from "./rest.js";
import type { ApiAssertionResult } from "./contracts.js";
import type { ProjectProfile } from "../project-adapter/types.js";

export interface RunAssertionsInput {
  profile: Pick<ProjectProfile, "api">;
  assertions: ApiAssertion[];
  headers?: Record<string, string>;
}

export class AssertionRunner {
  private readonly cache: ApiClientCache;
  private readonly baseUrl: string;

  constructor(profile: Pick<ProjectProfile, "api">) {
    this.cache = new ApiClientCache(profile);
    this.baseUrl = profile.api.endpoint ?? "http://localhost:3000";
  }

  async runAll(input: { assertions: ApiAssertion[]; headers?: Record<string, string> }): Promise<ApiAssertionResult[]> {
    if (input.assertions.length === 0) return [];
    const client = await this.cache.get({ headers: input.headers });

    // Dispatch each assertion. Run in parallel — they don't depend on each other.
    return Promise.all(
      input.assertions.map((assertion) => this.runOne(client, assertion)),
    );
  }

  private async runOne(client: Awaited<ReturnType<ApiClientCache["get"]>>, assertion: ApiAssertion): Promise<ApiAssertionResult> {
    switch (assertion.kind) {
      case "openapi":
        return runOpenApiAssertion(client, assertion, this.baseUrl);
      case "graphql":
        return runGraphqlAssertion(client, assertion, this.baseUrl);
      case "rest":
        return runRestAssertion(client, assertion, this.baseUrl);
      default: {
        // Exhaustiveness check
        const exhaustive: never = assertion.kind;
        void exhaustive;
        return {
          assertion_id: (assertion as { id: string }).id,
          status: "error",
          duration_ms: 0,
          expected: undefined,
          message: `unknown assertion kind`,
        };
      }
    }
  }
}