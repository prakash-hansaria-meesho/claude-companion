import * as vscode from 'vscode';
import * as path from 'path';
import { DiffFile } from '../../diff/types';

export class ChangedFileItem extends vscode.TreeItem {
  constructor(public readonly diffFile: DiffFile) {
    super(
      path.basename(diffFile.relativePath),
      vscode.TreeItemCollapsibleState.None
    );

    const pendingCount = diffFile.hunks.filter(h => h.status === 'pending').length;
    const totalCount = diffFile.hunks.length;
    const acceptedCount = diffFile.hunks.filter(h => h.status === 'accepted').length;

    this.description = `${diffFile.relativePath} (${pendingCount}/${totalCount} pending)`;
    this.tooltip = new vscode.MarkdownString(
      `**${diffFile.relativePath}**\n\n` +
      `- Total hunks: ${totalCount}\n` +
      `- Pending: ${pendingCount}\n` +
      `- Accepted: ${acceptedCount}\n` +
      `- Rejected: ${totalCount - pendingCount - acceptedCount}`
    );

    this.contextValue = 'changedFile';

    // Icon based on file status
    if (diffFile.isNew) {
      this.iconPath = new vscode.ThemeIcon('new-file', new vscode.ThemeColor('gitDecoration.addedResourceForeground'));
    } else if (diffFile.isDeleted) {
      this.iconPath = new vscode.ThemeIcon('trash', new vscode.ThemeColor('gitDecoration.deletedResourceForeground'));
    } else if (pendingCount === 0) {
      this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('gitDecoration.untrackedResourceForeground'));
    } else {
      this.iconPath = new vscode.ThemeIcon('diff-modified', new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'));
    }

    // Click to open
    this.command = {
      command: 'clau-flo.openFile',
      title: 'Open Diff',
      arguments: [diffFile.filePath],
    };

    this.resourceUri = vscode.Uri.file(diffFile.filePath);
  }
}
