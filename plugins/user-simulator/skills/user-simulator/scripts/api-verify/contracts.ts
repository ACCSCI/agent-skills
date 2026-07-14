/**
 * ApiAssertionResult — shared shape returned by every api-verify module.
 */

import type { ApiAssertion } from "../schemas/api-assertion.js";

export type ApiAssertionStatus = "pass" | "fail" | "skipped" | "error";

export interface ApiAssertionResult {
  assertion_id: string;
  status: ApiAssertionStatus;
  /** Wall-clock duration of the network call. */
  duration_ms: number;
  /** What we expected (echoed for round-log readability). */
  expected: unknown;
  /** What we actually observed. */
  actual?: unknown;
  /** Short message describing pass/fail. */
  message: string;
  /** Free-form evidence (status code, body excerpt, etc.). */
  evidence?: Record<string, unknown>;
}

export interface ApiVerifyContext {
  baseUrl: string;
  /** Optional headers (e.g. for auth-protected APIs). */
  headers?: Record<string, string>;
  /** Per-assertion default timeout in ms. */
  defaultTimeoutMs?: number;
  /** surface from ProjectProfile.api. */
  surface: "openapi" | "graphql" | "rest";
}

export interface ApiAssertionMeta {
  /** Used by the assertion-runner to dispatch. */
  surface: ApiAssertion["kind"];
  /** Optional operationId, query name, or REST method. */
  hint?: string;
}