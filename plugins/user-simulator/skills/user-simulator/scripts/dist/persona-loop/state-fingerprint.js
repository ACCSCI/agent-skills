/**
 * State fingerprint — used by persona-loop and bug-detector for novelty.
 *
 * Hashes URL, headings, dialogs, controls count, focus + a small slice of
 * derived state. NOT a screenshot hash. Animations and clock text are
 * excluded so a screenshot a second later doesn't read as "new state".
 */
import { createHash } from "node:crypto";
export function fingerprint(state) {
    const h = createHash("sha256");
    h.update(state.url ?? "");
    h.update("\x01");
    h.update(state.window ?? "");
    h.update("\x01");
    h.update((state.title ?? "").toLowerCase().replace(/\s+/g, " "));
    h.update("\x01");
    for (const heading of [...state.headings].sort())
        h.update(`h:${heading.toLowerCase()}|`);
    h.update("\x02");
    for (const lm of [...state.landmarks].sort(byLabel))
        h.update(`l:${lm.role}:${lm.label ?? ""}|`);
    h.update("\x03");
    for (const d of [...state.dialogs].sort(byLabel))
        h.update(`d:${d.role}:${d.label ?? ""}|`);
    h.update("\x04");
    h.update(String(state.visible_controls_count));
    h.update("\x05");
    h.update(state.active_element ?? "");
    h.update("\x06");
    h.update(state.focus_visible ? "1" : "0");
    return h.digest("hex").slice(0, 32);
}
export function diff(prev, next) {
    const changed_fields = [];
    if (prev.url !== next.url)
        changed_fields.push("url");
    if (prev.window !== next.window)
        changed_fields.push("window");
    if (normalize(prev.title) !== normalize(next.title))
        changed_fields.push("title");
    const prevHeadings = new Set(prev.headings.map((h) => h.toLowerCase()));
    const nextHeadings = new Set(next.headings.map((h) => h.toLowerCase()));
    const headingsAdded = [...nextHeadings].filter((h) => !prevHeadings.has(h));
    const headingsRemoved = [...prevHeadings].filter((h) => !nextHeadings.has(h));
    const prevLandmarks = keySet(prev.landmarks);
    const nextLandmarks = keySet(next.landmarks);
    const lmAdded = [...nextLandmarks].filter((k) => !prevLandmarks.has(k));
    const lmRemoved = [...prevLandmarks].filter((k) => !nextLandmarks.has(k));
    const prevDialogs = keySet(prev.dialogs);
    const nextDialogs = keySet(next.dialogs);
    const dlgAdded = [...nextDialogs].filter((k) => !prevDialogs.has(k));
    const dlgRemoved = [...prevDialogs].filter((k) => !nextDialogs.has(k));
    const added = [...headingsAdded.map((h) => `h:${h}`), ...lmAdded, ...dlgAdded];
    const removed = [...headingsRemoved.map((h) => `h:${h}`), ...lmRemoved, ...dlgRemoved];
    const allKeys = new Set([...prevLandmarks, ...nextLandmarks, ...prevDialogs, ...nextDialogs, ...prevHeadings, ...nextHeadings]);
    const union = Math.max(allKeys.size, 1);
    const novelty = Math.min(1, (added.length + removed.length + changed_fields.length) / union);
    return { added, removed, changed_fields, novelty };
}
function normalize(s) {
    return (s ?? "").toLowerCase().replace(/\s+/g, " ");
}
function byLabel(a, b) {
    return (a.label ?? "").localeCompare(b.label ?? "");
}
function keySet(items) {
    const s = new Set();
    for (const it of items)
        s.add(`${it.role}:${it.label ?? ""}`);
    return s;
}
//# sourceMappingURL=state-fingerprint.js.map