/**
 * Capture utilities — gather evidence from a Playwright Page or Electron window.
 *
 * Follows the standard exploratory-testing evidence model: per-action
 * screenshots, console / pageerror / request-failure collection, lightweight
 * accessibility snapshot (headings, landmarks, dialogs, focus), and basic
 * PerformanceObserver metrics.
 *
 * No I/O outside the provided buffer / paths. Screenshots are returned as
 * Buffers; the caller (action-client) writes them via ArtifactStore.
 */
import { fingerprint } from "../persona-loop/state-fingerprint.js";
export function bind(page) {
    const console_buffer = [];
    const page_error_buffer = [];
    const request_failure_buffer = [];
    page.on("console", (msg) => {
        const type = msg.type();
        if (type === "error" || type === "warning") {
            console_buffer.push({
                type: type,
                text: msg.text(),
                location: msg.location(),
                at: new Date().toISOString(),
            });
        }
    });
    page.on("pageerror", (err) => {
        page_error_buffer.push({
            message: err.message,
            stack: err.stack,
            at: new Date().toISOString(),
        });
    });
    page.on("requestfailed", (req) => {
        request_failure_buffer.push({
            url: req.url(),
            method: req.method(),
            failure: req.failure()?.errorText ?? "unknown",
            at: new Date().toISOString(),
        });
    });
    return { page, console_buffer, page_error_buffer, request_failure_buffer };
}
export function drain(bound) {
    return {
        console_errors: bound.console_buffer.splice(0),
        page_errors: bound.page_error_buffer.splice(0),
        request_failures: bound.request_failure_buffer.splice(0),
    };
}
export async function captureSnapshot(bound, opts = {}) {
    const page = bound.page;
    const url = page.url();
    const title = await page.title().catch(() => "");
    const headings = opts.capture_dom_summary !== false ? await safeHeadings(page) : [];
    const landmarks = opts.capture_dom_summary !== false ? await safeLandmarks(page) : [];
    const dialogs = opts.capture_dom_summary !== false ? await safeDialogs(page) : [];
    const visible_controls = opts.capture_dom_summary !== false ? await safeControlCount(page) : 0;
    const active = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el)
            return undefined;
        return el.getAttribute("data-testid") ?? el.getAttribute("aria-label") ?? el.tagName.toLowerCase();
    }).catch(() => undefined);
    const focus_visible = await page.evaluate(() => {
        try {
            return document.activeElement?.matches(":focus-visible") ?? false;
        }
        catch {
            return false;
        }
    }).catch(() => false);
    const fp_input = {
        url,
        title,
        headings,
        landmarks,
        dialogs,
        visible_controls_count: visible_controls,
        active_element: active ?? undefined,
        focus_visible,
    };
    const fp = fingerprint(fp_input);
    const state = {
        fingerprint: fp,
        captured_at: new Date().toISOString(),
        url,
        title,
        headings,
        landmarks,
        dialogs,
        visible_controls,
        ...(active ? { active_element: active } : {}),
        focus_visible,
        page_errors: bound.page_error_buffer.length,
        console_errors: bound.console_buffer.length,
    };
    const capture = { state, signals: drain(bound) };
    if (opts.capture_performance !== false) {
        capture.metrics = await safeMetrics(page);
    }
    return capture;
}
export async function takeScreenshot(bound, mode = "viewport") {
    return bound.page.screenshot({ fullPage: mode === "full_page", type: "png" });
}
// ---- helpers ----
async function safeHeadings(page) {
    return page.evaluate(() => Array.from(document.querySelectorAll("h1, h2, h3, [role='heading']"))
        .slice(0, 50)
        .map((el) => (el.textContent ?? "").trim())
        .filter((s) => s.length > 0)).catch(() => []);
}
async function safeLandmarks(page) {
    return page.evaluate(() => Array.from(document.querySelectorAll("header, nav, main, aside, footer, [role='banner'], [role='navigation'], [role='main'], [role='complementary'], [role='contentinfo']"))
        .slice(0, 50)
        .map((el) => ({
        role: el.getAttribute("role") ?? el.tagName.toLowerCase(),
        label: el.getAttribute("aria-label") ?? undefined,
    }))).catch(() => []);
}
async function safeDialogs(page) {
    return page.evaluate(() => Array.from(document.querySelectorAll("dialog, [role='dialog'], [role='alertdialog']"))
        .slice(0, 20)
        .map((el) => ({
        role: el.getAttribute("role") ?? "dialog",
        label: (el.getAttribute("aria-label") ?? el.getAttribute("aria-labelledby") ?? undefined),
    }))).catch(() => []);
}
async function safeControlCount(page) {
    return page.evaluate(() => {
        const sels = ["button", "a[href]", "input:not([type='hidden'])", "select", "textarea", "[role='button']", "[role='link']", "[role='checkbox']", "[role='radio']"];
        const counts = sels.map((s) => document.querySelectorAll(s).length);
        return counts.reduce((a, b) => a + b, 0);
    }).catch(() => 0);
}
async function safeMetrics(page) {
    return page.evaluate(() => {
        const navEntry = performance.getEntriesByType("navigation")[0];
        const paints = performance.getEntriesByType("paint");
        const fcp = paints.find((p) => p.name === "first-contentful-paint")?.startTime;
        const lt = performance.getEntriesByType("longtask");
        const longTasks = lt.reduce((a, b) => a + (b.duration ?? 0), 0);
        return {
            captured_at: new Date().toISOString(),
            navigation_timing: navEntry
                ? {
                    dom_content_loaded_ms: navEntry.domContentLoadedEventEnd,
                    load_ms: navEntry.loadEventEnd,
                    first_contentful_paint_ms: fcp,
                }
                : undefined,
            long_tasks_ms: longTasks,
        };
    }).catch(() => ({ captured_at: new Date().toISOString() }));
}
/** Tiny helper for Electron targets — derive a Page from ElectronApplication. */
export async function getFirstPage(app) {
    return app.firstWindow({ timeout: 30_000 });
}
/** Helper for round-2 storage state reuse. */
export async function snapshotStorageState(ctx) {
    return ctx.storageState();
}
//# sourceMappingURL=capture.js.map