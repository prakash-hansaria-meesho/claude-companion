import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { GitHelper } from '../git/GitHelper';
import { DiffComputer } from '../diff/DiffComputer';
import { DiffFile, DiffHunk, FileSnapshot, ViewMode } from '../diff/types';
import { CONTEXT_KEYS, CONFIG } from '../utils/constants';

export class SessionManager implements vscode.Disposable {
  private snapshots: Map<string, FileSnapshot> = new Map();
  private diffFiles: Map<string, DiffFile> = new Map();
  private gitHelper: GitHelper;
  private diffComputer: DiffComputer;
  private _isActive = false;
  private _viewMode: ViewMode;
  private workspaceRoot: string;

  private _onSessionStarted = new vscode.EventEmitter<void>();
  private _onSessionEnded = new vscode.EventEmitter<void>();
  private _onDiffUpdated = new vscode.EventEmitter<DiffFile>();
  private _onFileRemoved = new vscode.EventEmitter<string>();

  readonly onSessionStarted = this._onSessionStarted.event;
  readonly onSessionEnded = this._onSessionEnded.event;
  readonly onDiffUpdated = this._onDiffUpdated.event;
  readonly onFileRemoved = this._onFileRemoved.event;

  get isActive(): boolean {
    return this._isActive;
  }

  get viewMode(): ViewMode {
    return this._viewMode;
  }

  constructor(private context: vscode.ExtensionContext) {
    const folders = vscode.workspace.workspaceFolders;
    this.workspaceRoot = folders?.[0]?.uri.fsPath ?? '';
    this.gitHelper = new GitHelper(this.workspaceRoot);
    this.diffComputer = new DiffComputer();

    const configMode = vscode.workspace.getConfiguration().get<string>(CONFIG.defaultViewMode, 'inline');
    this._viewMode = configMode as ViewMode;
  }

  async start(): Promise<void> {
    if (this._isActive) {
      return;
    }

    const isGit = await this.gitHelper.isGitRepo();
    if (!isGit) {
      vscode.window.showWarningMessage('ClauFlo: No git repository found. Using in-memory snapshots.');
    }

    this._isActive = true;
    await vscode.commands.executeCommand('setContext', CONTEXT_KEYS.sessionActive, true);

    // Take initial snapshots of all tracked + modified files
    await this.takeInitialSnapshots();

    this._onSessionStarted.fire();
    vscode.window.showInformationMessage('ClauFlo: Diff session started');
  }

  async end(): Promise<void> {
    if (!this._isActive) {
      return;
    }

    const pendingCount = this.getPendingHunkCount();
    if (pendingCount > 0) {
      const action = await vscode.window.showWarningMessage(
        `${pendingCount} pending changes. What would you like to do?`,
        'Accept All',
        'Reject All',
        'Cancel'
      );
      if (action === 'Accept All') {
        this.acceptAllChanges();
      } else if (action === 'Reject All') {
        await this.rejectAllChanges();
      } else {
        return;
      }
    }

    this._isActive = false;
    this.snapshots.clear();
    this.diffFiles.clear();
    await vscode.commands.executeCommand('setContext', CONTEXT_KEYS.sessionActive, false);

    this._onSessionEnded.fire();
    vscode.window.showInformationMessage('ClauFlo: Diff session ended');
  }

  toggleViewMode(): ViewMode {
    this._viewMode = this._viewMode === 'inline' ? 'sideBySide' : 'inline';
    // Re-fire events for all active diffs so views can update
    for (const diffFile of this.diffFiles.values()) {
      this._onDiffUpdated.fire(diffFile);
    }
    return this._viewMode;
  }

  async handleFileChange(uri: vscode.Uri): Promise<void> {
    if (!this._isActive) {
      return;
    }

    const filePath = uri.fsPath;
    const relativePath = path.relative(this.workspaceRoot, filePath);

    // Ensure we have a snapshot
    if (!this.snapshots.has(filePath)) {
      await this.snapshotFile(filePath, relativePath);
    }

    // Read current content
    let currentContent: string;
    try {
      currentContent = fs.readFileSync(filePath, 'utf-8');
    } catch {
      // File was deleted
      this.handleFileDeletion(filePath, relativePath);
      return;
    }

    const snapshot = this.snapshots.get(filePath);
    if (!snapshot) {
      return;
    }

    // Compute diff
    const hunks = this.diffComputer.computeHunks(snapshot.originalContent, currentContent, filePath);

    if (hunks.length === 0) {
      // No differences - remove from tracking
      this.diffFiles.delete(filePath);
      this._onFileRemoved.fire(filePath);
      return;
    }

    // Preserve status of existing hunks where possible
    const existingFile = this.diffFiles.get(filePath);
    if (existingFile) {
      this.preserveHunkStatuses(existingFile.hunks, hunks);
    }

    const diffFile: DiffFile = {
      filePath,
      relativePath,
      hunks,
      isNew: snapshot.originalContent === '',
      isDeleted: false,
    };

    this.diffFiles.set(filePath, diffFile);
    this._onDiffUpdated.fire(diffFile);
  }

