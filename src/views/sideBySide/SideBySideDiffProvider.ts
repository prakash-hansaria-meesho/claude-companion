import * as vscode from 'vscode';
import { SessionManager } from '../../session/SessionManager';
import { ORIGINAL_CONTENT_SCHEME } from '../../utils/constants';

export class OriginalContentProvider implements vscode.TextDocumentContentProvider {
  static readonly scheme = ORIGINAL_CONTENT_SCHEME;

  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private sessionManager: SessionManager) {}

  provideTextDocumentContent(uri: vscode.Uri): string {
    // The query param holds the encoded real file path
    const filePath = decodeURIComponent(uri.query);
    return this.sessionManager.getSnapshot(filePath) ?? '';
  }

  refresh(uri: vscode.Uri): void {
    this._onDidChange.fire(uri);
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
