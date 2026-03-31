#!/usr/bin/env bash
# ============================================================================
# ClauFlo — Install from .vsix file
#
# Usage:
#   ./install-vsix.sh                          # auto-finds .vsix in same dir
#   ./install-vsix.sh /path/to/clau-flo.vsix   # explicit path
#   ./install-vsix.sh ~/Downloads/clau-flo-0.1.0.vsix
#
# Share this script + the .vsix file over Slack.
# Your teammate downloads both, then runs:
#   bash install-vsix.sh
# ============================================================================

set -euo pipefail

# ── Colours ─────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  GREEN='\033[0;32m' YELLOW='\033[1;33m' RED='\033[0;31m' CYAN='\033[0;36m' NC='\033[0m'
else
  GREEN='' YELLOW='' RED='' CYAN='' NC=''
fi
info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $*"; exit 1; }

# ── Find the .vsix file ────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

find_vsix() {
  # 1. Explicit argument
  if [ -n "${1:-}" ] && [ -f "$1" ]; then
    echo "$1"
    return 0
  fi

  # 2. Same directory as this script
  local found
  found=$(find "$SCRIPT_DIR" -maxdepth 1 -name "clau-flo*.vsix" -type f 2>/dev/null | head -1)
  if [ -n "$found" ]; then
    echo "$found"
    return 0
  fi

  # 3. Current working directory
  found=$(find "$(pwd)" -maxdepth 1 -name "clau-flo*.vsix" -type f 2>/dev/null | head -1)
  if [ -n "$found" ]; then
    echo "$found"
    return 0
  fi

  # 4. ~/Downloads (common Slack download location)
  found=$(find "$HOME/Downloads" -maxdepth 1 -name "clau-flo*.vsix" -type f 2>/dev/null | sort -r | head -1)
  if [ -n "$found" ]; then
    echo "$found"
    return 0
  fi

  return 1
}

VSIX_FILE=""
if VSIX_FILE=$(find_vsix "${1:-}"); then
  : # found
else
  echo ""
  fail "Could not find clau-flo*.vsix file.

  Looked in:
    - Argument:    ${1:-<none>}
    - Script dir:  $SCRIPT_DIR
    - Current dir: $(pwd)
    - Downloads:   $HOME/Downloads

  Usage:
    bash install-vsix.sh /path/to/clau-flo-0.1.0.vsix"
fi

# ── Find VS Code CLI ───────────────────────────────────────────────────────
find_code_cmd() {
  if command -v code &>/dev/null; then
    echo "code"
  elif command -v code-insiders &>/dev/null; then
    echo "code-insiders"
  elif [ -f "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" ]; then
    echo "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
  elif [ -f "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code-insiders" ]; then
    echo "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code-insiders"
  else
    return 1
  fi
}

# ── Install ─────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  ClauFlo — VSIX Installer${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

info "Using: $(basename "$VSIX_FILE")"
info "Path:  $VSIX_FILE"
echo ""

CODE_CMD=""
if CODE_CMD=$(find_code_cmd); then
  # Remove old version if present
  "$CODE_CMD" --uninstall-extension clau-flo 2>/dev/null || true

  info "Installing into VS Code..."
  "$CODE_CMD" --install-extension "$VSIX_FILE" --force
  ok "Extension installed via '$CODE_CMD'"
else
  fail "VS Code CLI ('code') not found in PATH.

  Fix: Open VS Code → Cmd+Shift+P → 'Shell Command: Install code command in PATH'
  Then re-run this script.

  Or install manually:
    VS Code → Extensions sidebar → ... menu → Install from VSIX → select $(basename "$VSIX_FILE")"
fi

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  ClauFlo installed successfully!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  Next steps:"
echo "    1. Reload VS Code (Cmd+Shift+P → 'Developer: Reload Window')"
echo "    2. Look for the 'ClauFlo' icon in the Activity Bar"
echo "    3. Diff session starts automatically when Claude modifies files"
echo ""
echo "  Optional — enable autocomplete:"
echo "    Cmd+Shift+P → 'ClauFlo: Toggle Autocomplete'"
echo "    (requires ANTHROPIC_API_KEY env variable or setting)"
echo ""
