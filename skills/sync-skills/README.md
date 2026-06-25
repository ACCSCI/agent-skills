# sync-skills

A Claude Code skill that aligns two skill directories:

- `~/.agents/skills/` — the **authoritative source** (where skills get
  installed by `npx skills` and similar, tracked by `~/.agents/.skill-lock.json`).
- `~/.claude/skills/` — the **runtime directory** Claude Code scans at
  startup to discover skills.

Without this skill, the two can drift apart: a skill installed in
`~/.agents/skills/` is invisible to Claude Code until you manually create
a junction. Running `/sync-skills` reconciles them in one shot.

## When to use

- After installing a new skill via `npx skills add ...`
- After hand-authoring a skill into `~/.claude/skills/` that should
  also be tracked by `.skill-lock.json`
- Whenever `/` autocomplete in Claude Code is missing a skill you know
  is installed

## Usage

In a Claude Code session, type `/sync-skills`. The model will run the
bundled script and report what changed.

From any shell, you can also run it directly:

```bash
# global scope (default)
bash ~/.agents/skills/sync-skills/scripts/sync-skills.sh            # perform sync
DRY_RUN=1 bash ~/.agents/skills/sync-skills/scripts/sync-skills.sh  # preview only

# project scope (uses cwd as project root; auto-creates dirs if missing)
bash ~/.agents/skills/sync-skills/scripts/sync-skills.sh --scope project
bash ~/.agents/skills/sync-skills/scripts/sync-skills.sh --scope project --project-root /path/to/project
bash ~/.agents/skills/sync-skills/scripts/sync-skills.sh --scope project --dry-run
```

## Scopes

| Scope | Flag | Authoritative | Runtime | Lockfile |
|---|---|---|---|---|
| Global (default) | `--scope global` | `~/.agents/skills/` | `~/.claude/skills/` | `~/.agents/.skill-lock.json` |
| Project | `--scope project` | `<project-root>/.agents/skills/` | `<project-root>/.claude/skills/` | `<project-root>/.agents/.skill-lock.json` |

Project mode is for teams or repos that ship a set of project-scoped
skills (e.g. an internal "deploy-bot" or "lint-strict" skill) alongside
the codebase. The project lockfile is fully isolated from the global
one — entries carry a `scope: "project"` field so the two never
collide. Missing `<project-root>/.agents/skills/` and
`<project-root>/.claude/skills/` directories are auto-created on each
run, so a fresh project needs zero prep.

## What it does

## What it does

Three phases, all idempotent:

| Phase | Direction | Action |
|---|---|---|
| 1. Forward | `~/.agents/skills/` → `~/.claude/skills/` | For every skill on the agents side, ensure a corresponding **junction** on the claude side. Create missing ones, repair wrong-target ones, and convert real directories (with matching content) to junctions. |
| 2. Reverse | `~/.claude/skills/` → `~/.agents/skills/` | For any real (non-junction) directory on the claude side, move it into `~/.agents/skills/` and replace the original location with a junction. Backfill `~/.agents/.skill-lock.json` with a `local`-sourced entry. |
| 3. Cleanup | (claude side) | Remove dangling junctions whose target no longer exists. |

The first run on a fresh system typically creates ~30 junctions and migrates
1–2 orphan skills. Subsequent runs print only `[SKIP]` lines and exit 0.

## Why junctions, not symlinks

On Windows, `mklink /D` (symbolic link) requires `SeCreateSymbolicLink`
privilege (admin or Developer Mode). `mklink /J` (directory junction)
works without admin. Git Bash's `ln -s` silently falls back to creating
a real directory on systems that lack the privilege, which breaks the
sync. This script uses `mklink /J` explicitly via `cmd /c`, matching the
convention that the user's existing skill installer already used (the
original 3 entries `docx`, `find-skills`, `mmx-cli` are junctions, not
symlinks).

## Files

```
~/.agents/skills/sync-skills/                  ← canonical home (real dir)
├── SKILL.md                                  ← skill manifest (Claude Code reads this)
├── README.md                                 ← this file
└── scripts/
    ├── sync-skills.sh                         ← thin bash wrapper
    └── sync-skills.py                         ← actual algorithm

~/.claude/skills/sync-skills                   ← junction → ../.agents/skills/sync-skills
```

## Safety

- **Backup of conflicts**: when a skill exists in both trees with
  different content, the script aborts and lists the conflicting skills.
  Resolve manually (delete one side, then re-run) — the script will not
  silently overwrite either copy.
- **Lockfile backfill**: skills migrated in Phase 2 are recorded in
  `~/.agents/.skill-lock.json` (global scope) or
  `<project-root>/.agents/.skill-lock.json` (project scope) with
  `source: "local"` and `scope: "global" | "project"`, so re-running the
  sync or any `npx skills` operation sees them as installed. The two
  lockfiles are independent — neither reads or writes the other.
- **Self-bootstrap**: the skill's own directory is migrated into
  `~/.agents/skills/` on the first run, so subsequent `/sync-skills`
  invocations resolve the canonical path automatically.
- **Idempotent**: re-running on a clean tree produces only `[SKIP]`
  lines, `created: 0, repaired: 0, migrated: 0, unchanged: <N>`.

## Rollback

If you want to undo the sync, just delete the junctions in
`~/.claude/skills/`:

```cmd
cmd /c "cd /d %USERPROFILE%\.claude\skills && for /D %i in (*) do @fsutil reparsepoint delete %i"
```

The real skill content in `~/.agents/skills/` is untouched.

## Re-syncing after installing a new skill

1. `npx skills add <owner>/<repo>` (installs to `~/.agents/skills/`)
2. `/sync-skills` (creates a junction in `~/.claude/skills/`)
3. Restart Claude Code (or just type `/` — it picks up new skills on
   the next prompt).
