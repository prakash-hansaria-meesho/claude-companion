import * as vscode from 'vscode';
import { SessionManager } from './session/SessionManager';
import { FileWatcher } from './watcher/FileWatcher';
import { OriginalContentProvider } from './views/sideBySide/SideBySideDiffProvider';
import { openSideBySideDiff } from './views/sideBySide/SideBySideCommands';
import { InlineDecorationManager } from './views/inline/InlineDecorationManager';
import { InlineCodeLensProvider } from './views/inline/InlineCodeLensProvider';
import { ChangedFilesProvider } from './views/treeView/ChangedFilesProvider';
import { ClaudeAutocompleteProvider } from './autocomplete/ClaudeAutocompleteProvider';
import { AcceptedChangesSummaryProvider } from './views/AcceptedChangesSummaryProvider';
import { COMMANDS, CONFIG } from './utils/constants';

export function activate(context: vscode.ExtensionContext) {
  // Core services
  const sessionManager = new SessionManager(context);
  const fileWatcher = new FileWatcher(sessionManager);

  // Side-by-side diff content provider
  const originalContentProvider = new OriginalContentProvider(sessionManager);
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      OriginalContentProvider.scheme,
      originalContentProvider
    )
  );

  // Inline decorations (Cursor-style)
  const inlineDecorationManager = new InlineDecorationManager(sessionManager);

  // CodeLens for accept/reject
  const codeLensProvider = new InlineCodeLensProvider(sessionManager);
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeLensProvider)
  );

  // Tree view for changed files sidebar
  const changedFilesProvider = new ChangedFilesProvider(sessionManager);
  const treeView = vscode.window.createTreeView('claudeDiffFiles', {
    treeDataProvider: changedFilesProvider,
    showCollapseAll: false,
  });

  // Status bar item for session
  const sessionStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  sessionStatusBar.command = COMMANDS.toggleViewMode;

  function updateSessionStatusBar() {
    if (sessionManager.isActive) {
      const pending = sessionManager.getPendingHunkCount();
      const mode = sessionManager.viewMode === 'inline' ? 'Inline' : 'Side-by-Side';
      sessionStatusBar.text = `$(diff) Claude Diff: ${pending} pending (${mode})`;
      sessionStatusBar.tooltip = 'Click to toggle view mode';
      sessionStatusBar.show();
    } else {
      sessionStatusBar.hide();
    }
  }

  sessionManager.onSessionStarted(() => updateSessionStatusBar());
  sessionManager.onSessionEnded(() => updateSessionStatusBar());
  sessionManager.onDiffUpdated(() => updateSessionStatusBar());

  // Accepted changes summary provider
  const acceptedSummaryProvider = new AcceptedChangesSummaryProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      AcceptedChangesSummaryProvider.scheme,
      acceptedSummaryProvider
    )
  );

  // Autocomplete provider — experimental, disabled by default.
  // Only registered when explicitly enabled via settings or toggle command.
  const autocompleteProvider = new ClaudeAutocompleteProvider();
  if (autocompleteProvider.enabled) {
    context.subscriptions.push(
      vscode.languages.registerInlineCompletionItemProvider(
        { pattern: '**' },
        autocompleteProvider
      )
    );
  }

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.startSession, () => {
      sessionManager.start();
    }),

    vscode.commands.registerCommand(COMMANDS.endSession, () => {
      sessionManager.end();
    }),

    vscode.commands.registerCommand(COMMANDS.toggleViewMode, async () => {
      const newMode = sessionManager.toggleViewMode();
      vscode.window.showInformationMessage(`Claude Diff: Switched to ${newMode === 'inline' ? 'Inline' : 'Side-by-Side'} mode`);

      const editor = vscode.window.activeTextEditor;
      const filePath = editor?.document.uri.fsPath;
      const diffFile = filePath ? sessionManager.getDiffFile(filePath) : undefined;

      if (newMode === 'sideBySide') {
        // Clear inline decorations and open side-by-side diff for current file
        inlineDecorationManager.clearAllDecorations();
        codeLensProvider.refresh();
        if (filePath && diffFile) {
          openSideBySideDiff(filePath);
        }
      } else {
        // Switching to inline — close the diff editor and reopen the file normally
        if (filePath && diffFile) {
          // Close active diff editor tab, then reopen the file
          await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
          const doc = await vscode.workspace.openTextDocument(filePath);
          await vscode.window.showTextDocument(doc);
        }
        inlineDecorationManager.refreshActiveEditor();
        codeLensProvider.refresh();
      }

      updateSessionStatusBar();
    }),

    vscode.commands.registerCommand(COMMANDS.acceptHunk, (filePath: string, hunkId: string) => {
      sessionManager.markHunkAccepted(filePath, hunkId);
      inlineDecorationManager.refreshActiveEditor();
    }),

    vscode.commands.registerCommand(COMMANDS.rejectHunk, async (filePath: string, hunkId: string) => {
      const success = await sessionManager.markHunkRejected(filePath, hunkId);
      if (success) {
        inlineDecorationManager.refreshActiveEditor();
      }
    }),

    vscode.commands.registerCommand(COMMANDS.acceptAllFile, (filePathOrItem?: string | { diffFile?: { filePath: string } }) => {
      let filePath = typeof filePathOrItem === 'string' ? filePathOrItem : filePathOrItem?.diffFile?.filePath;
      // Fallback to active editor when invoked from command palette (no args)
      if (!filePath) {
        filePath = vscode.window.activeTextEditor?.document.uri.fsPath;
      }
      if (filePath && sessionManager.getDiffFile(filePath)) {
        sessionManager.acceptAllFileChanges(filePath);
        inlineDecorationManager.refreshActiveEditor();
        codeLensProvider.refresh();
        changedFilesProvider.refresh();
        updateSessionStatusBar();
      }
    }),

    vscode.commands.registerCommand(COMMANDS.rejectAllFile, async (filePathOrItem?: string | { diffFile?: { filePath: string } }) => {
      let filePath = typeof filePathOrItem === 'string' ? filePathOrItem : filePathOrItem?.diffFile?.filePath;
      if (!filePath) {
        filePath = vscode.window.activeTextEditor?.document.uri.fsPath;
      }
      if (filePath && sessionManager.getDiffFile(filePath)) {
        await sessionManager.rejectAllFileChanges(filePath);
        inlineDecorationManager.refreshActiveEditor();
        codeLensProvider.refresh();
        changedFilesProvider.refresh();
        updateSessionStatusBar();
      }
    }),

    vscode.commands.registerCommand(COMMANDS.acceptAll, async () => {
      // Capture diffs before accepting (so we can show the summary)
      const state = sessionManager.captureAcceptedState();

      sessionManager.acceptAllChanges();
      inlineDecorationManager.clearAllDecorations();
      codeLensProvider.refresh();
      changedFilesProvider.refresh();
      updateSessionStatusBar();

      // Show accepted changes in a summary tab
      if (state.diffFiles.length > 0) {
        await acceptedSummaryProvider.showSummary(
          state.diffFiles,
          state.snapshots,
          state.currentContents,
          state.workspaceRoot
        );
      }

      vscode.window.showInformationMessage('ClauFlo: All changes accepted');
    }),

    vscode.commands.registerCommand(COMMANDS.rejectAll, async () => {
      await sessionManager.rejectAllChanges();
      inlineDecorationManager.clearAllDecorations();
      codeLensProvider.refresh();
      changedFilesProvider.refresh();
      updateSessionStatusBar();
      vscode.window.showInformationMessage('ClauFlo: All changes rejected');
    }),

    vscode.commands.registerCommand(COMMANDS.openFile, (filePath: string, forceMode?: string) => {
      const mode = forceMode || sessionManager.viewMode;
      if (mode === 'sideBySide') {
        openSideBySideDiff(filePath);
      } else {
        // Open the file and let inline decorations show
        vscode.workspace.openTextDocument(filePath).then(doc => {
          vscode.window.showTextDocument(doc);
        });
      }
    }),

    vscode.commands.registerCommand(COMMANDS.refreshSession, async () => {
      if (sessionManager.isActive) {
        // Re-scan for changes
        const files = sessionManager.getChangedFiles();
        for (const file of files) {
          await sessionManager.recomputeHunks(file.filePath);
        }
        changedFilesProvider.refresh();
        inlineDecorationManager.refreshActiveEditor();
      }
    }),

    vscode.commands.registerCommand(COMMANDS.toggleAutocomplete, () => {
      autocompleteProvider.toggle();
    }),
  );

  // Auto-start session if configured
  const autoStart = vscode.workspace.getConfiguration().get<boolean>(CONFIG.autoStartSession, true);
  if (autoStart) {
    // Delay a bit to let the workspace settle
    setTimeout(() => {
      sessionManager.start();
    }, 2000);
  }

  // Register disposables
  context.subscriptions.push(
    sessionManager,
    fileWatcher,
    inlineDecorationManager,
    codeLensProvider,
    changedFilesProvider,
    originalContentProvider,
    acceptedSummaryProvider,
    autocompleteProvider,
    sessionStatusBar,
    treeView,
  );

  console.log('ClauFlo extension activated');
}

export function deactivate() {
  // Cleanup handled by disposables
}
