/**
 * Infra-only fix suggester.
 *
 * Reuses the suggestion structure from
 * electron-e2e-scaffold/templates/fix-suggester.ts.hbs but constrains itself to
 * harness / environment / port / Electron launch / timeout advice.
 *
 * This module NEVER suggests product-source code changes. Those come from the
 * product bug evidence and are handled by a separate fix agent (out of scope
 * for v1 — user applies manually after Round 1).
 */
const PORT_KILL_WINDOWS = `# Windows: netstat -ano | findstr :<PORT> then taskkill /PID <pid> /F`;
const PORT_KILL_UNIX = `# Unix: lsof -i :<PORT>  then kill -9 <pid>`;
const PLAYWRIGHT_INSTALL = `npm install --no-save playwright@1.61.1\nnpx playwright install chromium`;
export function suggestInfraFix(classification) {
    const suggestions = [];
    switch (classification.kind) {
        case "browser_missing":
            suggestions.push({
                title: "Install Playwright browsers",
                description: classification.reason,
                files: [],
                confidence: 0.95,
                codeSnippet: PLAYWRIGHT_INSTALL,
            });
            break;
        case "playwright_not_installed":
            suggestions.push({
                title: "Install Playwright in skill scripts",
                description: classification.reason,
                files: [{ path: "plugins/user-simulator/skills/user-simulator/scripts/package.json", change: "modify", rationale: "Add @playwright/test dep if missing" }],
                confidence: 0.9,
                codeSnippet: `cd plugins/user-simulator/skills/user-simulator/scripts\nnpm install`,
            });
            break;
        case "port_conflict":
            suggestions.push({
                title: "Free the target port",
                description: classification.reason,
                files: [],
                confidence: 0.9,
                codeSnippet: `${PORT_KILL_WINDOWS}\n${PORT_KILL_UNIX}`,
            });
            break;
        case "electron_launch_failed":
            suggestions.push({
                title: "Fix Electron launch",
                description: classification.reason + " — verify entry path, dependencies, and GPU sandbox flags.",
                files: [],
                confidence: 0.7,
                codeSnippet: `# In main process: app.commandLine.appendSwitch('disable-gpu');\n# Or launch with: args: ['--no-sandbox']`,
            });
            break;
        case "target_unreachable":
            suggestions.push({
                title: "Start the target before launching user-simulator",
                description: classification.reason,
                files: [],
                confidence: 0.9,
                codeSnippet: `# Verify with: curl -I <ready_url>\n# Or run the dev command manually first.`,
            });
            break;
        case "timeout_no_evidence":
            suggestions.push({
                title: "Increase timeout or stabilize target",
                description: classification.reason,
                files: [],
                confidence: 0.5,
                codeSnippet: `# Increase the per-action timeout via --max-steps or the story's max_total_actions.`,
            });
            break;
        case "harness_exception":
            suggestions.push({
                title: "Inspect user-simulator stack trace",
                description: classification.reason,
                files: [],
                confidence: 0.5,
            });
            break;
    }
    return suggestions.sort((a, b) => b.confidence - a.confidence);
}
export function formatInfraFixReport(suggestions) {
    if (suggestions.length === 0)
        return "No infra fix suggestions.";
    const lines = ["## Infra Fix Suggestions\n"];
    suggestions.forEach((s, i) => {
        lines.push(`### ${i + 1}. ${s.title}`);
        lines.push(`Confidence: ${(s.confidence * 100).toFixed(0)}%\n`);
        lines.push(s.description);
        if (s.codeSnippet) {
            lines.push("\n```");
            lines.push(s.codeSnippet);
            lines.push("```");
        }
        lines.push("");
    });
    return lines.join("\n");
}
//# sourceMappingURL=infra-fix-suggester.js.map