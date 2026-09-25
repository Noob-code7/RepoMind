/**
 * context/git_analyzer.ts
 * Read-only Git state analysis: branches, modified files, uncommitted changes, recent commits.
 * NEVER modifies git state or commits anything.
 */
import { execSync } from 'node:child_process';
import { GitContext } from './schemas.js';

export class GitAnalyzer {
  /**
   * Analyze Git repository state safely in read-only mode.
   */
  static analyze(root: string): GitContext {
    try {
      // 1. Current Branch
      let branch = 'unknown';
      try {
        branch = execSync('git rev-parse --abbrev-ref HEAD', {
          cwd: root,
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
      } catch {
        // Not a git repo or detached HEAD
      }

      // 2. Working Tree Status (Modified & Untracked)
      const modifiedFiles: string[] = [];
      const untrackedFiles: string[] = [];

      try {
        const statusOutput = execSync('git status --porcelain', {
          cwd: root,
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });

        const lines = statusOutput.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const status = line.slice(0, 2);
          const file = line.slice(3).trim();

          if (status.includes('?')) {
            untrackedFiles.push(file);
          } else {
            modifiedFiles.push(file);
          }
        }
      } catch {
        // Fallback
      }

      // 3. Recent Commits (last 5)
      const recentCommits: Array<{ hash: string; message: string; author?: string; date?: string }> = [];
      try {
        const logOutput = execSync('git log -n 5 --pretty=format:"%h|%s|%an|%cr"', {
          cwd: root,
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });

        const commitLines = logOutput.split('\n');
        for (const line of commitLines) {
          const [hash, message, author, date] = line.split('|');
          if (hash && message) {
            recentCommits.push({ hash, message, author, date });
          }
        }
      } catch {
        // No commits or not a repo
      }

      return {
        branch,
        isClean: modifiedFiles.length === 0 && untrackedFiles.length === 0,
        modifiedFiles,
        untrackedFiles,
        recentCommits,
      };
    } catch {
      return {
        branch: 'none',
        isClean: true,
        modifiedFiles: [],
        untrackedFiles: [],
        recentCommits: [],
      };
    }
  }
}
