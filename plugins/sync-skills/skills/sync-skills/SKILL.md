---
name: sync-skills
description: "Reconcile skills between ~/.agents/skills/ (authoritative) and ~/.claude/skills/ (runtime). Use this when the user wants to sync, mirror, align, or repair the two skill directories. Treats ~/.agents/skills/ as the source of truth: creates symlinks for any agents-skill missing on the claude side, migrates any real (non-symlink) directories on the claude side into agents and replaces them with symlinks, repairs dangling symlinks, and backfills ~/.agents/.skill-lock.json for migrated entries. Supports a dry-run mode."
allowed-tools: Bash, Read, Glob
argument-hint: "[--scope {global,project}] [--project-root <path>] [--dry-run]"
---

# sync-skills

When invoked, perform the following steps.

## 1. Locate the script

The skill itself lives canonically at `~/.agents/skills/sync-skills/`
and `~/.claude/skills/sync-skills` is a Windows directory junction pointing
to it (after the first run). Invoke the script via the wrapper:

```bash
bash "$HOME/.agents/skills/sync-skills/scripts/sync-skills.sh"
```

The wrapper calls `sync-skills.py` in the same directory, which contains
the actual algorithm. Python is used so that Windows directory junctions
(`mklink /J`) can be created reliably — bash's `ln -s` silently falls
back to creating real directories on systems without
`SeCreateSymbolicLink` privilege, which defeats the sync.

### Scope

The script supports two scopes via `--scope`:

- `global` (default) — sync `~/.agents/skills/` ↔ `~/.claude/skills/`,
  lockfile at `~/.agents/.skill-lock.json`. Use this for personal skills.
- `project` — sync `<project-root>/.agents/skills/` ↔ `<project-root>/.claude/skills/`,
  lockfile at `<project-root>/.agents/.skill-lock.json`. The project root
  defaults to `os.getcwd()`; override with `--project-root <path>`. In
  project scope, the two skills directories are auto-created if missing.

Examples:

```bash
# global (default, no flag needed)
bash "$HOME/.agents/skills/sync-skills/scripts/sync-skills.sh"

# project mode (uses cwd as project root)
bash "$HOME/.agents/skills/sync-skills/scripts/sync-skills.sh" --scope project

# project mode with explicit root
bash "$HOME/.agents/skills/sync-skills/scripts/sync-skills.sh" \
    --scope project --project-root /path/to/project
```

## 2. Honour --dry-run

If the user passed `--dry-run` (or asked for a dry run / preview), either
pass the CLI flag or set the environment variable:

```bash
# CLI flag (preferred)
bash "$HOME/.agents/skills/sync-skills/scripts/sync-skills.sh" --dry-run

# env var (also works)
DRY_RUN=1 bash "$HOME/.agents/skills/sync-skills/scripts/sync-skills.sh"
```

Both make the script print what it *would* do without writing anything.
Useful before the first real run on a new project.

## 3. Summarise the output

The script prints one line per action with a tag prefix:

- `[CREATE]` — created a new junction on the claude side
- `[REPAIR]` — replaced a wrong-target junction
- `[MIGRATE]` — moved a real directory from claude to agents (or vice versa)
  and replaced with a junction
- `[REMOVE-DANGLING]` — removed a broken junction
- `[SKIP]` — already correct, no change
- `[CONFLICT]` — same skill name exists in both trees with different content;
  aborted, manual decision required
- `[LOCK-ADD]` / `[SKIP-LOCK]` — lockfile backfill state

The final line is a summary: `created: N, repaired: N, migrated: N,
dangling-removed: N, conflicts: N, unchanged: N`.

Report that summary to the user. If `conflicts > 0`, list the conflicting
skill names and the script's hint output for each.

## 4. Verification

After the script reports `conflicts: 0`, do a quick read-only sanity
check. Pick the verification that matches the scope you used:

**Global scope:**

```bash
cmd /c "dir /AL %USERPROFILE%\.claude\skills"   # list all junctions
```

Confirm:

- Every skill in `~/.agents/skills/` shows up as `<JUNCTION>` in
  `~/.claude/skills/` (Windows-native directory junctions; symlinks are
  not used because they require admin on Windows).
- The number of entries on both sides matches.
- `~/.claude/skills/sync-skills` is a junction into `~/.agents/skills/`
  (self-bootstrapped after the first run).
- The lockfile `~/.agents/.skill-lock.json` now contains an entry for
  `speedpr` (or whichever skills were migrated from the claude side),
  each with `scope: "global"`.

**Project scope:**

```bash
# Replace <project-root> with the actual root used (defaults to cwd).
cmd /c "dir /AL <project-root>\.claude\skills"
```

Confirm:

- Every skill in `<project-root>/.agents/skills/` shows up as `<JUNCTION>`
  in `<project-root>/.claude/skills/`.
- `<project-root>/.agents/.skill-lock.json` exists and each entry has
  `scope: "project"`. This lockfile is **separate** from
  `~/.agents/.skill-lock.json`; project skills are not visible to the
  global scope and vice versa.
- If you had to bootstrap a fresh project, both
  `<project-root>/.agents/skills/` and `<project-root>/.claude/skills/`
  exist (the script auto-created them).

Tell the user the sync is complete. The next time they need to re-sync, they
just run `/sync-skills` (or `/sync-skills` and ask for project mode) again.
