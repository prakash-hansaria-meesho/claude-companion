import * as vscode from 'vscode';
import * as https from 'https';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { CONFIG } from '../utils/constants';

const execFileAsync = promisify(execFile);

type AutocompleteBackend = 'cli' | 'api';

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
    await vscode.workspace.getConfiguration().update(
      CONFIG.autocompleteEnabled,
      this._enabled,
      vscode.ConfigurationTarget.Global
    );
    this.updateStatusBar();

    if (this._enabled) {
      const backend = this.getBackend();
      if (backend === 'api' && !this.getApiKey()) {
        const action = await vscode.window.showWarningMessage(
          'ClauFlo autocomplete enabled but no API key found. Using CLI backend requires "claude" in PATH. Set backend to "cli" in settings, or provide an API key.',
          'Open Settings',
          'Use CLI Backend'
        );
        if (action === 'Open Settings') {
          vscode.commands.executeCommand('workbench.action.openSettings', 'clauFlo.autocomplete.apiKey');
        } else if (action === 'Use CLI Backend') {
          await vscode.workspace.getConfiguration().update(
            CONFIG.autocompleteBackend,
            'cli',
            vscode.ConfigurationTarget.Global
          );
          vscode.window.showInformationMessage('ClauFlo autocomplete: switched to CLI backend');
        }
      } else {
        vscode.window.showInformationMessage(
          `ClauFlo autocomplete enabled (${backend} backend)`
        );
      }
    } else {
      vscode.window.showInformationMessage('ClauFlo autocomplete disabled');
    }
  }

  private getBackend(): AutocompleteBackend {
    return vscode.workspace.getConfiguration().get<AutocompleteBackend>(CONFIG.autocompleteBackend, 'cli');
  }

  private updateStatusBar(): void {
    if (this._enabled) {
      const backend = this.getBackend();
      this.statusBarItem.text = `$(sparkle) ClauFlo AC: ON (${backend.toUpperCase()})`;
      this.statusBarItem.tooltip = `ClauFlo Autocomplete enabled via ${backend} backend (click to toggle)`;
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

    // Cancel any previous request
    this.abortController?.abort();
    this.abortController = new AbortController();

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

  private buildPrompt(document: vscode.TextDocument, position: vscode.Position): string {
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

    return `You are an expert code completion engine. Complete the code at the cursor position marked with <CURSOR>.
Only output the completion text, nothing else. No explanations, no markdown, no code fences.
If no completion is appropriate, output nothing.

File: ${fileName}
Language: ${languageId}

\`\`\`${languageId}
${prefix}<CURSOR>${suffix}
\`\`\`

Complete from <CURSOR>:`;
  }

  private async getCompletion(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<string | undefined> {
    const backend = this.getBackend();
    const prompt = this.buildPrompt(document, position);

    if (backend === 'cli') {
      return this.getCompletionViaCLI(prompt, token);
    } else {
      return this.getCompletionViaAPI(prompt, token);
    }
  }

  // ── CLI Backend ──────────────────────────────────────────────────────────
  // Uses `claude` CLI which leverages the org license — no API key needed.
  private async getCompletionViaCLI(
    prompt: string,
    token: vscode.CancellationToken
  ): Promise<string | undefined> {
    try {
      const controller = new AbortController();
      const cancelDisposable = token.onCancellationRequested(() => controller.abort());

      const model = vscode.workspace.getConfiguration().get<string>(CONFIG.autocompleteModel, 'claude-haiku-4-5-20251001');

      const { stdout } = await execFileAsync(
        'claude',
        [
          '-p', prompt,
          '--model', model,
          '--output-format', 'text',
        ],
        {
          maxBuffer: 1024 * 1024,
          timeout: 15000,
          signal: controller.signal,
        }
      );

      cancelDisposable.dispose();

      const text = stdout.trim();
      return text || undefined;
    } catch {
      return undefined;
    }
  }

  // ── API Backend ──────────────────────────────────────────────────────────
  // Direct Anthropic API call — requires API key.
  private async getCompletionViaAPI(
    prompt: string,
    token: vscode.CancellationToken
  ): Promise<string | undefined> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      return undefined;
    }

    const model = vscode.workspace.getConfiguration().get<string>(CONFIG.autocompleteModel, 'claude-haiku-4-5-20251001');
    const maxTokens = vscode.workspace.getConfiguration().get<number>(CONFIG.autocompleteMaxTokens, 256);

    const messages: AnthropicMessage[] = [
      { role: 'user', content: prompt },
    ];

    try {
      const response = await this.callAnthropicAPI(apiKey, model, maxTokens, messages, token);
      if (!response) {
        return undefined;
      }

      const text = response.content?.[0]?.text?.trim();
      return text || undefined;
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
    return new Promise((resolve) => {
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
