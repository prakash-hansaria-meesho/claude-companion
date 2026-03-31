Hey team! :wave:

Since we moved from Cursor to Claude, one thing we've all been missing is the ability to **properly visualize code changes**. Cursor made it super intuitive — you could see exactly what changed, accept or reject individual pieces, and stay in flow. With Claude (CLI or VS Code plugin), we lost that and have been left squinting at raw diffs or manually scanning files to figure out what's new.

So I built a small VS Code extension to bring that experience back — **ClauFlo**.

---

:zap: **What it does**
- **Real-time diff visualization** — the moment Claude modifies a file, changes are highlighted in your editor
- **Two view modes** — pick what works for you:
  - *Inline mode* (like Cursor) — green highlights for additions, ghost text for deletions, right inside your editor
  - *Side-by-side mode* (like Git changes) — classic split diff view
- **Accept / Reject per change** — review each hunk individually. No more all-or-nothing
- **Changed files sidebar** — all modified files at a glance with pending change counts
- Works with both **Claude CLI** and **Claude VS Code plugin**

---

:package: **How to install (2 minutes)**

I'm attaching two files:
1. `clau-flo-0.1.0.vsix` — the extension
2. `install-vsix.sh` — the installer script

**Just run:**
```
bash ~/Downloads/install-vsix.sh
```
*(assumes both files are in your Downloads folder after downloading from Slack)*

Or if you saved them somewhere else:
```
bash install-vsix.sh /path/to/clau-flo-0.1.0.vsix
```

After install, reload VS Code (`Cmd+Shift+P` → `Developer: Reload Window`) and you'll see the **ClauFlo** icon in the Activity Bar. That's it — it starts working automatically.

---

:gear: **Quick tips**
- Toggle between inline/side-by-side: click the status bar item or `Cmd+Shift+P` → `ClauFlo: Toggle Inline/Side-by-Side`
- Accept/Reject buttons appear as CodeLens above each change hunk
- It also has an optional Claude-powered autocomplete feature (off by default) — turn it on from settings if you want to try it

Give it a shot and let me know how it goes! :raised_hands:
