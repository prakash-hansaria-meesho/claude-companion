import * as vscode from 'vscode';
import { SessionManager } from '../../session/SessionManager';
import { COMMANDS } from '../../utils/constants';

export class InlineCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  private disposables: vscode.Disposable[] = [];

  constructor(private sessionManager: SessionManager) {
    this.disposables.push(
      this.sessionManager.onDiffUpdated(() => this._onDidChangeCodeLenses.fire()),
      this.sessionManager.onFileRemoved(() => this._onDidChangeCodeLenses.fire()),
      this.sessionManager.onSessionEnded(() => this._onDidChangeCodeLenses.fire()),
    );
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!this.sessionManager.isActive || this.sessionManager.viewMode !== 'inline') {
      return [];
    }

    const diffFile = this.sessionManager.getDiffFile(document.uri.fsPath);
    if (!diffFile) {
      return [];
    }

    const lenses: vscode.CodeLens[] = [];

    for (const hunk of diffFile.hunks) {
      if (hunk.status !== 'pending') {
        continue;
      }

      const line = Math.max(0, hunk.newStart - 1);
      const range = new vscode.Range(line, 0, line, 0);

      // Accept button
      lenses.push(
        new vscode.CodeLens(range, {
          title: '$(check) Accept',
          tooltip: 'Accept this change',
          command: COMMANDS.acceptHunk,
          arguments: [document.uri.fsPath, hunk.id],
        })
      );

      // Reject button
      lenses.push(
        new vscode.CodeLens(range, {
          title: '$(x) Reject',
          tooltip: 'Reject this change and revert to original',
          command: COMMANDS.rejectHunk,
          arguments: [document.uri.fsPath, hunk.id],
        })
      );

      // Show side-by-side diff button
      lenses.push(
        new vscode.CodeLens(range, {
          title: '$(diff) Side-by-Side',
          tooltip: 'Open side-by-side diff view',
          command: COMMANDS.openFile,
          arguments: [document.uri.fsPath, 'sideBySide'],
        })
      );
    }

    return lenses;
  }

  refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  dispose(): void {
    this._onDidChangeCodeLenses.dispose();
    this.disposables.forEach(d => d.dispose());
  }
}