  handleFileCreation(uri: vscode.Uri): void {
    if (!this._isActive) {
      return;
    }

    const filePath = uri.fsPath;
    const relativePath = path.relative(this.workspaceRoot, filePath);

    // New file: snapshot is empty
    this.snapshots.set(filePath, {
      filePath,
      originalContent: '',
      timestamp: Date.now(),
    });

    // Trigger a change to compute the diff
    this.handleFileChange(uri);
  }

  private handleFileDeletion(filePath: string, relativePath: string): void {
    const snapshot = this.snapshots.get(filePath);
    if (!snapshot || snapshot.originalContent === '') {
      // Was a new file that got deleted - just remove
      this.diffFiles.delete(filePath);
      this._onFileRemoved.fire(filePath);
      return;
    }

    const diffFile: DiffFile = {
      filePath,
      relativePath,
      hunks: [],
      isNew: false,
      isDeleted: true,
    };
    this.diffFiles.set(filePath, diffFile);
    this._onDiffUpdated.fire(diffFile);
  }

  getSnapshot(filePath: string): string | undefined {
    return this.snapshots.get(filePath)?.originalContent;
  }

  getDiffFile(filePath: string): DiffFile | undefined {
    return this.diffFiles.get(filePath);
  }

  getHunk(filePath: string, hunkId: string): DiffHunk | undefined {
    const diffFile = this.diffFiles.get(filePath);
    return diffFile?.hunks.find(h => h.id === hunkId);
  }

  getChangedFiles(): DiffFile[] {
    return Array.from(this.diffFiles.values());
  }

  getPendingHunkCount(): number {
    let count = 0;
    for (const diffFile of this.diffFiles.values()) {
      count += diffFile.hunks.filter(h => h.status === 'pending').length;
    }
    return count;
  }

  markHunkAccepted(filePath: string, hunkId: string): void {
    const hunk = this.getHunk(filePath, hunkId);
    if (hunk) {
      hunk.status = 'accepted';
      const diffFile = this.diffFiles.get(filePath);
      if (diffFile) {
        this._onDiffUpdated.fire(diffFile);
      }
    }
  }

  async markHunkRejected(filePath: string, hunkId: string): Promise<boolean> {
    const diffFile = this.diffFiles.get(filePath);
    const hunk = diffFile?.hunks.find(h => h.id === hunkId);
    const snapshot = this.snapshots.get(filePath);
    if (!diffFile || !hunk || !snapshot) {
      return false;
    }

    // Read current file
    let currentContent: string;
    try {
      currentContent = fs.readFileSync(filePath, 'utf-8');
    } catch {
      return false;
    }

    // Build the replacement: take original lines for this hunk
    const currentLines = currentContent.split('\n');
    const originalLines = this.diffComputer.getOriginalLinesForHunk(hunk);
    const newLines = this.diffComputer.getNewLinesForHunk(hunk);

    // Find the new content lines in the file and replace with original
    const startLine = hunk.newStart - 1;
    const endLine = startLine + newLines.length;

    const resultLines = [
      ...currentLines.slice(0, startLine),
      ...originalLines,
      ...currentLines.slice(endLine),
    ];

    const newContent = resultLines.join('\n');
    fs.writeFileSync(filePath, newContent, 'utf-8');

    hunk.status = 'rejected';

    // Recompute all hunks since line numbers shifted
    await this.recomputeHunks(filePath);
    return true;
  }

  /**
   * Returns a snapshot of all session-tracked diffs, original contents, and
   * current file contents. Call this BEFORE acceptAllChanges() to capture
   * what's about to be accepted.
   */
  captureAcceptedState(): {
    diffFiles: DiffFile[];
    snapshots: Map<string, string>;
    currentContents: Map<string, string>;
    workspaceRoot: string;
  } {
    const diffFilesCopy: DiffFile[] = [];
    const snapshotsCopy = new Map<string, string>();
    const currentContents = new Map<string, string>();

    for (const diffFile of this.diffFiles.values()) {
      // Only include files that have pending changes (about to be accepted)
      const hasPending = diffFile.hunks.some(h => h.status === 'pending');
      if (!hasPending && !diffFile.isNew && !diffFile.isDeleted) {
        continue;
      }

      diffFilesCopy.push({ ...diffFile, hunks: diffFile.hunks.map(h => ({ ...h })) });

      const snapshot = this.snapshots.get(diffFile.filePath);
      snapshotsCopy.set(diffFile.filePath, snapshot?.originalContent ?? '');

      try {
        currentContents.set(diffFile.filePath, fs.readFileSync(diffFile.filePath, 'utf-8'));
      } catch {
        currentContents.set(diffFile.filePath, '');
      }
    }

    return {
      diffFiles: diffFilesCopy,
      snapshots: snapshotsCopy,
      currentContents,
      workspaceRoot: this.workspaceRoot,
    };
  }

