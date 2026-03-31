import * as vscode from 'vscode';
import * as fs from 'fs';
import { SessionManager } from '../session/SessionManager';
import { CONFIG } from '../utils/constants';

/**
 * Watches for file changes and distinguishes user edits from Claude's writes.
 *
 * Strategy:
 * - When the user saves a file from VS Code (onDidSaveTextDocument), we
 *   update the snapshot to the saved content. This resets the baseline.
 * - When FileSystemWatcher fires (disk change), we compute the diff against
 *   the snapshot. Since user saves reset the snapshot, only EXTERNAL changes
 *   (Claude CLI writing directly to disk) will produce diffs.
 * - This naturally handles auto-save, manual save, and any VS Code-initiated
 *   writes — they all reset the baseline.
 */
export class FileWatcher implements vscode.Disposable {
  private watcher: vscode.FileSystemWatcher;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private disposables: vscode.Disposable[] = [];
  private debounceMs: number;
  private excludePatterns: string[];

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
      // When user saves a file in VS Code, update the snapshot baseline.
      // This ensures the user's own edits never show up as Claude diffs.
      vscode.workspace.onDidSaveTextDocument(doc => {
        if (this.sessionManager.isActive && !this.shouldExclude(doc.uri)) {
          this.sessionManager.updateSnapshot(doc.uri.fsPath, doc.getText());
        }
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

    this.debounce(uri, () => {
      this.sessionManager.handleFileChange(uri);
    });
  }

  private onFileCreated(uri: vscode.Uri): void {
    if (!this.sessionManager.isActive || this.shouldExclude(uri)) {
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
    this.disposables.forEach(d => d.dispose());
  }
}
