#!/usr/bin/env bash
# ============================================================================
# ClauFlo v2 — Full Install Script
#
# Handles:
#   1. nvm installation (if not present)
#   2. Node.js 20 LTS setup via nvm
#   3. VS Code extension installation from .vsix
#
# Usage:
#   ./install-vsix.sh                          # auto-finds .vsix in same dir
#   ./install-vsix.sh /path/to/clau-flo.vsix   # explicit path
# ============================================================================

set -euo pipefail

# ── Colours ─────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  GREEN='\033[0;32m' YELLOW='\033[1;33m' RED='\033[0;31m' CYAN='\033[0;36m' BOLD='\033[1m' NC='\033[0m'
else
  GREEN='' YELLOW='' RED='' CYAN='' BOLD='' NC=''
fi
info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $*"; exit 1; }
step()  { echo -e "\n${BOLD}── $* ──${NC}"; }

REQUIRED_NODE_MAJOR=20
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  ClauFlo v2 — Full Installer${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# ── Step 1: nvm ─────────────────────────────────────────────────────────────
step "Step 1/3: Checking nvm"

load_nvm() {
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # Try loading from common locations
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    . "$NVM_DIR/nvm.sh"
    return 0
  fi
  # Homebrew (macOS)
  local brew_nvm="/opt/homebrew/opt/nvm/nvm.sh"
  if [ -s "$brew_nvm" ]; then
    export NVM_DIR="$HOME/.nvm"
    [ -d "$NVM_DIR" ] || mkdir -p "$NVM_DIR"
    . "$brew_nvm"
    return 0
  fi
  return 1
}

if load_nvm 2>/dev/null && command -v nvm &>/dev/null; then
  ok "nvm already installed ($(nvm --version))"
else
  info "nvm not found — installing..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

  # Load it immediately
  if ! load_nvm; then
    fail "nvm installed but could not be loaded. Close this terminal, open a new one, and re-run the script."
  fi
  ok "nvm installed ($(nvm --version))"
fi

# ── Step 2: Node.js ─────────────────────────────────────────────────────────
step "Step 2/3: Checking Node.js"

current_node_major() {
  if command -v node &>/dev/null; then
    node -v | sed 's/v//' | cut -d. -f1
  else
    echo "0"
  fi
}

NODE_MAJOR=$(current_node_major)

if [ "$NODE_MAJOR" -ge "$REQUIRED_NODE_MAJOR" ] 2>/dev/null; then
  ok "Node.js $(node -v) meets requirement (>= v${REQUIRED_NODE_MAJOR})"
else
  if [ "$NODE_MAJOR" -gt 0 ] 2>/dev/null; then
    warn "Node.js v$(node -v) found, but v${REQUIRED_NODE_MAJOR}+ required"
  else
    warn "Node.js not found"
  fi
  info "Installing Node.js ${REQUIRED_NODE_MAJOR} LTS via nvm..."
  nvm install "$REQUIRED_NODE_MAJOR" --lts
  nvm use "$REQUIRED_NODE_MAJOR"
  nvm alias default "$REQUIRED_NODE_MAJOR"
  ok "Node.js $(node -v) installed and set as default"
fi

# ── Step 3: VS Code Extension ───────────────────────────────────────────────
step "Step 3/3: Installing ClauFlo extension"

find_vsix() {
  # 1. Explicit argument
  if [ -n "${1:-}" ] && [ -f "$1" ]; then
    echo "$1"
    return 0
  fi

  # 2. Same directory as this script
  local found
  found=$(find "$SCRIPT_DIR" -maxdepth 2 -name "clau-flo*.vsix" -type f 2>/dev/null | sort -rV | head -1)
  if [ -n "$found" ]; then
    echo "$found"
    return 0
  fi

  # 3. Parent directory (repo root)
  found=$(find "$SCRIPT_DIR/.." -maxdepth 1 -name "clau-flo*.vsix" -type f 2>/dev/null | sort -rV | head -1)
  if [ -n "$found" ]; then
    echo "$found"
    return 0
  fi

  # 4. Current working directory
  found=$(find "$(pwd)" -maxdepth 1 -name "clau-flo*.vsix" -type f 2>/dev/null | sort -rV | head -1)
  if [ -n "$found" ]; then
    echo "$found"
    return 0
  fi

  # 5. ~/Downloads
  found=$(find "$HOME/Downloads" -maxdepth 1 -name "clau-flo*.vsix" -type f 2>/dev/null | sort -rV | head -1)
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
  fail "Could not find clau-flo*.vsix file.

  Looked in:
    - Argument:    ${1:-<none>}
    - Script dir:  $SCRIPT_DIR
    - Repo root:   $SCRIPT_DIR/..
    - Current dir: $(pwd)
    - Downloads:   $HOME/Downloads

  Make sure the .vsix file is in one of these locations."
fi

info "Found: $(basename "$VSIX_FILE")"

# Find VS Code CLI
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

CODE_CMD=""
if CODE_CMD=$(find_code_cmd); then
  # Remove old version if present
  "$CODE_CMD" --uninstall-extension clau-flo 2>/dev/null || true

  info "Installing into VS Code..."
  "$CODE_CMD" --install-extension "$VSIX_FILE" --force
  ok "Extension installed via '$CODE_CMD'"
else
  fail "VS Code CLI ('code') not found in PATH.

  Fix: Open VS Code > Cmd+Shift+P > 'Shell Command: Install code command in PATH'
  Then re-run this script."
fi

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  ClauFlo v2 installed successfully!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  Next steps:"
echo "    1. Reload VS Code (Cmd+Shift+P > 'Developer: Reload Window')"
echo "    2. Look for the ClauFlo icon in the Activity Bar"
echo "    3. Diff session starts automatically when Claude modifies files"
echo ""
echo "  Toggle autocomplete:"
echo "    Cmd+Shift+P > 'ClauFlo: Toggle Autocomplete'"
echo "    (requires ANTHROPIC_API_KEY env variable or VS Code setting)"
echo ""
