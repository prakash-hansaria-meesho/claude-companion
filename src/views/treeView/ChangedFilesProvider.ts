import * as vscode from 'vscode';
import { SessionManager } from '../../session/SessionManager';
import { ChangedFileItem } from './ChangedFileItem';

export class ChangedFilesProvider implements vscode.TreeDataProvider<ChangedFileItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ChangedFileItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private disposables: vscode.Disposable[] = [];

  constructor(private sessionManager: SessionManager) {
    this.disposables.push(
      this.sessionManager.onDiffUpdated(() => this.refresh()),
      this.sessionManager.onFileRemoved(() => this.refresh()),
      this.sessionManager.onSessionStarted(() => this.refresh()),
      this.sessionManager.onSessionEnded(() => this.refresh()),
    );
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ChangedFileItem): vscode.TreeItem {
    return element;
  }

  getChildren(): ChangedFileItem[] {
    if (!this.sessionManager.isActive) {
      return [];
    }

    return this.sessionManager
      .getChangedFiles()
      .map(diffFile => new ChangedFileItem(diffFile));
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
    this.disposables.forEach(d => d.dispose());
  }
}
