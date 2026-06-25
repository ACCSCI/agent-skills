#!/usr/bin/env bash
# sync-skills.sh — thin wrapper around sync-skills.py.
# Aligns ~/.claude/skills/ with ~/.agents/skills/ (authoritative).
#
# Usage:
#   bash sync-skills.sh                 # perform sync
#   DRY_RUN=1 bash sync-skills.sh       # show what would change, write nothing
#
# See sync-skills.py for the algorithm. The actual logic lives in Python
# because Windows junctions (mklink /J) need OS-level APIs that bash alone
# cannot reliably invoke from Git Bash.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY_SCRIPT="$SCRIPT_DIR/sync-skills.py"

if [[ ! -f "$PY_SCRIPT" ]]; then
    echo "ERROR: $PY_SCRIPT not found" >&2
    exit 1
fi

if ! command -v python >/dev/null 2>&1; then
    echo "ERROR: python not found in PATH; this sync requires Python 3" >&2
    exit 1
fi

exec python "$PY_SCRIPT" "$@"
