export const EXTENSION_ID = 'clau-flo';
export const ORIGINAL_CONTENT_SCHEME = 'claude-diff-original';

export const COMMANDS = {
  startSession: `${EXTENSION_ID}.startSession`,
  endSession: `${EXTENSION_ID}.endSession`,
  toggleViewMode: `${EXTENSION_ID}.toggleViewMode`,
  acceptHunk: `${EXTENSION_ID}.acceptHunk`,
  rejectHunk: `${EXTENSION_ID}.rejectHunk`,
  acceptAllFile: `${EXTENSION_ID}.acceptAllFile`,
  rejectAllFile: `${EXTENSION_ID}.rejectAllFile`,
  acceptAll: `${EXTENSION_ID}.acceptAll`,
  rejectAll: `${EXTENSION_ID}.rejectAll`,
  openFile: `${EXTENSION_ID}.openFile`,
  refreshSession: `${EXTENSION_ID}.refreshSession`,
} as const;

export const CONFIG = {
  defaultViewMode: 'clauFlo.defaultViewMode',
  autoStartSession: 'clauFlo.autoStartSession',
  debounceMs: 'clauFlo.debounceMs',
  excludePatterns: 'clauFlo.excludePatterns',
} as const;

export const CONTEXT_KEYS = {
  sessionActive: `${EXTENSION_ID}.sessionActive`,
} as const;
