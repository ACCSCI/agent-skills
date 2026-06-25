#!/usr/bin/env python3
"""sync-skills.py — align .claude/skills/ with .agents/skills/.

Two scopes, selected via --scope:
  - global  (default): ~/.agents/skills/  <->  ~/.claude/skills/
                       lockfile: ~/.agents/.skill-lock.json
  - project:           <project-root>/.agents/skills/  <->  <project-root>/.claude/skills/
                       lockfile: <project-root>/.agents/.skill-lock.json
                       (project root defaults to os.getcwd(); override with --project-root)

In project scope, missing .agents/skills/ and .claude/skills/ directories
are auto-created (mkdir -p) on each run.

Phases:
  1. Forward sync  — for every skill in the agents side, ensure a
                     corresponding junction on the claude side.
  2. Reverse sync  — migrate any real (non-junction) directories on the
                     claude side into the agents side and replace them
                     with junctions; backfill the lockfile.
  3. Cleanup       — remove dangling junctions on the claude side.

Idempotent: re-running after a clean state produces only [SKIP] lines.
Supports DRY_RUN=1 (env var) or --dry-run (CLI flag) to print what
would happen without writing.

Windows note: we use `mklink /J` (directory junction) instead of
symlinks because Git Bash's `ln -s` silently falls back to creating a
real directory when the user lacks SeCreateSymbolicLink privilege.
Junctions work without admin and resolve correctly through os.path.realpath.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from collections import namedtuple
from datetime import datetime, timezone
from pathlib import Path

# A bundle of paths that defines one "scope" (global or project).
Paths = namedtuple("Paths", "root agents_dir claude_dir agents_skills claude_skills lockfile scope")


def build_paths(scope: str, project_root: str) -> Paths:
    """Construct a Paths object for the given scope.

    - global:  paths under $HOME, lockfile at ~/.agents/.skill-lock.json
    - project: paths under project_root, lockfile at <root>/.agents/.skill-lock.json
    """
    if scope == "global":
        home = Path(os.path.expanduser("~")).resolve()
        return Paths(
            root=home,
            agents_dir=home / ".agents",
            claude_dir=home / ".claude",
            agents_skills=home / ".agents" / "skills",
            claude_skills=home / ".claude" / "skills",
            lockfile=home / ".agents" / ".skill-lock.json",
            scope="global",
        )
    # scope == "project"
    root = Path(project_root).resolve()
    return Paths(
        root=root,
        agents_dir=root / ".agents",
        claude_dir=root / ".claude",
        agents_skills=root / ".agents" / "skills",
        claude_skills=root / ".claude" / "skills",
        lockfile=root / ".agents" / ".skill-lock.json",
        scope="project",
    )


DRY_RUN = os.environ.get("DRY_RUN") == "1"

# Counters
N_CREATED  = 0
N_REPAIRED = 0
N_MIGRATED = 0
N_DANGLING = 0
N_SKIPPED  = 0
N_CONFLICTS = 0
CONFLICT_NAMES: list[str] = []


def log(msg: str) -> None:
    print(msg)


def err(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)


# ---------- Path helpers ----------

def real(p: Path | str) -> str:
    """Canonical absolute path string. Follows junctions & symlinks."""
    return str(Path(p).resolve())


def is_junction_to(link: Path, target: Path) -> bool:
    """True if `link` is a junction/symlink that resolves to `target`."""
    if not link.exists() and not link.is_symlink():
        return False
    try:
        return real(link) == real(target)
    except OSError:
        return False


def is_junction(link: Path) -> bool:
    """True if `link` is a junction or symlink (reparse point) on Windows,
    or a symlink elsewhere."""
    if link.is_symlink():
        return True
    # Windows junction: not a symlink, but realpath differs from the path.
    if link.is_dir() and real(link) != str(link):
        return True
    return False


def make_junction(link: Path, target: Path) -> None:
    """Create a directory junction at `link` pointing to `target`.

    On Windows uses `mklink /J`. On POSIX uses `ln -s` (best-effort).
    """
    if sys.platform == "win32":
        # Junction via cmd. Both paths are converted to Windows form
        # so cmd can interpret them.
        win_link   = str(link).replace("/", "\\")
        win_target = str(target).replace("/", "\\")
        subprocess.check_call(
            ["cmd", "/c", "mklink", "/J", win_link, win_target],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.STDOUT,
        )
    else:
        os.symlink(target, link)


def remove_reparse_point(p: Path) -> None:
    """Remove a junction/symlink without following it.

    Plain `rm`/`rm -rf` on a junction follows it and deletes the target's
    contents. `os.unlink` works for symlinks; for junctions we use `rmdir`.
    """
    if p.is_symlink():
        p.unlink()
    elif p.is_dir() and real(p) != str(p):
        # Junction — remove the reparse point only.
        os.rmdir(p)
    else:
        shutil.rmtree(p)


# ---------- Lockfile helpers ----------

def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def file_sha256(p: Path) -> str:
    import hashlib
    if not p.is_file():
        return ""
    h = hashlib.sha256()
    h.update(p.read_bytes())
    return h.hexdigest()


def backfill_lockfile(p: Paths, name: str, skill_hash: str, ts: str) -> None:
    # In project scope we own the lockfile path entirely — create an
    # empty v3 skeleton if it doesn't exist. In global scope, refuse
    # to invent a file the user never asked for.
    if not p.lockfile.is_file():
        if p.scope == "project":
            if DRY_RUN:
                log(f"[DRY-RUN] would init empty v3 lockfile: {p.lockfile}")
                log(f"[DRY-RUN] would backfill lockfile: {name} hash={skill_hash} ts={ts}")
                return
            p.lockfile.parent.mkdir(parents=True, exist_ok=True)
            with p.lockfile.open("w", encoding="utf-8") as f:
                json.dump({"version": 3, "skills": {}}, f, indent=2, ensure_ascii=False)
            log(f"[LOCKFILE-INIT] {p.lockfile}")
        else:
            err(f"{p.lockfile} not found; cannot backfill entry for {name}")
            return

    with p.lockfile.open("r", encoding="utf-8") as f:
        data = json.load(f)

    # Normalize to top-level dict with 'skills' sub-dict.
    if isinstance(data, dict) and isinstance(data.get("skills"), dict):
        skills = data["skills"]
    elif isinstance(data, list):
        # Convert legacy list form into the v3 dict form.
        skills = {}
        for entry in data:
            if isinstance(entry, dict):
                sp = entry.get("skillPath", "")
                key = (sp.split("/")[-1].removesuffix(".md")
                       if sp else entry.get("name", ""))
                if key:
                    skills[key] = entry
        data = {"version": 3, "skills": skills}
    else:
        data = {"version": 3, "skills": {}}
        skills = data["skills"]

    if name in skills:
        log(f"[SKIP-LOCK] {name} already in lockfile")
    else:
        skills[name] = {
            "source": "local",
            "sourceType": "local",
            "sourceUrl": None,
            "skillPath": f"skills/{name}/SKILL.md",
            "skillFolderHash": skill_hash,
            "installedAt": ts,
            "updatedAt": ts,
            "scope": p.scope,
        }
        with p.lockfile.open("w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        log(f"[LOCK-ADD] {name} (scope={p.scope})")


# ---------- Phase 1: forward sync ----------

def phase1_forward(p: Paths) -> None:
    global N_CREATED, N_REPAIRED, N_SKIPPED, N_MIGRATED, N_CONFLICTS, CONFLICT_NAMES
    log("=== Phase 1: forward sync (agents -> claude) ===")

    if not p.agents_skills.is_dir():
        err(f"{p.agents_skills} does not exist. Nothing to sync.")
        sys.exit(1)
    if not p.claude_skills.is_dir():
        err(f"{p.claude_skills} does not exist. Refusing to create it.")
        sys.exit(1)

    for src in sorted(p.agents_skills.iterdir()):
        if not src.is_dir():
            continue
        name = src.name
        # Skip backup artefacts.
        if name.endswith(".bak") or ".bak." in name or name.endswith(".backup") or ".backup." in name:
            continue

        target = src
        link   = p.claude_skills / name

        if not link.exists() and not link.is_symlink():
            # Case A: link does not exist at all.
            log(f"[CREATE] {link} -> {target}")
            if DRY_RUN:
                log(f"[DRY-RUN] mklink /J {link} {target}")
            else:
                make_junction(link, target)
            N_CREATED += 1
        elif is_junction(link):
            # Case B: link is a junction/symlink. Check its target.
            if is_junction_to(link, target):
                log(f"[SKIP] {link} (already correct)")
                N_SKIPPED += 1
            else:
                existing = real(link)
                log(f"[REPAIR] {link} (was -> {existing}, should -> {target})")
                if DRY_RUN:
                    log(f"[DRY-RUN] rmdir {link} && mklink /J {link} {target}")
                else:
                    remove_reparse_point(link)
                    make_junction(link, target)
                N_REPAIRED += 1
        elif link.is_dir():
            # Case C: real directory on the claude side.
            if not target.exists():
                log(f"[MIGRATE] {link} -> {target} (forward path, target missing)")
                if DRY_RUN:
                    log(f"[DRY-RUN] shutil.move({link}, {target}) && mklink /J {link} {target}")
                else:
                    shutil.move(str(link), str(target))
                    make_junction(link, target)
                N_MIGRATED += 1
            else:
                link_hash   = file_sha256(link / "SKILL.md")
                target_hash = file_sha256(target / "SKILL.md")
                if link_hash and link_hash == target_hash:
                    log(f"[MIGRATE] {link} -> {target} (forward, identical SKILL.md)")
                    if DRY_RUN:
                        log(f"[DRY-RUN] rmtree({link}) && mklink /J {link} {target}")
                    else:
                        shutil.rmtree(link)
                        make_junction(link, target)
                    N_MIGRATED += 1
                else:
                    log(f"[CONFLICT] {name} exists on both sides with different content")
                    log(f"  claude SKILL.md sha256: {link_hash or '(missing)'}")
                    log(f"  agents SKILL.md sha256: {target_hash or '(missing)'}")
                    N_CONFLICTS += 1
                    CONFLICT_NAMES.append(name)
        else:
            err(f"Unexpected: {link} is neither a directory nor a junction")


# ---------- Phase 2: reverse migration ----------

def phase2_reverse(p: Paths) -> None:
    global N_MIGRATED, N_SKIPPED
    log("")
    log("=== Phase 2: reverse migration (claude real dirs -> agents) ===")

    for src in sorted(p.claude_skills.iterdir()):
        if not src.is_dir():
            continue
        name = src.name
        link   = src
        target = p.agents_skills / name

        if is_junction(link):
            # Already a junction — handled in Phase 1.
            continue
        if not link.is_dir():
            err(f"Unexpected: {link} is not a symlink or directory")
            continue

        if target.exists():
            log(f"[SKIP] {link} (target {target} already exists; Phase 1 should have handled it)")
            N_SKIPPED += 1
            continue

        log(f"[MIGRATE] {link} -> {target} (reverse path)")
        if DRY_RUN:
            log(f"[DRY-RUN] shutil.move({link}, {target}) && mklink /J {link} {target}")
        else:
            shutil.move(str(link), str(target))
            make_junction(link, target)
        N_MIGRATED += 1

        # Backfill the lockfile (skip for sync-skills — it's the script's own home).
        if name == "sync-skills":
            log("[SKIP-LOCK] sync-skills is the script itself; not registered in lockfile")
        else:
            skill_hash = file_sha256(target / "SKILL.md")
            ts = now_iso()
            if DRY_RUN:
                log(f"[DRY-RUN] would backfill lockfile: {name} hash={skill_hash} ts={ts}")
            else:
                backfill_lockfile(p, name, skill_hash, ts)


# ---------- Phase 3: cleanup dangling ----------

def phase3_cleanup(p: Paths) -> None:
    global N_DANGLING
    log("")
    log("=== Phase 3: cleanup dangling junctions ===")
    for entry in p.claude_skills.iterdir():
        if not is_junction(entry):
            continue
        if not entry.exists():
            log(f"[REMOVE-DANGLING] {entry} (target missing)")
            if DRY_RUN:
                log(f"[DRY-RUN] rmdir {entry}")
            else:
                remove_reparse_point(entry)
            N_DANGLING += 1


# ---------- Main ----------

def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="sync-skills",
        description="Reconcile skills between .agents/ (authoritative) and .claude/ (runtime).",
    )
    parser.add_argument(
        "--scope",
        choices=["global", "project"],
        default="global",
        help="Sync scope: 'global' (default) uses ~/.agents and ~/.claude; "
             "'project' uses <project-root>/.agents and <project-root>/.claude.",
    )
    parser.add_argument(
        "--project-root",
        default=os.getcwd(),
        help="Project root for --scope=project (default: current working directory).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would happen without writing anything. Equivalent to DRY_RUN=1.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    # --dry-run flag also sets the env var so the rest of the script
    # (which still reads DRY_RUN at the top) behaves correctly.
    if args.dry_run:
        os.environ["DRY_RUN"] = "1"
        # Re-evaluate so the rest of main() sees the new value.
        global DRY_RUN
        DRY_RUN = True

    p = build_paths(args.scope, args.project_root)

    log("sync-skills.py starting")
    log(f"  scope         = {p.scope}")
    log(f"  project_root  = {p.root}")
    log(f"  agents_skills = {p.agents_skills}")
    log(f"  claude_skills = {p.claude_skills}")
    log(f"  lockfile      = {p.lockfile}")
    log(f"  DRY_RUN       = {DRY_RUN}")
    log("")

    # Project mode: auto-create the two skills directories if missing.
    # This makes a fresh project zero-config to bootstrap.
    if p.scope == "project":
        for d in (p.agents_skills, p.claude_skills):
            if not d.is_dir():
                if DRY_RUN:
                    log(f"[DRY-RUN] would mkdir: {d}")
                else:
                    d.mkdir(parents=True, exist_ok=True)
                    log(f"[MKDIR] {d}")

    phase1_forward(p)
    phase2_reverse(p)
    phase3_cleanup(p)

    log("")
    log("=== Summary ===")
    log(f"created: {N_CREATED}, repaired: {N_REPAIRED}, migrated: {N_MIGRATED}, "
        f"dangling-removed: {N_DANGLING}, conflicts: {N_CONFLICTS}, unchanged: {N_SKIPPED}")

    if N_CONFLICTS:
        log("")
        log("Conflicting skills (manual resolution required):")
        for n in CONFLICT_NAMES:
            log(f"  - {n}")
            log(f"      claude: {p.claude_skills / n}")
            log(f"      agents: {p.agents_skills / n}")
        log("")
        log("Resolve by removing one side, then re-run.")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
