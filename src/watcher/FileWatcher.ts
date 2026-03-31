import * as vscode from 'vscode';
import { SessionManager } from '../session/SessionManager';
import { CONFIG } from '../utils/constants';

/**
 * Watches for file changes and only forwards EXTERNAL changes (e.g. Claude
 * CLI writing to disk) to the SessionManager.
 *
 * How it works:
 * - When the user saves a file from VS Code, `onDidSaveTextDocument` fires
 *   BEFORE the `FileSystemWatcher.onDidChange`. We record the file path + timestamp.
 * - When `FileSystemWatcher.onDidChange` fires, we check if it was preceded
 *   by a VS Code save within a short window. If yes → user edit, skip it.
 *   If no → external write (Claude), process it.
 * - User edits that are NOT saved don't trigger `FileSystemWatcher` at all,
 *   so they're naturally ignored.
 */
export class FileWatcher implements vscode.Disposable {
  private watcher: vscode.FileSystemWatcher;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private disposables: vscode.Disposable[] = [];
  private debounceMs: number;
  private excludePatterns: string[];

  /** Files recently saved by the user inside VS Code */
  private recentUserSaves: Map<string, number> = new Map();
  /** How long to consider a save as "recent" (ms) */
  private readonly USER_SAVE_WINDOW_MS = 1500;

  constructor(private sessionManager: SessionManager) {
    const config = vscode.workspace.getConfiguration();
    this.debounceMs = config.get<number>(CONFIG.debounceMs, 300);
    this.excludePatterns = config.get<string[]>(CONFIG.excludePatterns, [
      '**/node_modules/**',
      '**/.git/**',
      '**/out/**',
      '**/dist/**',
      '**/*.lock',
    ]);

    this.watcher = vscode.workspace.createFileSystemWatcher('**/*');

    this.disposables.push(
      // Track user-initiated saves
      vscode.workspace.onDidSaveTextDocument(doc => {
        this.recentUserSaves.set(doc.uri.fsPath, Date.now());
        // Clean up after the window expires
        setTimeout(() => {
          this.recentUserSaves.delete(doc.uri.fsPath);
        }, this.USER_SAVE_WINDOW_MS + 100);
      }),

      this.watcher.onDidChange(uri => this.onFileChanged(uri)),
      this.watcher.onDidCreate(uri => this.onFileCreated(uri)),
      this.watcher.onDidDelete(uri => this.onFileDeleted(uri)),
      this.watcher,
    );

    // Listen for config changes
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('clauFlo')) {
          const newConfig = vscode.workspace.getConfiguration();
          this.debounceMs = newConfig.get<number>(CONFIG.debounceMs, 300);
          this.excludePatterns = newConfig.get<string[]>(CONFIG.excludePatterns, []);
        }
      })
    );
  }

  /**
   * Returns true if this file was recently saved by the user from within
   * VS Code (i.e. NOT an external write from Claude).
   */
  private isUserSave(uri: vscode.Uri): boolean {
    const saveTime = this.recentUserSaves.get(uri.fsPath);
    if (!saveTime) {
      return false;
    }
    const elapsed = Date.now() - saveTime;
    return elapsed < this.USER_SAVE_WINDOW_MS;
  }

  private shouldExclude(uri: vscode.Uri): boolean {
    const relativePath = vscode.workspace.asRelativePath(uri);
    for (const pattern of this.excludePatterns) {
      if (this.simpleGlobMatch(pattern, relativePath)) {
        return true;
      }
    }
    return false;
  }

  private simpleGlobMatch(pattern: string, filePath: string): boolean {
    const regexStr = pattern
      .replace(/\*\*/g, '___DOUBLESTAR___')
      .replace(/\*/g, '[^/]*')
      .replace(/___DOUBLESTAR___/g, '.*')
      .replace(/\?/g, '.');
    try {
      return new RegExp(`^${regexStr}$`).test(filePath);
    } catch {
      return false;
    }
  }

  private onFileChanged(uri: vscode.Uri): void {
    if (!this.sessionManager.isActive || this.shouldExclude(uri)) {
      return;
    }

    // Skip changes that came from the user saving in VS Code
    if (this.isUserSave(uri)) {
      return;
    }

    this.debounce(uri, () => {
      this.sessionManager.handleFileChange(uri);
    });
  }

  private onFileCreated(uri: vscode.Uri): void {
    if (!this.sessionManager.isActive || this.shouldExclude(uri)) {
      return;
    }

    // New files created by user (e.g. via VS Code's New File) are saved
    // immediately, so they'll be caught by isUserSave. External creates
    // (Claude creating a new file) won't have a preceding save event.
    if (this.isUserSave(uri)) {
      return;
    }

    this.debounce(uri, () => {
      this.sessionManager.handleFileCreation(uri);
    });
  }

  private onFileDeleted(uri: vscode.Uri): void {
    if (!this.sessionManager.isActive || this.shouldExclude(uri)) {
      return;
    }

    // File deletions are processed immediately (no debounce)
    // User deletions from VS Code explorer also don't trigger onDidSave,
    // but external deletes (Claude) are rare. Allow both for safety.
    this.sessionManager.handleFileChange(uri);
  }

  private debounce(uri: vscode.Uri, callback: () => void): void {
    const key = uri.fsPath;
    const existing = this.debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    this.debounceTimers.set(
      key,
      setTimeout(() => {
        this.debounceTimers.delete(key);
        callback();
      }, this.debounceMs)
    );
  }

  dispose(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.recentUserSaves.clear();
    this.disposables.forEach(d => d.dispose());
  }
}
