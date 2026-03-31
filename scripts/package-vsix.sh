#!/usr/bin/env bash
# Build the .vsix without installing into VS Code.
# For full install, use: ./scripts/install.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Source nvm if available
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"

# Use Node 20+ if current is too old
NODE_MAJOR=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)
if [ "${NODE_MAJOR:-0}" -lt 20 ]; then
  if command -v nvm &>/dev/null; then
    nvm use 20 2>/dev/null || { echo "Run ./scripts/install.sh first to set up Node 20"; exit 1; }
  else
    echo "Error: Node >= 20 required (current: $(node -v 2>/dev/null || echo 'none'))"
    echo "Run ./scripts/install.sh to set up everything automatically."
    exit 1
  fi
fi

npm install --no-audit --no-fund
npm run compile
rm -f ./*.vsix
npx @vscode/vsce@latest package --allow-missing-repository

VSIX_FILE=$(ls -t ./*.vsix 2>/dev/null | head -1)
echo ""
echo "Built: $VSIX_FILE"
echo "Install with: code --install-extension $VSIX_FILE"
