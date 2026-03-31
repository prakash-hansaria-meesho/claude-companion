#!/usr/bin/env bash
# ============================================================================
# ClauFlo — One-step installer
#
# Usage:
#   ./scripts/install.sh
#
# What it does:
#   1. Installs nvm if not already present
#   2. Installs Node >= 20 via nvm (does NOT change your default node)
#   3. Installs npm dependencies
#   4. Compiles TypeScript
#   5. Packages the .vsix
#   6. Installs the extension into VS Code
#   7. Prompts to reload VS Code
#
# Safe to re-run — idempotent at every step.
# ============================================================================

set -euo pipefail

# ── Colours (disabled when not a terminal) ──────────────────────────────────
if [ -t 1 ]; then
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  RED='\033[0;31m'
  CYAN='\033[0;36m'
  NC='\033[0m'
else
  GREEN='' YELLOW='' RED='' CYAN='' NC=''
fi

info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $*"; exit 1; }

# ── Resolve paths ───────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

REQUIRED_NODE_MAJOR=20

# ── Step 1: Ensure nvm is available ─────────────────────────────────────────
ensure_nvm() {
  # Already loaded?
  if command -v nvm &>/dev/null; then
    return 0
  fi

  # Try sourcing from common locations
  local NVM_LOCATIONS=(
    "$HOME/.nvm/nvm.sh"
    "${NVM_DIR:-/dev/null}/nvm.sh"
    "/usr/local/opt/nvm/nvm.sh"        # Homebrew (Intel)
    "/opt/homebrew/opt/nvm/nvm.sh"     # Homebrew (Apple Silicon)
  )

  for loc in "${NVM_LOCATIONS[@]}"; do
    if [ -f "$loc" ]; then
      # shellcheck disable=SC1090
      source "$loc"
      if command -v nvm &>/dev/null; then
        return 0
      fi
    fi
  done

  return 1
}

setup_nvm() {
  info "Checking for nvm..."

  if ensure_nvm; then
    ok "nvm is available ($(nvm --version))"
    return 0
  fi

  warn "nvm not found — installing..."
  # Install nvm using the official install script
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

  # Source it for this session
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck disable=SC1091
  [ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"

  if command -v nvm &>/dev/null; then
    ok "nvm installed ($(nvm --version))"
  else
    fail "nvm installation failed. Please install manually: https://github.com/nvm-sh/nvm#installing-and-updating"
  fi
}

# ── Step 2: Ensure Node >= 20 ──────────────────────────────────────────────
setup_node() {
  info "Checking Node.js version..."

  # Check if current node already satisfies
  if command -v node &>/dev/null; then
    local CURRENT_MAJOR
    CURRENT_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$CURRENT_MAJOR" -ge "$REQUIRED_NODE_MAJOR" ] 2>/dev/null; then
      ok "Node $(node -v) already satisfies >= $REQUIRED_NODE_MAJOR"
      return 0
    fi
  fi

  info "Need Node >= $REQUIRED_NODE_MAJOR. Installing via nvm..."

  # Install if not already present
  if ! nvm ls "$REQUIRED_NODE_MAJOR" &>/dev/null; then
    nvm install "$REQUIRED_NODE_MAJOR"
  fi

  # Use it for this session only (does NOT change user's default)
  nvm use "$REQUIRED_NODE_MAJOR"

  local CURRENT_MAJOR
  CURRENT_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$CURRENT_MAJOR" -ge "$REQUIRED_NODE_MAJOR" ] 2>/dev/null; then
    ok "Now using Node $(node -v)"
  else
    fail "Could not switch to Node >= $REQUIRED_NODE_MAJOR. Current: $(node -v 2>/dev/null || echo 'none')"
  fi
}

# ── Step 3: Install npm dependencies ───────────────────────────────────────
install_deps() {
  info "Installing npm dependencies..."
  npm install --no-audit --no-fund 2>&1 | tail -3
  ok "Dependencies installed"
}

# ── Step 4: Compile TypeScript ──────────────────────────────────────────────
compile() {
  info "Compiling TypeScript..."
  npm run compile
  ok "Compilation successful"
}

# ── Step 5: Package .vsix ──────────────────────────────────────────────────
package_vsix() {
  info "Packaging .vsix..."

  # Remove old .vsix files
  rm -f ./*.vsix

  npx @vscode/vsce@latest package --allow-missing-repository 2>&1 | grep -E '(DONE|WARNING|ERROR)' || true

  VSIX_FILE=$(ls -t ./*.vsix 2>/dev/null | head -1)
  if [ -z "$VSIX_FILE" ]; then
    fail "Packaging failed — no .vsix file produced"
  fi

  ok "Created $(basename "$VSIX_FILE") ($(du -h "$VSIX_FILE" | cut -f1 | xargs))"
}

# ── Step 6: Install into VS Code ───────────────────────────────────────────
install_extension() {
  info "Installing extension into VS Code..."

  # Find the VS Code CLI
  local CODE_CMD=""
  if command -v code &>/dev/null; then
    CODE_CMD="code"
  elif command -v code-insiders &>/dev/null; then
    CODE_CMD="code-insiders"
  elif [ -f "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" ]; then
    CODE_CMD="/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
  elif [ -f "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code-insiders" ]; then
    CODE_CMD="/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code-insiders"
  fi

  if [ -z "$CODE_CMD" ]; then
    warn "VS Code CLI ('code') not found in PATH."
    warn "Install manually: open VS Code → Extensions → ... → Install from VSIX → select $(basename "$VSIX_FILE")"
    warn "Or add 'code' to PATH: VS Code → Cmd+Shift+P → 'Shell Command: Install code command in PATH'"
    return 0
  fi

  # Uninstall old version if present (ignore errors)
  "$CODE_CMD" --uninstall-extension clau-flo 2>/dev/null || true

  "$CODE_CMD" --install-extension "$VSIX_FILE" --force
  ok "Extension installed via '$CODE_CMD'"
}

# ── Step 7: Done ───────────────────────────────────────────────────────────
finish() {
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
}

# ── Run ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  ClauFlo — Installer${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

setup_nvm
setup_node
install_deps
compile
package_vsix
install_extension
finish
