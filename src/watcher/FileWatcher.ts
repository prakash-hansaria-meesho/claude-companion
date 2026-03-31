import * as vscode from 'vscode';
import { SessionManager } from '../session/SessionManager';
import { CONFIG } from '../utils/constants';

/**
 * Watches for file changes and distinguishes user edits from Claude's writes.
 *
 * Strategy:
 * - When the user saves a file from VS Code, update the snapshot baseline
 *   so user edits don't appear as diffs.
 * - When FileSystemWatcher fires (external disk write by Claude), process
 *   the change immediately and mark the file as "externally changed" so
 *   that any subsequent auto-save doesn't reset the snapshot.
 *
 * Race condition handled:
 *   Claude writes → FSWatcher fires → VS Code reloads → auto-save fires
 *   → onDidSaveTextDocument. Without protection, auto-save would reset the
 *   snapshot to Claude's content, wiping the diff. We block snapshot updates
 *   for files with recent external changes.
 */
export class FileWatcher implements vscode.Disposable {
  private watcher: vscode.FileSystemWatcher;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private disposables: vscode.Disposable[] = [];
  private debounceMs: number;
  private excludePatterns: string[];

  /**
   * Files that were recently changed externally (by Claude).
   * We block snapshot updates for these files to prevent auto-save
   * from resetting the baseline after VS Code reloads the document.
   */
  private recentExternalChanges: Map<string, number> = new Map();
  private readonly EXTERNAL_CHANGE_WINDOW_MS = 3000;

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
      // When user saves a file in VS Code, update the snapshot baseline —
      // BUT skip if the file was recently changed externally (Claude).
      vscode.workspace.onDidSaveTextDocument(doc => {
        if (!this.sessionManager.isActive || this.shouldExclude(doc.uri)) {
          return;
        }
        const filePath = doc.uri.fsPath;

        // If this file was recently written by Claude, DON'T update the
        // snapshot — that would erase the diff we just computed.
        const externalTime = this.recentExternalChanges.get(filePath);
        if (externalTime && (Date.now() - externalTime) < this.EXTERNAL_CHANGE_WINDOW_MS) {
          return;
        }

        this.sessionManager.updateSnapshot(filePath, doc.getText());
      }),

      this.watcher.onDidChange(uri => this.onFileChanged(uri)),
      this.watcher.onDidCreate(uri => this.onFileCreated(uri)),
      this.watcher.onDidDelete(uri => this.onFileDeleted(uri)),
      this.watcher,
    );

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

  private markExternalChange(filePath: string): void {
    this.recentExternalChanges.set(filePath, Date.now());
    // Clean up after the window expires
    setTimeout(() => {
      this.recentExternalChanges.delete(filePath);
    }, this.EXTERNAL_CHANGE_WINDOW_MS + 500);
  }

  private onFileChanged(uri: vscode.Uri): void {
    if (!this.sessionManager.isActive || this.shouldExclude(uri)) {
      return;
    }

    // Mark as external change to block auto-save from resetting snapshot
    this.markExternalChange(uri.fsPath);

    this.debounce(uri, () => {
      this.sessionManager.handleFileChange(uri);
    });
  }

  private onFileCreated(uri: vscode.Uri): void {
    if (!this.sessionManager.isActive || this.shouldExclude(uri)) {
      return;
    }

    this.markExternalChange(uri.fsPath);

    this.debounce(uri, () => {
      this.sessionManager.handleFileCreation(uri);
    });
  }

  private onFileDeleted(uri: vscode.Uri): void {
    if (!this.sessionManager.isActive || this.shouldExclude(uri)) {
      return;
    }

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
    this.recentExternalChanges.clear();
    this.disposables.forEach(d => d.dispose());
  }
}
