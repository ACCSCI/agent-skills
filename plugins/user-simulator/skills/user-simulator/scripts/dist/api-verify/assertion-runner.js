/**
 * Assertion runner — dispatches an ApiAssertion to the right module.
 *
 * The runner is the public surface consumed by persona-loop. It hides the
 * dispatch + client-cache concern from the rest of the skill.
 */
import { ApiClientCache } from "./client-cache.js";
import { runOpenApiAssertion } from "./openapi.js";
import { runGraphqlAssertion } from "./graphql.js";
import { runRestAssertion } from "./rest.js";
export class AssertionRunner {
    cache;
    baseUrl;
    constructor(profile) {
        this.cache = new ApiClientCache(profile);
        this.baseUrl = profile.api.endpoint ?? "http://localhost:3000";
    }
    async runAll(input) {
        if (input.assertions.length === 0)
            return [];
        const client = await this.cache.get({ headers: input.headers });
        // Dispatch each assertion. Run in parallel — they don't depend on each other.
        return Promise.all(input.assertions.map((assertion) => this.runOne(client, assertion)));
    }
    async runOne(client, assertion) {
        switch (assertion.kind) {
            case "openapi":
                return runOpenApiAssertion(client, assertion, this.baseUrl);
            case "graphql":
                return runGraphqlAssertion(client, assertion, this.baseUrl);
            case "rest":
                return runRestAssertion(client, assertion, this.baseUrl);
            default: {
                // Exhaustiveness check
                const exhaustive = assertion.kind;
                void exhaustive;
                return {
                    assertion_id: assertion.id,
                    status: "error",
                    duration_ms: 0,
                    expected: undefined,
                    message: `unknown assertion kind`,
                };
            }
        }
    }
}
//# sourceMappingURL=assertion-runner.js.map