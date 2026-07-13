/**
 * Infra-level failure classifier.
 *
 * Reuses the rule structure from electron-e2e-scaffold/templates/failure-classifier.ts.hbs
 * and the production-grade regex patterns common to Electron projects
 * (Electron crash, port contention, GPU sandbox, IPC timeouts).
 *
 * IMPORTANT: this module ONLY classifies infrastructure failures. Product bugs
 * are handled by bug-detector.ts. An infra failure makes the run INCONCLUSIVE
 * and never enters the product bug list.
 */

import type { InfraFailure, InfraFailureKind } from "../common/contracts.js";

export interface InfraClassification {
  kind: InfraFailureKind;
  confidence: number;
  reason: string;
  suggestedAction: "retry" | "skip" | "fix" | "investigate";
  relatedFiles?: string[];
}

interface ClassificationRule {
  pattern: RegExp;
  kind: InfraFailureKind;
  action: InfraClassification["suggestedAction"];
  confidence?: number;
  hint: string;
}

const DEFAULT_RULES: ClassificationRule[] = [
  // Playwright / browser binary
  { pattern: /browser.*not.*installed|Executable doesn't exist/i, kind: "browser_missing", action: "fix", confidence: 0.95, hint: "Run `npx playwright install <browser>`." },
  { pattern: /playwright.*not.*installed|cannot find module 'playwright/i, kind: "playwright_not_installed", action: "fix", confidence: 0.95, hint: "Install Playwright in the skill's scripts/ via `npm install`." },

  // Port / lock conflicts
  { pattern: /EADDRINUSE|address already in use/i, kind: "port_conflict", action: "skip", confidence: 0.95, hint: "Kill any process listening on the target port." },
  { pattern: /EBUSY|EPERM|EACCES/i, kind: "port_conflict", action: "skip", confidence: 0.85, hint: "File lock or permission issue — check the userDataDir or temp dir." },
  { pattern: /ENOENT.*node_modules/i, kind: "playwright_not_installed", action: "fix", confidence: 0.9, hint: "Run `npm install` inside the target project's e2e dir." },

  // Electron launch
  { pattern: /Electron failed to launch|cannot find module .*electron\/dist/i, kind: "electron_launch_failed", action: "fix", confidence: 0.95, hint: "Reinstall electron or verify the entry path." },
  { pattern: /GPU process crashed|GPU sandbox/i, kind: "electron_launch_failed", action: "retry", confidence: 0.7, hint: "Disable GPU sandbox: --no-sandbox or app.commandLine.appendSwitch('disable-gpu')." },
  { pattern: /Renderer process gone|Target closed|Session closed/i, kind: "electron_launch_failed", action: "retry", confidence: 0.7, hint: "Renderer crashed during launch — inspect crash dump; consider retry." },

  // Network reachability (target URL)
  { pattern: /net::ERR_CONNECTION_REFUSED|net::ERR_NAME_NOT_RESOLVED|getaddrinfo ENOTFOUND/i, kind: "target_unreachable", action: "skip", confidence: 0.95, hint: "Start the dev server / Electron app before launching user-simulator." },
  { pattern: /Navigation timeout|page\.waitForURL.*timeout/i, kind: "target_unreachable", action: "skip", confidence: 0.85, hint: "The target URL never reached the expected state." },

  // Generic timeout with no evidence
  { pattern: /timeout|exceeded.*\d+ms/i, kind: "timeout_no_evidence", action: "investigate", confidence: 0.5, hint: "Timeout occurred without capturing a stable state — increase budget or investigate." },

  // Harness / unexpected exception
  { pattern: /harness|TypeError.*cli|unhandledRejection/i, kind: "harness_exception", action: "investigate", confidence: 0.8, hint: "user-simulator CLI itself errored — inspect stack." },
];

export function classifyInfra(input: {
  errorMessage: string;
  stackTrace?: string;
  testPath?: string;
}): InfraClassification {
  const combined = `${input.errorMessage}\n${input.stackTrace ?? ""}`;
  for (const rule of DEFAULT_RULES) {
    if (rule.pattern.test(combined)) {
      return {
        kind: rule.kind,
        confidence: rule.confidence ?? 0.8,
        reason: `Matched pattern: ${rule.pattern.source}`,
        suggestedAction: rule.action,
        relatedFiles: extractRelatedFiles(input.stackTrace ?? ""),
      };
    }
  }
  return {
    kind: "harness_exception",
    confidence: 0.4,
    reason: "No infra pattern matched",
    suggestedAction: "investigate",
    relatedFiles: extractRelatedFiles(input.stackTrace ?? ""),
  };
}

export function toInfraFailure(classification: InfraClassification, raw: { errorMessage: string; stackTrace?: string }): InfraFailure {
  return {
    kind: classification.kind,
    message: raw.errorMessage.slice(0, 1000),
    evidence: raw.stackTrace ? { stack: raw.stackTrace.slice(0, 4000) } : undefined,
    at: new Date().toISOString(),
  };
}

function extractRelatedFiles(stackTrace: string): string[] {
  const filePattern = /(?:at\s+.*?\s+\(|at\s+)([^:]+\.(?:ts|js|tsx|jsx)):\d+/g;
  const files: string[] = [];
  let match;
  while ((match = filePattern.exec(stackTrace)) !== null) {
    const file = match[1];
    if (file && !file.includes("node_modules") && !files.includes(file)) {
      files.push(file);
    }
  }
  return files.slice(0, 5);
}