# ClauFlo

A VS Code extension to visualize code diffs from Claude (CLI or VS Code plugin) in real-time, with per-change accept/reject controls.

## Features

### Diff Visualization (two modes)

**Inline mode** (Cursor-style) — Shows changes directly in the editor:
- Added lines highlighted in green
- Removed lines shown as ghost text with strikethrough
- Accept / Reject / Side-by-Side buttons above each change hunk via CodeLens

**Side-by-side mode** (Git-style) — Opens VS Code's native diff editor comparing the original file against the modified version.

Toggle between modes by clicking the status bar item or running `ClauFlo: Toggle Inline/Side-by-Side` from the command palette.

### Accept / Reject Changes
- Per-hunk accept/reject via CodeLens buttons (inline mode)
- Per-file accept/reject via sidebar context menu
- Bulk accept/reject all via sidebar toolbar
- Rejecting a hunk reverts that specific section to the original code

### Real-time File Watching
- Detects file changes from Claude CLI and VS Code plugin
- 300ms debounce for rapid writes
- Configurable exclude patterns

### Changed Files Sidebar
- Activity bar panel listing all files with pending changes
- Status icons: new / modified / deleted / resolved
- Click any file to open its diff

### Claude Autocomplete (optional)
Inline ghost-text completions powered by the Anthropic API. **Disabled by default** — enable via:
- Settings: `clauFlo.autocomplete.enabled`
- Command palette: `ClauFlo: Toggle Autocomplete`
- Status bar: click the `ClauFlo AC: OFF` item

Requires an Anthropic API key (set `ANTHROPIC_API_KEY` env variable or configure in settings).

## Installation

### From VSIX (recommended for team sharing)

```bash
# Build the .vsix package
cd claude-diff-viewer
npm install
npm run compile
npx @vscode/vsce package

# Install the generated .vsix file
code --install-extension clau-flo-0.1.0.vsix
```

### From source (development)

```bash
cd claude-diff-viewer
npm install
npm run compile
```

Then press **F5** in VS Code to launch the Extension Development Host.

## Usage

1. Open a workspace with a git repository
2. The diff session starts automatically (configurable via `clauFlo.autoStartSession`)
3. Use Claude CLI or VS Code plugin to make changes to files
4. Changes appear in the **ClauFlo** sidebar and as inline decorations
5. Accept or reject individual hunks, files, or all changes at once

### Commands

| Command | Description |
|---------|-------------|
| `ClauFlo: Start Diff Session` | Begin tracking file changes |
| `ClauFlo: End Diff Session` | Stop tracking (prompts for pending changes) |
| `ClauFlo: Toggle Inline/Side-by-Side` | Switch diff view mode |
| `ClauFlo: Accept All Changes` | Accept all pending changes |
| `ClauFlo: Reject All Changes` | Reject all and revert to original |
| `ClauFlo: Toggle Autocomplete` | Enable/disable Claude autocomplete |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `clauFlo.defaultViewMode` | `inline` | `inline` or `sideBySide` |
| `clauFlo.autoStartSession` | `true` | Auto-start diff session on workspace open |
| `clauFlo.debounceMs` | `300` | File change detection debounce (ms) |
| `clauFlo.excludePatterns` | see defaults | Glob patterns to exclude from watching |
| `clauFlo.autocomplete.enabled` | `false` | Enable Claude autocomplete |
| `clauFlo.autocomplete.apiKey` | `""` | Anthropic API key (or use `ANTHROPIC_API_KEY` env var) |
| `clauFlo.autocomplete.model` | `claude-haiku-4-5-20251001` | Model for completions |
| `clauFlo.autocomplete.maxTokens` | `256` | Max tokens per completion |
| `clauFlo.autocomplete.debounceMs` | `500` | Autocomplete trigger debounce (ms) |

## How It Works

1. On session start, the extension snapshots all tracked files using `git show HEAD:<path>`
2. A `FileSystemWatcher` monitors file changes in real-time
3. When a file changes, the `diff` library computes structured hunks between the snapshot and current content
4. Hunks are rendered as inline decorations (CodeLens + highlights) or via VS Code's diff editor
5. Accepting a hunk marks it resolved; rejecting a hunk rewrites the file section back to the original

## Requirements

- VS Code 1.85.0 or later
- Git installed and available in PATH
- Workspace must be inside a git repository (for baseline snapshots)
- For autocomplete: Anthropic API key
