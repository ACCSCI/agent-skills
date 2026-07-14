# cc-productivity-plugins

A small collection of Claude Code skills I built for my own workflow, packaged
as a Plugin Marketplace so others can install them with a single command.

| Skill | What it does |
|---|---|
| **sync-skills** | Reconcile `~/.agents/skills/` (authoritative) and `~/.claude/skills/` (runtime) — handle Windows directory junctions, migrate orphan skills, backfill the lockfile. |
| **speedpr** | Drive the current branch to "Ready To Merge": auto-detect phase (uncommitted → unpushed → no PR → PR exists), handle review threads via GraphQL, CI, and merge conflicts. |
| **app-factory** | AI Native project scaffolding factory. Initialize a project, configure tooling (lint/format/hooks/CI/deploy), analyze capabilities, recommend stack, install official skills, and generate a project-specific `CLAUDE.md`. Supports `Interactive`/`Auto` modes, 10 preset scenarios (SaaS / AI / Electron / Chrome Extension / Blog / Admin / API / CLI / SDK), and 4 deploy platform templates (Cloudflare / Vercel / AWS / Docker). Also detects existing projects and suggests safe upgrades. |
| **user-simulator** | AI-driven **product-level** QA for Electron and Web. Spawn persona-driven agents that act like real users, run task-based or exploratory flows, capture key-node evidence, find functional / visual / UX / performance bugs, and verify fixes via Round 2 comparison. v4 adds project auto-detection (`detect-project`), API verification (`verify-api` for OpenAPI / GraphQL / REST), and a runnable Playwright scaffold for projects without an existing E2E fixture. |

## Installation

You have two options — pick whichever fits your setup.

### Option A — Plugin Marketplace (recommended)

```text
/plugin marketplace add ACCSCI/cc-productivity-plugins
/plugin marketplace browse cc-productivity-plugins
/plugin install sync-skills@cc-productivity-plugins
/plugin install speedpr@cc-productivity-plugins
/plugin install app-factory@cc-productivity-plugins
/plugin install user-simulator@cc-productivity-plugins
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
cp -r cc-productivity-plugins/skills/app-factory ~/.claude/skills/
cp -r cc-productivity-plugins/skills/user-simulator ~/.claude/skills/
# Windows (PowerShell):
#   Copy-Item -Recurse cc-productivity-plugins\skills\sync-skills $HOME\.claude\skills\
#   Copy-Item -Recurse cc-productivity-plugins\skills\speedpr     $HOME\.claude\skills\
#   Copy-Item -Recurse cc-productivity-plugins\skills\app-factory $HOME\.claude\skills\
#   Copy-Item -Recurse cc-productivity-plugins\skills\user-simulator $HOME\.claude\skills\
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

### `app-factory`

- **Node.js 22+ and pnpm** — the skill scaffolds modern TypeScript projects.
  Enable pnpm via `corepack enable` once Node 22 is installed.
- **`npx` access to the `skills` CLI** — used to install official
  capability skills (Cloudflare / Hono / Drizzle / Better Auth / TanStack /
  Turborepo / etc.) into the target project. The skill installs `find-skills`
  first and queries it for every other skill decision.
- **Git** — the skill initializes a git repo if missing and configures
  Lefthook-based pre-commit / pre-push hooks.
- **A deploy-platform account (optional)** — only needed if you choose a
  managed platform during scaffolding (Cloudflare / Vercel / AWS). The
  Docker template works without any account.

### `user-simulator`

- **Node.js 24+** — runtime for the bundled TypeScript scripts
  (`scripts/*.ts`). The skill pins `@playwright/test` 1.61.1 to match
  existing Electron / Web projects in this workspace.
- **Playwright 1.61.1** — installed automatically into
  `plugins/user-simulator/skills/user-simulator/scripts/node_modules` on
  first run via `npm install`. Browser binaries (Chromium) are downloaded
  by `npx playwright install chromium`; ~hundreds of MB on first install.
- **Electron target requires either** an executable (`.exe` / packaged
  build) or an entry script (`.ts` / `.js`) that Playwright can launch via
  `_electron.launch()`. The skill does **not** scaffold the target app —
  it assumes you already have a launchable Electron build or a working
  entry script (whether hand-written or generated by a third-party E2E
  scaffolder). For Electron projects with no existing E2E fixture, the
  built-in `scaffold` subcommand will print a one-liner pointing at
  the appropriate third-party scaffolder.
- **Vision analysis** uses `mcp__MiniMax__understand_image` for screenshot
  interpretation. Each vision call consumes tokens; a 20-step Free
  Exploration with 3 vision calls per key node is typically several
  thousand tokens plus the screenshot storage cost.
- **Optional Chrome DevTools MCP** — only required for deep performance
  audits via the `web-perf` skill. Without it, `user-simulator` falls back
  to Playwright's built-in `PerformanceObserver` metrics.
- **Optional rubric skills** — `frontend-design` and `web-perf` are
  referenced as soft rubrics. The skill runs without them; references are
  informational only.
- **v4 API verification deps** — `openapi-fetch` + `openapi-typescript`
  for OpenAPI; `graphql-request` + `graphql` for GraphQL. Both installed
  automatically via `npm install` when you use `verify-api`. tRPC projects
  must install `@trpc/openapi` themselves to expose an OpenAPI spec the
  skill can consume. Auth-protected APIs require `--api-header "..."`
  on `verify-api`.
  informational only.
- **Safety defaults**: destructive actions and external navigation are
  disabled by default. Override per-Story via `safety.allow_*` flags; the
  skill will prompt for confirmation if it sees a production host.

## Project layout

```
cc-productivity-plugins/
├── .claude-plugin/
│   └── marketplace.json          ← Plugin Marketplace manifest
├── plugins/                      ← Source for marketplace distribution
│   ├── sync-skills/
│   │   ├── .claude-plugin/plugin.json
│   │   └── skills/sync-skills/{SKILL.md, README.md, scripts/}
│   ├── speedpr/
│   │   ├── .claude-plugin/plugin.json
│   │   └── skills/speedpr/SKILL.md
│   ├── app-factory/
│   │   ├── .claude-plugin/plugin.json
│   │   └── skills/app-factory/SKILL.md
│   └── user-simulator/
│       ├── .claude-plugin/plugin.json
│       └── skills/user-simulator/{SKILL.md, scripts/, schemas/, examples/, tests/}
├── skills/                       ← Mirror of plugins/*/skills/* for manual install
│   ├── sync-skills/
│   ├── speedpr/
│   ├── app-factory/
│   └── user-simulator/
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