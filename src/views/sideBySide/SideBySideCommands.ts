import * as vscode from 'vscode';
import * as path from 'path';
import { OriginalContentProvider } from './SideBySideDiffProvider';

export async function openSideBySideDiff(filePath: string): Promise<void> {
  const fileName = path.basename(filePath);
  const originalUri = vscode.Uri.parse(
    `${OriginalContentProvider.scheme}:${fileName}?${encodeURIComponent(filePath)}`
  );
  const currentUri = vscode.Uri.file(filePath);

  await vscode.commands.executeCommand(
    'vscode.diff',
    originalUri,
    currentUri,
    `${fileName} (Claude Changes)`,
    { preview: true }
  );
}
