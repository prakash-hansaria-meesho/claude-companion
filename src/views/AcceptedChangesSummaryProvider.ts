import * as vscode from 'vscode';
import * as path from 'path';
import { createPatch } from 'diff';
import { DiffFile } from '../diff/types';

/**
 * Shows a read-only summary tab of all accepted changes from the current
 * Claude session. Only includes session-tracked diffs, not all git changes.
 */
export class AcceptedChangesSummaryProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  static readonly scheme = 'clau-flo-accepted';

  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  private _content = '';

  provideTextDocumentContent(): string {
    return this._content;
  }

  /**
   * Captures a unified diff summary of all accepted changes and opens it
   * in a new editor tab.
   *
   * @param diffFiles - The DiffFile list at the moment of acceptance (before clearing)
   * @param snapshots - Map of filePath -> original content from session start
   * @param currentContents - Map of filePath -> file content at time of acceptance
   * @param workspaceRoot - Workspace root for relative path display
   */
  async showSummary(
    diffFiles: DiffFile[],
    snapshots: Map<string, string>,
    currentContents: Map<string, string>,
    workspaceRoot: string
  ): Promise<void> {
    const sections: string[] = [];
    const timestamp = new Date().toLocaleString();
    let totalAdded = 0;
    let totalRemoved = 0;

    sections.push(`# ClauFlo — Accepted Changes Summary`);
    sections.push(`# ${timestamp}`);
    sections.push(`# ${diffFiles.length} file(s) changed`);
    sections.push('');

    for (const diffFile of diffFiles) {
      const pendingOrAcceptedHunks = diffFile.hunks.filter(
        h => h.status === 'pending' || h.status === 'accepted'
      );
      if (pendingOrAcceptedHunks.length === 0 && !diffFile.isNew && !diffFile.isDeleted) {
        continue;
      }

      const relativePath = path.relative(workspaceRoot, diffFile.filePath) || diffFile.relativePath;
      const original = snapshots.get(diffFile.filePath) ?? '';
      const current = currentContents.get(diffFile.filePath) ?? '';

      if (diffFile.isNew) {
        sections.push(`${'='.repeat(70)}`);
        sections.push(`NEW FILE: ${relativePath}`);
        sections.push(`${'='.repeat(70)}`);
        const lines = current.split('\n');
        for (const line of lines) {
          sections.push(`+ ${line}`);
          totalAdded++;
        }
        sections.push('');
        continue;
      }

      if (diffFile.isDeleted) {
        sections.push(`${'='.repeat(70)}`);
        sections.push(`DELETED FILE: ${relativePath}`);
        sections.push(`${'='.repeat(70)}`);
        const lines = original.split('\n');
        for (const line of lines) {
          sections.push(`- ${line}`);
          totalRemoved++;
        }
        sections.push('');
        continue;
      }

      // Generate unified diff
      const patch = createPatch(
        relativePath,
        original,
        current,
        'original',
        'modified',
        { context: 3 }
      );

      // Count additions/removals
      for (const line of patch.split('\n')) {
        if (line.startsWith('+') && !line.startsWith('+++')) {
          totalAdded++;
        }
        if (line.startsWith('-') && !line.startsWith('---')) {
          totalRemoved++;
        }
      }

      sections.push(`${'='.repeat(70)}`);
      sections.push(`MODIFIED: ${relativePath}`);
      sections.push(`${'='.repeat(70)}`);
      sections.push(patch);
      sections.push('');
    }

    // Add stats at the top
    const stats = `# +${totalAdded} additions, -${totalRemoved} deletions`;
    sections.splice(3, 0, stats);

    this._content = sections.join('\n');

    const uri = vscode.Uri.parse(
      `${AcceptedChangesSummaryProvider.scheme}:Accepted Changes — ${timestamp}.diff`
    );
    this._onDidChange.fire(uri);

    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, {
      preview: false,
      viewColumn: vscode.ViewColumn.Active,
    });
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
