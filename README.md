# cc-productivity-plugins

A small collection of Claude Code skills I built for my own workflow, packaged
as a Plugin Marketplace so others can install them with a single command.

| Skill | What it does |
|---|---|
| **sync-skills** | Reconcile `~/.agents/skills/` (authoritative) and `~/.claude/skills/` (runtime) — handle Windows directory junctions, migrate orphan skills, backfill the lockfile. |
| **speedpr** | Drive the current branch to "Ready To Merge": auto-detect phase (uncommitted → unpushed → no PR → PR exists), handle review threads via GraphQL, CI, and merge conflicts. |

## Installation

You have two options — pick whichever fits your setup.

### Option A — Plugin Marketplace (recommended)

```text
/plugin marketplace add ACCSCI/cc-productivity-plugins
/plugin marketplace browse cc-productivity-plugins
/plugin install sync-skills@cc-productivity-plugins
/plugin install speedpr@cc-productivity-plugins
```

That's it. The skills land in `~/.claude/skills/` and are picked up by the
next prompt. Run `/sync-skills` afterwards to wire them into your
`~/.agents/skills/` tree (so `npx skills` and similar tools see them too).

To update later: `/plugin update sync-skills`.

### Option B — Manual clone

If you don't want to use the marketplace mechanism, clone the repo and copy
the `skills/` directories into `~/.claude/skills/`:

```bash
git clone https://github.com/ACCSCI/cc-productivity-plugins.git
cp -r cc-productivity-plugins/skills/sync-skills ~/.claude/skills/
cp -r cc-productivity-plugins/skills/speedpr     ~/.claude/skills/
# Windows (PowerShell):
#   Copy-Item -Recurse cc-productivity-plugins\skills\sync-skills $HOME\.claude\skills\
#   Copy-Item -Recurse cc-productivity-plugins\skills\speedpr     $HOME\.claude\skills\
```

Restart Claude Code (or type `/`) and the skills are available.

> If you want both tools to see the same skills, run `/sync-skills` once after
> copying — it'll create the Windows junctions (or POSIX symlinks) between
> `~/.claude/skills/` and `~/.agents/skills/` automatically.

## Dependencies

These are listed for transparency; neither plugin enforces them at install
time, so missing prerequisites just surface as a runtime error when you
invoke the skill.

### `sync-skills`

- **Python 3.8+** — the bundled Python script does the actual work
  (`scripts/sync-skills.py`). macOS and most Linux distributions ship with
  Python 3 by default. On Windows, Git for Windows now includes Python 3,
  but you can also install from [python.org](https://www.python.org/).
- **Windows junctions** — the script creates directory junctions via
  `mklink /J` (not symlinks). This is intentional: `mklink /D` (symlinks)
  requires either Developer Mode or administrator privileges, and Git
  Bash's `ln -s` silently falls back to creating a real directory when
  those privileges are missing — which would defeat the sync. Junctions
  require no special privileges and work the same way.
- **Bash** — the shell wrapper (`scripts/sync-skills.sh`) expects bash.
  macOS/Linux: built in. Windows: use Git Bash (ships with Git for Windows).

### `speedpr`

- **`gh` CLI** — install from <https://cli.github.com/> and authenticate
  with `gh auth login`. The skill drives GitHub via `gh` for PR creation,
  status checks, and GraphQL mutations on review threads.
- **A git repository** — the skill expects to be run inside a local repo
  with a remote. Outside a repo, it'll tell you so.

## Project layout

```
cc-productivity-plugins/
├── .claude-plugin/
│   └── marketplace.json          ← Plugin Marketplace manifest
├── plugins/                      ← Source for marketplace distribution
│   ├── sync-skills/
│   │   ├── .claude-plugin/plugin.json
│   │   └── skills/sync-skills/{SKILL.md, README.md, scripts/}
│   └── speedpr/
│       ├── .claude-plugin/plugin.json
│       └── skills/speedpr/SKILL.md
├── skills/                       ← Mirror of plugins/*/skills/* for manual install
│   ├── sync-skills/
│   └── speedpr/
├── README.md
├── LICENSE                       ← MIT
└── .gitignore
```

`plugins/` is the canonical source. `skills/` is a hand-maintained mirror
for users who'd rather just copy directories. If you submit a PR, please
update both.

## Contributing

Issues and pull requests welcome. For significant changes (new skill,
breaking API), please open an issue first to discuss.

## License

MIT — see [LICENSE](LICENSE).