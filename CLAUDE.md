# cc-productivity-plugins

This repository is a **Claude Code Plugin Marketplace** that publishes a
collection of personal productivity skills.

It does **not** contain application code. It only contains skill definitions
packaged for distribution.

## Repository layout

```
cc-productivity-plugins/
├── .claude-plugin/
│   └── marketplace.json          ← Plugin Marketplace manifest (entry point)
├── plugins/                      ← Canonical source for marketplace distribution
│   ├── <skill-name>/
│   │   ├── .claude-plugin/plugin.json
│   │   └── skills/<skill-name>/SKILL.md
├── skills/                       ← Hand-maintained mirror of plugins/*/skills/*
│   └── <skill-name>/SKILL.md
├── README.md                     ← User-facing install instructions
├── LICENSE                       ← MIT
└── CLAUDE.md                     ← This file
```

## Key invariants

- **`plugins/` is the canonical source.** It is what the Plugin Marketplace
  serves to users.
- **`skills/` is a manual mirror.** Users who don't want the marketplace
  mechanism can clone the repo and copy these directories into
  `~/.claude/skills/` directly. The two MUST stay in sync — if you add or
  change a skill, update **both**.
- **One skill = one directory.** Each skill lives under
  `plugins/<skill-name>/skills/<skill-name>/SKILL.md` and is mirrored to
  `skills/<skill-name>/SKILL.md`.
- **Marketplace registration.** Every plugin in `plugins/` MUST be
  registered in `.claude-plugin/marketplace.json`. Adding a new skill
  without registering it makes it invisible to marketplace users.
- **README parity.** Every skill MUST appear in the README's skill table,
  install command examples, project layout diagram, and (if applicable)
  dependencies section.

## Adding a new skill

1. Decide the skill name (kebab-case, e.g. `app-factory`).
2. Create `plugins/<name>/.claude-plugin/plugin.json` with `name`,
   `version`, `description`, `author`, `license`, `keywords`, `homepage`.
3. Create `plugins/<name>/skills/<name>/SKILL.md` with the frontmatter
   (`name`, `description`, `allowed-tools`, `argument-hint`) and the
   skill body.
4. Mirror to `skills/<name>/SKILL.md` (exact copy).
5. Register in `.claude-plugin/marketplace.json` under `plugins[]` with
   `source: "./plugins/<name>"`.
6. Update `README.md`: skill table row, install command, project layout,
   dependencies section.
7. Commit with a `feat: add <name> plugin — <one-line description>` style
   message.
8. Push to `origin/main`.

## Modifying an existing skill

1. Edit the file in `plugins/<name>/skills/<name>/SKILL.md`.
2. Mirror the same edit to `skills/<name>/SKILL.md`.
3. If the `description` changes, also re-evaluate the README description
   and the plugin.json `description` field.
4. Bump `version` in the corresponding `plugin.json` if the change is
   user-visible (new args, new behavior, new dependencies).
5. Commit + push.

## What this repository is NOT

- Not an application. No `package.json`, no runtime, no business logic.
- Not a monorepo of consumer apps. The `plugins/*/skills/*` directories
  are skill definitions, not importable packages.
- Not a documentation site. User-facing docs live in `README.md` only.

## Local global install pattern

For active development, link a plugin from this repo into the global
skills tree so changes are picked up without re-publishing:

```bash
# Authoritative source
cmd //c "mklink /J C:\Users\ACCSCI\.agents\skills\<name> D:\Projects\skills\plugins\<name>\skills\<name>"

# Mirror to runtime
bash "$HOME/.agents/skills/sync-skills/scripts/sync-skills.sh"
```

This is a Windows-junction pattern. The two junctions point at each
other (chained), and the chain ends at the canonical file inside
`plugins/`. Edits to the file in the repo are immediately visible to
Claude Code on the next prompt.