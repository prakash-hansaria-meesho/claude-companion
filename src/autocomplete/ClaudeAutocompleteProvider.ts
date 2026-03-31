import * as vscode from 'vscode';
import * as https from 'https';
import { CONFIG } from '../utils/constants';

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AnthropicResponse {
  content: Array<{ type: string; text: string }>;
}

export class ClaudeAutocompleteProvider implements vscode.InlineCompletionItemProvider, vscode.Disposable {
  private debounceTimer: NodeJS.Timeout | undefined;
  private abortController: AbortController | undefined;
  private disposables: vscode.Disposable[] = [];
  private _enabled: boolean;
  private statusBarItem: vscode.StatusBarItem;

  constructor() {
    this._enabled = vscode.workspace.getConfiguration().get<boolean>(CONFIG.autocompleteEnabled, false);

    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.command = 'clau-flo.toggleAutocomplete';
    this.updateStatusBar();
    this.statusBarItem.show();

    this.disposables.push(
      this.statusBarItem,
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('clauFlo.autocomplete')) {
          this._enabled = vscode.workspace.getConfiguration().get<boolean>(CONFIG.autocompleteEnabled, false);
          this.updateStatusBar();
        }
      }),
    );
  }

  get enabled(): boolean {
    return this._enabled;
  }

  async toggle(): Promise<void> {
    this._enabled = !this._enabled;
    // Persist to workspace settings so it survives reload
    await vscode.workspace.getConfiguration().update(
      CONFIG.autocompleteEnabled,
      this._enabled,
      vscode.ConfigurationTarget.Global
    );
    this.updateStatusBar();

    if (this._enabled && !this.getApiKey()) {
      const action = await vscode.window.showWarningMessage(
        'ClauFlo autocomplete enabled but no API key found. Set ANTHROPIC_API_KEY env variable or configure it in settings.',
        'Open Settings'
      );
      if (action === 'Open Settings') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'clauFlo.autocomplete.apiKey');
      }
    } else {
      vscode.window.showInformationMessage(
        `ClauFlo autocomplete ${this._enabled ? 'enabled' : 'disabled'}`
      );
    }
  }

  private updateStatusBar(): void {
    if (this._enabled) {
      this.statusBarItem.text = '$(sparkle) ClauFlo AC: ON';
      this.statusBarItem.tooltip = 'ClauFlo Autocomplete is enabled (click to toggle)';
    } else {
      this.statusBarItem.text = '$(sparkle) ClauFlo AC: OFF';
      this.statusBarItem.tooltip = 'ClauFlo Autocomplete is disabled (click to toggle)';
    }
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    if (!this._enabled) {
      return undefined;
    }

    const apiKey = this.getApiKey();
    if (!apiKey) {
      return undefined;
    }

    // Cancel any previous request
    this.abortController?.abort();
    this.abortController = new AbortController();

    // Debounce
    const debounceMs = vscode.workspace.getConfiguration().get<number>(CONFIG.autocompleteDebounceMs, 500);

    return new Promise<vscode.InlineCompletionItem[] | undefined>((resolve) => {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }

      this.debounceTimer = setTimeout(async () => {
        if (token.isCancellationRequested) {
          resolve(undefined);
          return;
        }

        try {
          const completion = await this.getCompletion(document, position, token);
          if (!completion || token.isCancellationRequested) {
            resolve(undefined);
            return;
          }

          const item = new vscode.InlineCompletionItem(
            completion,
            new vscode.Range(position, position)
          );

          resolve([item]);
        } catch {
          resolve(undefined);
        }
      }, debounceMs);
    });
  }

  private async getCompletion(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<string | undefined> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      return undefined;
    }

    // Build context: get surrounding code
    const prefixLines = Math.min(position.line, 50);
    const suffixLines = Math.min(document.lineCount - position.line - 1, 20);

    const prefixRange = new vscode.Range(
      Math.max(0, position.line - prefixLines), 0,
      position.line, position.character
    );
    const suffixRange = new vscode.Range(
      position.line, position.character,
      Math.min(document.lineCount - 1, position.line + suffixLines),
      document.lineAt(Math.min(document.lineCount - 1, position.line + suffixLines)).text.length
    );

    const prefix = document.getText(prefixRange);
    const suffix = document.getText(suffixRange);
    const languageId = document.languageId;
    const fileName = document.fileName;

    const model = vscode.workspace.getConfiguration().get<string>(CONFIG.autocompleteModel, 'claude-haiku-4-5-20251001');
    const maxTokens = vscode.workspace.getConfiguration().get<number>(CONFIG.autocompleteMaxTokens, 256);

    const prompt = `You are an expert code completion engine. Complete the code at the cursor position marked with <CURSOR>.
Only output the completion text, nothing else. No explanations, no markdown, no code fences.
If no completion is appropriate, output nothing.

File: ${fileName}
Language: ${languageId}

\`\`\`${languageId}
${prefix}<CURSOR>${suffix}
\`\`\`

Complete from <CURSOR>:`;

    const messages: AnthropicMessage[] = [
      { role: 'user', content: prompt },
    ];

    try {
      const response = await this.callAnthropicAPI(apiKey, model, maxTokens, messages, token);
      if (!response) {
        return undefined;
      }

      const text = response.content?.[0]?.text?.trim();
      if (!text) {
        return undefined;
      }

      return text;
    } catch {
      return undefined;
    }
  }

  private callAnthropicAPI(
    apiKey: string,
    model: string,
    maxTokens: number,
    messages: AnthropicMessage[],
    token: vscode.CancellationToken
  ): Promise<AnthropicResponse | undefined> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages,
      });

      const options = {
        hostname: 'api.anthropic.com',
        port: 443,
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body),
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            if (res.statusCode === 200) {
              resolve(JSON.parse(data) as AnthropicResponse);
            } else {
              resolve(undefined);
            }
          } catch {
            resolve(undefined);
          }
        });
      });

      req.on('error', () => resolve(undefined));

      // Handle cancellation
      token.onCancellationRequested(() => {
        req.destroy();
        resolve(undefined);
      });

      req.write(body);
      req.end();
    });
  }

  private getApiKey(): string | undefined {
    const configKey = vscode.workspace.getConfiguration().get<string>(CONFIG.autocompleteApiKey, '');
    if (configKey) {
      return configKey;
    }
    return process.env.ANTHROPIC_API_KEY;
  }

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.abortController?.abort();
    this.disposables.forEach(d => d.dispose());
  }
}
