import * as vscode from 'vscode';
import { SessionManager } from '../../session/SessionManager';
import { DiffComputer } from '../../diff/DiffComputer';
import { DiffFile, DiffHunk } from '../../diff/types';

export class InlineDecorationManager implements vscode.Disposable {
  private addedDecorationType: vscode.TextEditorDecorationType;
  private removedGutterDecorationType: vscode.TextEditorDecorationType;
  private removedTextDecorationType: vscode.TextEditorDecorationType;
  private hunkBorderDecorationType: vscode.TextEditorDecorationType;
  private disposables: vscode.Disposable[] = [];
  private diffComputer: DiffComputer;

  constructor(private sessionManager: SessionManager) {
    this.diffComputer = new DiffComputer();

    // Green background for added lines
    this.addedDecorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor('clauFlo.addedLineBackground'),
      isWholeLine: true,
      overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.addedForeground'),
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    });

    // Gutter indicator for removed lines
    this.removedGutterDecorationType = vscode.window.createTextEditorDecorationType({
      gutterIconPath: undefined, // Will be set per decoration
      gutterIconSize: 'contain',
      isWholeLine: true,
    });

    // Strikethrough styling for removed text shown as before-content
    this.removedTextDecorationType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
    });

    // Subtle border between hunks
    this.hunkBorderDecorationType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      borderWidth: '1px 0 0 0',
      borderStyle: 'dashed',
      borderColor: new vscode.ThemeColor('editorLineNumber.foreground'),
    });

    // Listen for diff updates
    this.disposables.push(
      this.sessionManager.onDiffUpdated(diffFile => this.updateDecorations(diffFile)),
      this.sessionManager.onSessionEnded(() => this.clearAllDecorations()),
      this.sessionManager.onFileRemoved(() => this.clearAllDecorations()),
      vscode.window.onDidChangeActiveTextEditor(() => this.refreshActiveEditor()),
    );
  }

  private updateDecorations(diffFile: DiffFile): void {
    if (this.sessionManager.viewMode !== 'inline') {
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.fsPath !== diffFile.filePath) {
      return;
    }

    this.applyDecorations(editor, diffFile);
  }

  refreshActiveEditor(): void {
    if (this.sessionManager.viewMode !== 'inline') {
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    const diffFile = this.sessionManager.getDiffFile(editor.document.uri.fsPath);
    if (diffFile) {
      this.applyDecorations(editor, diffFile);
    } else {
      this.clearDecorations(editor);
    }
  }

  private applyDecorations(editor: vscode.TextEditor, diffFile: DiffFile): void {
    const addedRanges: vscode.DecorationOptions[] = [];
    const removedDecorations: vscode.DecorationOptions[] = [];
    const hunkBorders: vscode.DecorationOptions[] = [];

    for (const hunk of diffFile.hunks) {
      if (hunk.status !== 'pending') {
        continue;
      }

      // Hunk border at the start
      hunkBorders.push({
        range: new vscode.Range(
          Math.max(0, hunk.newStart - 1), 0,
          Math.max(0, hunk.newStart - 1), 0
        ),
      });

      // Track line in the new file
      let newLine = hunk.newStart - 1; // 0-indexed

      for (const change of hunk.changes) {
        if (change.type === 'add') {
          addedRanges.push({
            range: new vscode.Range(newLine, 0, newLine, Number.MAX_SAFE_INTEGER),
          });
          newLine++;
        } else if (change.type === 'remove') {
          // Show removed lines as ghost text before the current position
          const removedLineText = change.content;
          const insertAtLine = Math.max(0, newLine - 1);

          removedDecorations.push({
            range: new vscode.Range(insertAtLine, 0, insertAtLine, 0),
            renderOptions: {
              after: {
                contentText: `  ??? ${removedLineText}`,
                color: new vscode.ThemeColor('editorGhostText.foreground'),
                fontStyle: 'italic',
                textDecoration: '; opacity: 0.6; text-decoration: line-through',
              },
            },
          });
        } else {
          // Context line
          newLine++;
        }
      }
    }

    editor.setDecorations(this.addedDecorationType, addedRanges);
    editor.setDecorations(this.removedTextDecorationType, removedDecorations);
    editor.setDecorations(this.hunkBorderDecorationType, hunkBorders);
  }

  private clearDecorations(editor: vscode.TextEditor): void {
    editor.setDecorations(this.addedDecorationType, []);
    editor.setDecorations(this.removedTextDecorationType, []);
    editor.setDecorations(this.hunkBorderDecorationType, []);
  }

  clearAllDecorations(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.clearDecorations(editor);
    }
  }

  dispose(): void {
    this.addedDecorationType.dispose();
    this.removedGutterDecorationType.dispose();
    this.removedTextDecorationType.dispose();
    this.hunkBorderDecorationType.dispose();
    this.disposables.forEach(d => d.dispose());
  }
}