  acceptAllChanges(): void {
    for (const diffFile of this.diffFiles.values()) {
      for (const hunk of diffFile.hunks) {
        if (hunk.status === 'pending') {
          hunk.status = 'accepted';
        }
      }
      this._onDiffUpdated.fire(diffFile);
    }
  }

  async rejectAllChanges(): Promise<void> {
    for (const [filePath, snapshot] of this.snapshots.entries()) {
      const diffFile = this.diffFiles.get(filePath);
      if (!diffFile || diffFile.hunks.every(h => h.status !== 'pending')) {
        continue;
      }

      // Restore original content
      try {
        if (diffFile.isNew) {
          fs.unlinkSync(filePath);
        } else {
          fs.writeFileSync(filePath, snapshot.originalContent, 'utf-8');
        }
      } catch {
        // ignore
      }
    }
    this.diffFiles.clear();
    this._onSessionEnded.fire();
  }

  acceptAllFileChanges(filePath: string): void {
    const diffFile = this.diffFiles.get(filePath);
    if (!diffFile) {
      return;
    }
    for (const hunk of diffFile.hunks) {
      if (hunk.status === 'pending') {
        hunk.status = 'accepted';
      }
    }
    this._onDiffUpdated.fire(diffFile);
  }

  async rejectAllFileChanges(filePath: string): Promise<void> {
    const snapshot = this.snapshots.get(filePath);
    const diffFile = this.diffFiles.get(filePath);
    if (!snapshot || !diffFile) {
      return;
    }

    try {
      if (diffFile.isNew) {
        fs.unlinkSync(filePath);
      } else {
        fs.writeFileSync(filePath, snapshot.originalContent, 'utf-8');
      }
    } catch {
      // ignore
    }

    this.diffFiles.delete(filePath);
    this._onFileRemoved.fire(filePath);
  }

  async recomputeHunks(filePath: string): Promise<void> {
    const snapshot = this.snapshots.get(filePath);
    if (!snapshot) {
      return;
    }

    let currentContent: string;
    try {
      currentContent = fs.readFileSync(filePath, 'utf-8');
    } catch {
      return;
    }

    const hunks = this.diffComputer.computeHunks(snapshot.originalContent, currentContent, filePath);

    if (hunks.length === 0) {
      this.diffFiles.delete(filePath);
      this._onFileRemoved.fire(filePath);
      return;
    }

    const diffFile: DiffFile = {
      filePath,
      relativePath: path.relative(this.workspaceRoot, filePath),
      hunks,
      isNew: snapshot.originalContent === '',
      isDeleted: false,
    };

    this.diffFiles.set(filePath, diffFile);
    this._onDiffUpdated.fire(diffFile);
  }

  private async takeInitialSnapshots(): Promise<void> {
    const modifiedFiles = await this.gitHelper.getModifiedFiles();
    const untrackedFiles = await this.gitHelper.getUntrackedFiles();

    for (const relativePath of modifiedFiles) {
      const filePath = path.join(this.workspaceRoot, relativePath);
      await this.snapshotFile(filePath, relativePath);
    }

    for (const relativePath of untrackedFiles) {
      const filePath = path.join(this.workspaceRoot, relativePath);
      this.snapshots.set(filePath, {
        filePath,
        originalContent: '',
        timestamp: Date.now(),
      });
    }
  }

  private async snapshotFile(filePath: string, relativePath: string): Promise<void> {
    const gitContent = await this.gitHelper.getFileAtHead(relativePath);

    this.snapshots.set(filePath, {
      filePath,
      originalContent: gitContent ?? '',
      timestamp: Date.now(),
    });
  }

  private preserveHunkStatuses(oldHunks: DiffHunk[], newHunks: DiffHunk[]): void {
    // Simple heuristic: match by position
    for (let i = 0; i < newHunks.length && i < oldHunks.length; i++) {
      if (oldHunks[i].status !== 'pending') {
        newHunks[i].status = oldHunks[i].status;
      }
    }
  }

  dispose(): void {
    this._onSessionStarted.dispose();
    this._onSessionEnded.dispose();
    this._onDiffUpdated.dispose();
    this._onFileRemoved.dispose();
  }
}
