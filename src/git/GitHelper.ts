import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export class GitHelper {
  constructor(private workspaceRoot: string) {}

  async getFileAtHead(relativePath: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync('git', ['show', `HEAD:${relativePath}`], {
        cwd: this.workspaceRoot,
        maxBuffer: 10 * 1024 * 1024,
      });
      return stdout;
    } catch {
      return null;
    }
  }

  async getTrackedFiles(): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync('git', ['ls-files'], {
        cwd: this.workspaceRoot,
        maxBuffer: 10 * 1024 * 1024,
      });
      return stdout.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  async getModifiedFiles(): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync('git', ['diff', '--name-only'], {
        cwd: this.workspaceRoot,
        maxBuffer: 10 * 1024 * 1024,
      });
      return stdout.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  async getUntrackedFiles(): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync('git', ['ls-files', '--others', '--exclude-standard'], {
        cwd: this.workspaceRoot,
        maxBuffer: 10 * 1024 * 1024,
      });
      return stdout.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  async isGitRepo(): Promise<boolean> {
    try {
      await execFileAsync('git', ['rev-parse', '--git-dir'], {
        cwd: this.workspaceRoot,
      });
      return true;
    } catch {
      return false;
    }
  }
}
