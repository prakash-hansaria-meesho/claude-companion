# ClauFlo — Install Guide

## One-command install (recommended)

```bash
cd claude-diff-viewer
./scripts/install.sh
```

That's it. The script handles everything automatically:

- Installs **nvm** if not already present
- Installs **Node 20** via nvm (does not change your default node version)
- Installs npm dependencies
- Compiles TypeScript
- Packages the `.vsix` extension file
- Installs the extension into VS Code

After it finishes, reload VS Code (`Cmd+Shift+P` → `Developer: Reload Window`).

## Install from a shared .vsix file

If a teammate has already built and shared the `.vsix` file:

```bash
code --install-extension clau-flo-0.1.0.vsix
```

Or in VS Code: **Extensions sidebar → ... menu → Install from VSIX...**

## Build only (without installing)

```bash
./scripts/package-vsix.sh
```

Produces `clau-flo-x.y.z.vsix` in the project root.

## After installation

1. **Reload VS Code** — `Cmd+Shift+P` → `Developer: Reload Window`
2. Look for the **ClauFlo** icon in the Activity Bar (left sidebar)
3. The diff session starts automatically when you open a git workspace
4. Claude's file changes will appear as inline diffs with Accept/Reject buttons

### Optional: enable autocomplete

1. `Cmd+Shift+P` → `ClauFlo: Toggle Autocomplete`
2. Set your API key via `ANTHROPIC_API_KEY` env variable, or in VS Code settings under `clauFlo.autocomplete.apiKey`

## Uninstall

```bash
code --uninstall-extension clau-flo
```

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `nvm: command not found` after install | Close and reopen your terminal, then re-run the script |
| `code: command not found` | In VS Code: `Cmd+Shift+P` → `Shell Command: Install 'code' command in PATH` |
| Permission denied on script | `chmod +x scripts/install.sh` |
| Node install fails behind proxy | Set `https_proxy` env variable before running the script |
