Hey team! :wave:

Since we moved from Cursor to Claude, we've been struggling to **visualize code changes** properly. So I built a VS Code extension to bring that experience back — **ClauFlo v2**.

---

:thinking_face: **The problem**
Claude (CLI/plugin) modifies our files, but there's no clean way to see what changed, or accept/reject individual pieces like Cursor did.

:zap: **What ClauFlo does**
- **Real-time diff visualization** with two view modes:
  - **Inline** (like Cursor) — green highlights for additions, ghost text for deletions, accept/reject buttons per change
  - **Side-by-side** (like Git) — classic split diff view
- **Autocomplete** powered by Claude Code CLI — uses our org license, no API key needed
- Sidebar showing all changed files with pending counts

---

:package: **Install (1 command)**
```
git clone https://github.com/prakash-hansaria-meesho/claude-companion.git && bash claude-companion/scripts/install-vsix.sh
```
The script handles everything: nvm, Node.js 20, and the extension install. Then reload VS Code (`Cmd+Shift+P` → `Developer: Reload Window`).

---

:book: **How to use**

**Diff Viewer (enabled by default):**
1. Click the **ClauFlo** icon in the Activity Bar — session starts automatically
2. Use Claude as normal — changes appear in real-time
3. Click `Accept` / `Reject` on each change, or bulk accept/reject from the sidebar
4. Toggle view mode: `Cmd+Shift+P` → `ClauFlo: Toggle Inline/Side-by-Side`

**Autocomplete (opt-in):**
1. `Cmd+Shift+P` → `ClauFlo: Toggle Autocomplete`
2. Uses Claude Code CLI under the hood — works with our org license, no API key setup needed
3. Just type and you'll see inline suggestions

---

Repo: https://github.com/prakash-hansaria-meesho/claude-companion
Give it a spin! :raised_hands:
